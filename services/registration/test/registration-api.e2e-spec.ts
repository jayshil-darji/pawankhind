import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { DECLARATION_VERSION } from "@pawankhind/schemas";
import type pg from "pg";
import { AppModule } from "../src/app.module.js";
import { APP_CONFIG, PAYMENT_PROVIDER, PG_POOL, REDIS } from "../src/infra/tokens.js";
import type { PaymentProvider, ProviderPayment } from "../src/payments/payment-provider.js";
import { person, startTestDatabase, TestDatabase, testPool } from "./support/database.js";
import { HoldSweeper } from "../src/registrations/hold-sweeper.js";
import { ReconciliationJob } from "../src/payments/reconciliation.job.js";
import { FakeRedis } from "./support/fake-redis.js";
import { LIMITS } from "../src/infra/rate-limit.js";
import { fastifyOptions } from "../src/http-options.js";
import { testConfig } from "./support/config.js";

class FakeProvider implements PaymentProvider {
  failCreate = false;
  remoteStatus = "captured";
  remoteAmountDelta = 0;
  listed: ProviderPayment[] = [];

  private count = 0;
  private last = { orderId: "", amountPaise: 0 };

  reset() {
    this.failCreate = false;
    this.remoteStatus = "captured";
    this.remoteAmountDelta = 0;
    this.listed = [];
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

  listPayments(): Promise<ProviderPayment[]> {
    return Promise.resolve(this.listed);
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
const fakeRedis = new FakeRedis();

beforeAll(async () => {
  db = await startTestDatabase();
  appPool = testPool(db.connectionUri);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PG_POOL)
    .useValue(appPool)
    .overrideProvider(REDIS)
    .useValue(fakeRedis)
    .overrideProvider(APP_CONFIG)
    .useValue(testConfig())
    .overrideProvider(PAYMENT_PROVIDER)
    .useValue(fake)
    .compile();
  // Same adapter options as main.ts, with the value deploy/compose.dev.yaml sets (one CloudFront hop).
  app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(fastifyOptions(testConfig({ TRUST_PROXY: "1" }))),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await db?.stop();
});

beforeEach(async () => {
  fakeRedis.reset();
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

  it("answers 409 for a person who is already confirmed, without leaking a slot", async () => {
    const first = (await startRegistration(1)).json<StartBody>();
    await verify(first.registrationId, first.checkout.orderId, "pay_1");

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

describe("hold sweeper", () => {
  it("is wired into the app and frees expired holds", async () => {
    const started = (await startRegistration(1)).json<StartBody>();
    await db.pool.query(
      "UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1",
      [started.registrationId],
    );

    const released = await app.get(HoldSweeper).tick();

    expect(released).toBe(1);
    expect(await slotsTaken()).toBe(0);
    const status = await app.inject({
      method: "GET",
      url: `/api/registrations/${started.registrationId}/status`,
    });
    expect(status.json()).toEqual({ status: "expired" });
  });
});

describe("reconciliation job", () => {
  it("is wired into the app and confirms a payment nobody reported", async () => {
    const started = (await startRegistration(1)).json<StartBody>();
    fake.listed = [
      { id: "pay_1", orderId: started.checkout.orderId, amountPaise: 20000, status: "captured" },
    ];

    const result = await app.get(ReconciliationJob).tick();

    expect(result).toEqual({ confirmed: 1, needsHuman: 0 });
    const status = await app.inject({
      method: "GET",
      url: `/api/registrations/${started.registrationId}/status`,
    });
    expect(status.json()).toEqual({ status: "confirmed", bib: 1001 });
  });
});

describe("starting again while a hold is live", () => {
  type Started = StartBody & { resumed: boolean };

  it("returns the same registration and order instead of an error", async () => {
    const first = (await startRegistration(1)).json<Started>();
    expect(first.resumed).toBe(false);

    const again = await startRegistration(1);

    expect(again.statusCode).toBe(201);
    const body = again.json<Started>();
    expect(body.registrationId).toBe(first.registrationId);
    expect(body.checkout.orderId).toBe(first.checkout.orderId);
    expect(body.resumed).toBe(true);
    expect(await slotsTaken()).toBe(1);
  });

  it("matches the name ignoring case and extra spaces", async () => {
    const first = (await startRegistration(1)).json<Started>();

    const again = (
      await startRegistration(1, { ...person(1), fullName: "  RUNNER 1 " })
    ).json<Started>();

    expect(again.registrationId).toBe(first.registrationId);
    expect(again.resumed).toBe(true);
  });

  it("treats a different name on the same phone as a different person", async () => {
    const first = (await startRegistration(1)).json<Started>();

    const other = (
      await startRegistration(1, { ...person(1), fullName: "Someone Else" })
    ).json<Started>();

    expect(other.registrationId).not.toBe(first.registrationId);
    expect(other.resumed).toBe(false);
    expect(await slotsTaken()).toBe(2);
  });

  it("starts fresh when the earlier hold expired but was not swept yet", async () => {
    const first = (await startRegistration(1)).json<Started>();
    await db.pool.query(
      "UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1",
      [first.registrationId],
    );

    const again = (await startRegistration(1)).json<Started>();

    expect(again.registrationId).not.toBe(first.registrationId);
    expect(again.resumed).toBe(false);
    expect(await slotsTaken()).toBe(1);
  });

  it("does not create a second order while the first request is still setting up", async () => {
    const first = (await startRegistration(1)).json<Started>();
    await db.pool.query("DELETE FROM payments WHERE registration_id = $1", [first.registrationId]);

    const again = await startRegistration(1);

    expect(again.statusCode).toBe(409);
    expect(again.json<{ code: string }>().code).toBe("setup_in_progress");
    const orders = await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM payments");
    expect(Number(orders.rows[0].n)).toBe(0);
  });
});

describe("rate limiting", () => {
  it("answers 429 with Retry-After once one address sends too many registrations", async () => {
    for (let i = 0; i < LIMITS.start.limit; i++) {
      expect((await startRegistration(1, {})).statusCode).toBe(400);
    }

    const blocked = await startRegistration(1, {});

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<{ code: string }>().code).toBe("rate_limited");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("counts each address separately", async () => {
    for (let i = 0; i <= LIMITS.start.limit; i++) await startRegistration(1, {});

    const other = await app.inject({
      method: "POST",
      url: "/api/registrations",
      payload: {},
      remoteAddress: "10.0.0.2",
    });

    expect(other.statusCode).toBe(400);
  });

  // Behind CloudFront: the socket peer is an edge, and CloudFront appends the
  // viewer's address to whatever X-Forwarded-For the client sent.
  const viaCloudFront = (clientXff: string, viewer: string) =>
    app.inject({
      method: "POST",
      url: "/api/registrations",
      payload: {},
      remoteAddress: "130.176.0.10",
      headers: { "x-forwarded-for": `${clientXff}, ${viewer}` },
    });

  it("ignores a client-supplied X-Forwarded-For: rotating it does not escape the limit", async () => {
    for (let i = 0; i < LIMITS.start.limit; i++) {
      expect((await viaCloudFront(`6.6.6.${i}`, "203.0.113.7")).statusCode).toBe(400);
    }

    const blocked = await viaCloudFront("6.6.6.250", "203.0.113.7");

    expect(blocked.statusCode).toBe(429);
  });

  it("counts viewers behind the same CloudFront edge separately", async () => {
    for (let i = 0; i <= LIMITS.start.limit; i++) await viaCloudFront("6.6.6.6", "203.0.113.7");

    const otherViewer = await viaCloudFront("6.6.6.6", "203.0.113.8");

    expect(otherViewer.statusCode).toBe(400);
  });
});

describe("declarations", () => {
  it("rejects a registration without the health declaration", async () => {
    const res = await startRegistration(1, { ...person(1), healthDeclaration: false });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ code: string; issues: { field: string }[] }>().issues).toContainEqual(
      expect.objectContaining({ field: "healthDeclaration" }),
    );
  });

  it("rejects a registration without accepting the terms", async () => {
    const withoutTerms: Record<string, unknown> = { ...person(1) };
    delete withoutTerms.termsAccepted;

    const res = await startRegistration(1, withoutTerms);

    expect(res.statusCode).toBe(400);
    expect(res.json<{ issues: { field: string }[] }>().issues).toContainEqual(
      expect.objectContaining({ field: "termsAccepted" }),
    );
  });

  it("records when, and to which wording version, the declarations were accepted", async () => {
    const started = (await startRegistration(1)).json<{ registrationId: string }>();

    const row = await db.pool.query<{ version: string | null; fresh: boolean | null }>(
      `SELECT declarations_version AS version,
              declarations_accepted_at > now() - interval '1 minute' AS fresh
         FROM registrations WHERE id = $1`,
      [started.registrationId],
    );

    expect(row.rows[0]).toEqual({ version: DECLARATION_VERSION, fresh: true });
  });

  it("keeps the original acceptance time when the same person starts again", async () => {
    const first = (await startRegistration(1)).json<{ registrationId: string }>();
    const read = async () =>
      (
        await db.pool.query<{ at: Date }>(
          `SELECT declarations_accepted_at AS at FROM registrations WHERE id = $1`,
          [first.registrationId],
        )
      ).rows[0]?.at;
    const before = await read();

    const again = (await startRegistration(1)).json<{ registrationId: string; resumed: boolean }>();

    expect(again.resumed).toBe(true);
    expect(again.registrationId).toBe(first.registrationId);
    expect(await read()).toEqual(before);
  });

  it("refuses a half-recorded acceptance", async () => {
    const started = (await startRegistration(1)).json<{ registrationId: string }>();

    await expect(
      db.pool.query(`UPDATE registrations SET declarations_accepted_at = NULL WHERE id = $1`, [
        started.registrationId,
      ]),
    ).rejects.toThrow(/registrations_declarations_together/);
  });
});
