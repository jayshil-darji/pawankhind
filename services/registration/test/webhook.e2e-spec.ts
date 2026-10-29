import { createHmac, timingSafeEqual } from "node:crypto";
import { Test } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import type pg from "pg";
import { AppModule } from "../src/app.module.js";
import { APP_CONFIG, PAYMENT_PROVIDER, PG_POOL, REDIS } from "../src/infra/tokens.js";
import type { PaymentProvider, ProviderPayment } from "../src/payments/payment-provider.js";
import {
  person,
  startTestDatabase,
  TestDatabase,
  testPool,
  resetDatabase,
} from "./support/database.js";
import { testConfig } from "./support/config.js";

const WEBHOOK_SECRET = "whsec_test_secret";

const sign = (raw: string) => createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");

class FakeProvider implements PaymentProvider {
  private count = 0;
  readonly remote = new Map<string, ProviderPayment>();
  failFetch = false;

  reset() {
    this.remote.clear();
    this.failFetch = false;
  }
  createOrder() {
    this.count += 1;
    return Promise.resolve({ orderId: `order_fake_${this.count}` });
  }
  verifyCheckoutSignature(i: { orderId: string; paymentId: string; signature: string }) {
    return i.signature === `sig:${i.orderId}|${i.paymentId}`;
  }
  fetchPayment(paymentId: string): Promise<ProviderPayment> {
    if (this.failFetch) return Promise.reject(new Error("razorpay down"));
    const payment = this.remote.get(paymentId);
    return payment ? Promise.resolve(payment) : Promise.reject(new Error("no such payment"));
  }
  verifyWebhookSignature(rawBody: string | Buffer, signature: string) {
    const expected = Buffer.from(sign(Buffer.from(rawBody).toString("utf8")));
    const given = Buffer.from(signature);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
  listPayments(): Promise<ProviderPayment[]> {
    return Promise.resolve([]);
  }
}

interface StartBody {
  registrationId: string;
  checkout: { orderId: string };
}

let db: TestDatabase;
let appPool: pg.Pool;
let app: NestFastifyApplication;
const fake = new FakeProvider();

beforeAll(async () => {
  db = await startTestDatabase();
  appPool = testPool(db.connectionUri);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PG_POOL)
    .useValue(appPool)
    .overrideProvider(REDIS)
    .useValue({ ping: () => Promise.resolve("PONG"), disconnect: () => {} })
    .overrideProvider(APP_CONFIG)
    .useValue(testConfig())
    .overrideProvider(PAYMENT_PROVIDER)
    .useValue(fake)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await db?.stop();
});

beforeEach(async () => {
  fake.reset();
  await resetDatabase(db.pool, { capacity: 3 });
});

async function start(i: number): Promise<StartBody> {
  const res = await app.inject({ method: "POST", url: "/api/registrations", payload: person(i) });
  return res.json<StartBody>();
}

/** Registers what Razorpay would report for this payment. */
function razorpayHas(paymentId: string, orderId: string, over: Partial<ProviderPayment> = {}) {
  fake.remote.set(paymentId, {
    id: paymentId,
    orderId,
    amountPaise: 20000,
    status: "captured",
    ...over,
  });
}

const eventBody = (paymentId: string, event = "payment.captured") =>
  JSON.stringify({ event, payload: { payment: { entity: { id: paymentId } } } });

function webhook(body: string, signature: string | null = sign(body)) {
  return app.inject({
    method: "POST",
    url: "/api/webhooks/razorpay",
    headers: {
      "content-type": "application/json",
      ...(signature === null ? {} : { "x-razorpay-signature": signature }),
    },
    payload: body,
  });
}

const verify = (registrationId: string, orderId: string, paymentId: string) =>
  app.inject({
    method: "POST",
    url: "/api/payments/verify",
    payload: {
      registrationId,
      razorpayPaymentId: paymentId,
      razorpaySignature: `sig:${orderId}|${paymentId}`,
    },
  });

async function statusOf(registrationId: string) {
  const res = await app.inject({
    method: "GET",
    url: `/api/registrations/${registrationId}/status`,
  });
  return res.json<{ status: string; bib?: number }>();
}

async function confirmedCount() {
  const r = await db.pool.query<{ n: string }>(
    "SELECT count(*) AS n FROM registrations WHERE status = 'confirmed'",
  );
  return Number(r.rows[0].n);
}

