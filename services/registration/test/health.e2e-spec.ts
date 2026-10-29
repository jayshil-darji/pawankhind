import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { PG_POOL, REDIS, APP_CONFIG } from "../src/infra/tokens.js";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { testConfig } from "./support/config.js";

async function createApp(pool: unknown, redis: unknown) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PG_POOL)
    .useValue(pool)
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(APP_CONFIG)
    .useValue(testConfig())
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

const healthyPool = {
  query: () => ({ rows: [] }),
  end: async () => {},
};
const healthyRedis = {
  ping: () => "PONG",
  disconnect: async () => {},
};
const brokenPool = {
  query: () => {
    throw new Error("connection refused");
  },
  end: async () => {},
};

describe("health", () => {
  let app: NestFastifyApplication;

  afterEach(async () => {
    await app.close();
  });

  it("live answers even when a dependency is down", async () => {
    app = await createApp(brokenPool, healthyRedis);
    const res = await app.inject({ method: "GET", url: "/health/live" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("ready is 200 when postgres and redis answer", async () => {
    app = await createApp(healthyPool, healthyRedis);
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    const body = res.json<{ status: string }>();

    expect(body.status).toBe("ok");
    expect(res.statusCode).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("ready is 503 and names postgres when it is down", async () => {
    app = await createApp(brokenPool, healthyRedis);
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    const body = res.json<{ error: { postgres: { status: string } } }>();

    expect(res.statusCode).toBe(503);
    expect(body.error.postgres.status).toBe("down");
  });
});
