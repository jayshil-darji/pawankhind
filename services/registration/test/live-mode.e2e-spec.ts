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