describe("POST /api/webhooks/razorpay", () => {
  it.each(["payment.captured", "order.paid"])(
    "confirms the registration from %s even though the browser never came back",
    async (event) => {
      const s = await start(1);
      razorpayHas("pay_1", s.checkout.orderId);

      const res = await webhook(eventBody("pay_1", event));

      expect(res.statusCode).toBe(200);
      expect(await statusOf(s.registrationId)).toEqual({ status: "confirmed", bib: 1001 });
    },
  );

  it("is safe when Razorpay delivers the same event twice", async () => {
    const s = await start(1);
    razorpayHas("pay_1", s.checkout.orderId);
    const body = eventBody("pay_1");

    expect((await webhook(body)).statusCode).toBe(200);
    expect((await webhook(body)).statusCode).toBe(200);

    expect(await statusOf(s.registrationId)).toEqual({ status: "confirmed", bib: 1001 });
    expect(await confirmedCount()).toBe(1);
    const next = await db.pool.query<{ next_bib: number }>("SELECT next_bib FROM events");
    expect(next.rows[0].next_bib).toBe(1002);
  });

  it("gives one BIB when the webhook and the browser verify arrive together", async () => {
    const s = await start(1);
    razorpayHas("pay_1", s.checkout.orderId);

    const [hook, browser] = await Promise.all([
      webhook(eventBody("pay_1")),
      verify(s.registrationId, s.checkout.orderId, "pay_1"),
    ]);

    expect(hook.statusCode).toBe(200);
    expect(browser.json()).toEqual({ status: "confirmed", bib: 1001 });
    expect(await confirmedCount()).toBe(1);
    const next = await db.pool.query<{ next_bib: number }>("SELECT next_bib FROM events");
    expect(next.rows[0].next_bib).toBe(1002);
  });

  it("rejects a forged signature and confirms nothing", async () => {
    const s = await start(1);
    razorpayHas("pay_1", s.checkout.orderId);

    const res = await webhook(eventBody("pay_1"), "0".repeat(64));

    expect(res.statusCode).toBe(400);
    expect((await statusOf(s.registrationId)).status).toBe("held");
  });

  it("rejects a missing signature header", async () => {
    const s = await start(1);
    razorpayHas("pay_1", s.checkout.orderId);

    const res = await webhook(eventBody("pay_1"), null);

    expect(res.statusCode).toBe(400);
    expect((await statusOf(s.registrationId)).status).toBe("held");
  });

  it("checks the signature against the exact bytes received, not a re-serialised copy", async () => {
    const s = await start(1);
    razorpayHas("pay_1", s.checkout.orderId);
    const compact = eventBody("pay_1");
    const spaced = JSON.stringify(JSON.parse(compact), null, 2); // same data, different bytes

    const res = await webhook(spaced, sign(compact));

    expect(res.statusCode).toBe(400);
    expect((await statusOf(s.registrationId)).status).toBe("held");
  });

  it("rejects a correctly signed body that is not valid JSON", async () => {
    const body = "not json at all";
    expect((await webhook(body)).statusCode).toBe(400);
  });

  it("answers 200 for an order we do not know, and changes nothing", async () => {
    const s = await start(1);
    razorpayHas("pay_other", "order_from_another_app");

    const res = await webhook(eventBody("pay_other"));

    expect(res.statusCode).toBe(200);
    expect((await statusOf(s.registrationId)).status).toBe("held");
  });

  it("does not confirm when Razorpay reports a different amount, and does not ask for a retry", async () => {
    const s = await start(1);
    razorpayHas("pay_1", s.checkout.orderId, { amountPaise: 19900 });

    const res = await webhook(eventBody("pay_1"));

    expect(res.statusCode).toBe(200);
    expect((await statusOf(s.registrationId)).status).toBe("held");
  });

  it("asks Razorpay to retry when the payment is not captured yet", async () => {
    const s = await start(1);
    razorpayHas("pay_1", s.checkout.orderId, { status: "authorized" });

    const res = await webhook(eventBody("pay_1"));

    expect(res.statusCode).toBe(503);
    expect((await statusOf(s.registrationId)).status).toBe("held");
  });

  it("ignores events we do not act on", async () => {
    const s = await start(1);
    razorpayHas("pay_1", s.checkout.orderId, { status: "failed" });

    const res = await webhook(eventBody("pay_1", "payment.failed"));

    expect(res.statusCode).toBe(200);
    expect((await statusOf(s.registrationId)).status).toBe("held");
  });

  it("asks for a retry when Razorpay's API is unavailable", async () => {
    const s = await start(1);
    razorpayHas("pay_1", s.checkout.orderId);
    fake.failFetch = true;

    const res = await webhook(eventBody("pay_1"));

    expect(res.statusCode).toBe(502);
    expect((await statusOf(s.registrationId)).status).toBe("held");
  });

  it("logs why a webhook was rejected, without leaking the signature or the payment", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    try {
      const forged = "f".repeat(64);
      await webhook(eventBody("pay_1"), forged);

      const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("webhook: bad_signature");
      expect(logged).not.toContain(forged);
      expect(logged).not.toContain("pay_1");
    } finally {
      warn.mockRestore();
    }
  });
});
