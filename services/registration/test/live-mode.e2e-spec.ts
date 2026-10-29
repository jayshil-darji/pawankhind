import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import pg from "pg";
import { AppModule } from "../src/app.module.js";
import { APP_CONFIG, PAYMENT_PROVIDER, PG_POOL, REDIS } from "../src/infra/tokens.js";
import type { PaymentProvider, ProviderPayment } from "../src/payments/payment-provider.js";
import { testConfig } from "./support/config.js";
import { person, startTestDatabase, TestDatabase } from "./support/database.js";
import { FakeRedis } from "./support/fake-redis.js";

/** Only order creation is used here; everything else refuses. */
class OrdersOnlyProvider implements PaymentProvider {
  private count = 0;
  createOrder() {
    this.count += 1;
    return Promise.resolve({ orderId: `order_live_${this.count}` });
  }
  verifyCheckoutSignature() {
    return false;
  }
  fetchPayment(): Promise<ProviderPayment> {
    return Promise.reject(new Error("not used"));
  }
  verifyWebhookSignature() {
    return false;
  }
  listPayments(): Promise<ProviderPayment[]> {
    return Promise.resolve([]);
  }
}

const LIVE = { APP_ENV: "prod", RAZORPAY_MODE: "live", RAZORPAY_KEY_ID: "rzp_live_fake" };

async function startApp(db: TestDatabase, overrides: Record<string, string>) {
  const pool = new pg.Pool({ connectionString: db.connectionUri });
  pool.on("error", () => {});
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PG_POOL)
    .useValue(pool)
    .overrideProvider(REDIS)
    .useValue(new FakeRedis())
    .overrideProvider(APP_CONFIG)
    .useValue(testConfig(overrides))
    .overrideProvider(PAYMENT_PROVIDER)
    .useValue(new OrdersOnlyProvider())
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
  await db.pool.query(
    `UPDATE events SET reg_opens_at = now() - interval '1 day', reg_closes_at = now() + interval '1 day'`,
  );
});

afterAll(async () => {
  await db?.stop();
});

describe("live marker, set by the real app at startup", () => {
  let fresh: TestDatabase;

  beforeAll(async () => {
    fresh = await startTestDatabase();
  });

  afterAll(async () => {
    await fresh?.stop();
  });

  const mark = async () =>
    (
      await fresh.pool.query<{ live_activated_at: Date | null }>(
        "SELECT live_activated_at FROM environment_state",
      )
    ).rows[0].live_activated_at;

  // In order: one database, three starts.
  it("is not set by a start in test mode", async () => {
    await (await startApp(fresh, {})).close();

    expect(await mark()).toBeNull();
  });

  it("is set by the first start in live mode", async () => {
    await (await startApp(fresh, LIVE)).close();

    expect(await mark()).toBeInstanceOf(Date);
  });

  it("keeps the first time on later live starts", async () => {
    const first = await mark();

    await (await startApp(fresh, LIVE)).close();

    expect(await mark()).toEqual(first);
  });
});

describe("live start when the mark cannot be written", () => {
  let broken: TestDatabase;

  beforeAll(async () => {
    broken = await startTestDatabase();
    await broken.pool.query("ALTER TABLE environment_state RENAME TO environment_state_moved");
  });

  afterAll(async () => {
    await broken?.stop();
  });

  it("refuses to start rather than run live unmarked", async () => {
    const outcome = await startApp(broken, LIVE).then(
      async (app) => {
        await app.close();
        return "started";
      },
      (error: unknown) => String(error),
    );

    expect(outcome).toMatch(/environment_state/);
  });
});

describe("live start when the environment_state row is gone", () => {
  let emptied: TestDatabase;

  beforeAll(async () => {
    emptied = await startTestDatabase();
    // TRUNCATE skips the row-level delete trigger, so this is how the row can disappear.
    await emptied.pool.query("TRUNCATE environment_state");
  });

  afterAll(async () => {
    await emptied?.stop();
  });

  it("refuses to start, naming environment_state", async () => {
    const outcome = await startApp(emptied, LIVE).then(
      async (app) => {
        await app.close();
        return "started";
      },
      (error: unknown) => String(error),
    );

    expect(outcome).toMatch(/environment_state/);
    expect(outcome).not.toMatch(/rzp_|20\d\d-/); // no key, no timestamp
  });
});

describe("the real app in live mode", () => {
  it("records a new registration's payment as live", async () => {
    const app = await startApp(db, LIVE);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/registrations",
        payload: person(1),
      });
      expect(res.statusCode).toBe(201);

      const payment = await db.pool.query<{ provider_mode: string }>(
        "SELECT provider_mode FROM payments WHERE provider_order_id = $1",
        [res.json<{ checkout: { orderId: string } }>().checkout.orderId],
      );
      expect(payment.rows[0].provider_mode).toBe("live");
    } finally {
      await app.close();
    }
  });
});
