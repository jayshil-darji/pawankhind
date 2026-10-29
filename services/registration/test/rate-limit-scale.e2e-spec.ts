import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module.js";
import { APP_CONFIG, PG_POOL, REDIS } from "../src/infra/tokens.js";
import { LIMITS } from "../src/infra/rate-limit.js";
import { testConfig } from "./support/config.js";
import { startTestDatabase, TestDatabase, testPool } from "./support/database.js";
import { FakeRedis } from "./support/fake-redis.js";

let db: TestDatabase;
let app: NestFastifyApplication;

beforeAll(async () => {
  db = await startTestDatabase();
  const pool = testPool(db.connectionUri);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PG_POOL)
    .useValue(pool)
    .overrideProvider(REDIS)
    .useValue(new FakeRedis())
    .overrideProvider(APP_CONFIG)
    .useValue(testConfig({ RATE_LIMIT_SCALE: "2" }))
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await db?.stop();
});

describe("RATE_LIMIT_SCALE in the real app", () => {
  it("lets one address make scale × limit starts before 429", async () => {
    const start = () => app.inject({ method: "POST", url: "/api/registrations", payload: {} });

    for (let i = 0; i < 2 * LIMITS.start.limit; i++) {
      expect((await start()).statusCode).toBe(400);
    }

    expect((await start()).statusCode).toBe(429);
  });
});
