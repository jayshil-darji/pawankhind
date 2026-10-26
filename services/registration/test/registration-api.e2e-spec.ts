import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import pg from "pg";
import { AppModule } from "../src/app.module.js";
import { APP_CONFIG, PAYMENT_PROVIDER, PG_POOL, REDIS } from "../src/infra/tokens.js";
import type { PaymentProvider, ProviderPayment } from "../src/payments/payment-provider.js";
import { person, startTestDatabase, TestDatabase } from "./support/database.js";

class FakeProvider implements PaymentProvider {
  failCreate = false;
  remoteStatus = "captured";
  remoteAmountDelta = 0;
  private count = 0;
  private last = { orderId: "", amountPaise: 0 };

  reset() {
    this.failCreate = false;
    this.remoteStatus = "captured";
    this.remoteAmountDelta = 0;
  }
  createOrder(input: { amountPaise: number }) {
    if (this.failCreate) return Promise.reject(new Error("provider down"));
    this.count += 1;
    this.last = { orderId: `order_fake_${this.count}`, amountPaise: input.amountPaise };
    return Promise.resolve({ orderId: this.last.orderId });
  }
  verifyCheckoutSignature(i: { orderId: string; paymentId: string; signature: string }) {
    return i.signature === `sig:${i.orderId}|${i.paymentId}`;
  }
  fetchPayment(paymentId: string): Promise<ProviderPayment> {
    return Promise.resolve({
      id: paymentId,
      orderId: this.last.orderId,
      amountPaise: this.last.amountPaise + this.remoteAmountDelta,
      status: this.remoteStatus,
    });
  }
  verifyWebhookSignature() {
    return true;
  }
}

interface StartBody {
  registrationId: string;
  checkout: { keyId: string; orderId: string; amountPaise: number; currency: string };
}

let db: TestDatabase;
let appPool: pg.Pool;
let app: NestFastifyApplication;
const fake = new FakeProvider();

beforeAll(async () => {
  db = await startTestDatabase();
  appPool = new pg.Pool({ connectionString: db.connectionUri });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PG_POOL)
    .useValue(appPool)
    .overrideProvider(REDIS)
    .useValue({ ping: () => Promise.resolve("PONG"), disconnect: () => {} })
    .overrideProvider(APP_CONFIG)
    .useValue({ RAZORPAY_KEY_ID: "rzp_test_fake" })
    .overrideProvider(PAYMENT_PROVIDER)
    .useValue(fake)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await db?.stop();
});

beforeEach(async () => {
  fake.reset();
  await db.pool.query("DELETE FROM payments");
  await db.pool.query("DELETE FROM registrations");
  await db.pool.query(
    `UPDATE events SET slots_taken = 0, next_bib = first_bib, capacity = 3,
       reg_opens_at = now() - interval '1 day', reg_closes_at = now() + interval '1 day'`,
  );
});

const startRegistration = (i: number, body: unknown = person(i)) =>
  app.inject({ method: "POST", url: "/api/registrations", payload: body as object });

const verify = (registrationId: string, orderId: string, paymentId: string, signature?: string) =>
  app.inject({
    method: "POST",
    url: "/api/payments/verify",
    payload: {
      registrationId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature ?? `sig:${orderId}|${paymentId}`,
    },
  });

async function slotsTaken() {
  return (await db.pool.query<{ slots_taken: number }>("SELECT slots_taken FROM events")).rows[0]
    .slots_taken;
}

describe("POST /api/registrations", () => {
  it("reserves a slot and returns checkout details", async () => {
    const res = await startRegistration(1);
    expect(res.statusCode).toBe(201);
    const body = res.json<StartBody>();
    expect(body.checkout).toMatchObject({
      keyId: "rzp_test_fake",
      amountPaise: 20000,
      currency: "INR",
    });
    expect(await slotsTaken()).toBe(1);
  });

  it("rejects invalid input with field errors and changes nothing", async () => {
    const res = await startRegistration(1, {
      ...person(1),
      mobile: "12345",
      dateOfBirth: "2999-01-01",
    });
    expect(res.statusCode).toBe(400);
    const fields = res.json<{ issues: { field: string }[] }>().issues.map((i) => i.field);
    expect(fields).toEqual(expect.arrayContaining(["mobile", "dateOfBirth"]));
    expect(await slotsTaken()).toBe(0);
  });

  it("answers 409 for a duplicate person without leaking a slot", async () => {
    await startRegistration(1);
    const again = await startRegistration(1);
    expect(again.statusCode).toBe(409);
    expect(again.json<{ code: string }>().code).toBe("already_registered");
    expect(await slotsTaken()).toBe(1);
  });

  it("answers 409 sold_out when the event is full", async () => {
    for (let i = 1; i <= 3; i++) expect((await startRegistration(i)).statusCode).toBe(201);
    const res = await startRegistration(4);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ code: string }>().code).toBe("sold_out");
  });

  it("releases the slot and returns 502 when the provider is down", async () => {
    fake.failCreate = true;
    const res = await startRegistration(1);
    expect(res.statusCode).toBe(502);
    expect(await slotsTaken()).toBe(0);
  });
});

describe("POST /api/payments/verify", () => {
  it("confirms a captured payment and issues the first BIB", async () => {
    const started = (await startRegistration(1)).json<StartBody>();
    const res = await verify(started.registrationId, started.checkout.orderId, "pay_1");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "confirmed", bib: 1001 });

    const status = await app.inject({
      method: "GET",
      url: `/api/registrations/${started.registrationId}/status`,
    });
    expect(status.json()).toEqual({ status: "confirmed", bib: 1001 });
  });

  it("is idempotent when the browser retries", async () => {
    const started = (await startRegistration(1)).json<StartBody>();
    await verify(started.registrationId, started.checkout.orderId, "pay_1");
    const again = await verify(started.registrationId, started.checkout.orderId, "pay_1");
    expect(again.json()).toEqual({ status: "confirmed", bib: 1001 });
  });

  it("rejects a forged signature and confirms nothing", async () => {
    const started = (await startRegistration(1)).json<StartBody>();
    const res = await verify(started.registrationId, started.checkout.orderId, "pay_1", "forged");
    expect(res.statusCode).toBe(400);
    const status = await app.inject({
      method: "GET",
      url: `/api/registrations/${started.registrationId}/status`,
    });
    expect(status.json<{ status: string }>().status).toBe("held");
  });

  it("reports pending when the payment is not captured yet", async () => {
    fake.remoteStatus = "authorized";
    const started = (await startRegistration(1)).json<StartBody>();
    const res = await verify(started.registrationId, started.checkout.orderId, "pay_1");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "pending" });
  });

  it("rejects when Razorpay reports a different amount", async () => {
    fake.remoteAmountDelta = -100;
    const started = (await startRegistration(1)).json<StartBody>();
    const res = await verify(started.registrationId, started.checkout.orderId, "pay_1");
    expect(res.statusCode).toBe(422);
  });

  it("answers 404 for an unknown registration", async () => {
    const res = await verify("11111111-1111-4111-8111-111111111111", "order_x", "pay_1");
    expect(res.statusCode).toBe(404);
  });
});
