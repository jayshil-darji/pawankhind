import { Redis } from "ioredis";
import { GenericContainer, StartedTestContainer } from "testcontainers";
import { RateLimiter } from "../src/infra/rate-limiter.js";

let container: StartedTestContainer;
let redis: Redis;
let limiter: RateLimiter;

beforeAll(async () => {
  container = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();
  redis = new Redis({ host: container.getHost(), port: container.getMappedPort(6379) });
  redis.on("error", () => {});
  limiter = new RateLimiter(redis);
});

afterAll(async () => {
  redis?.disconnect();
  await container?.stop();
});

beforeEach(async () => {
  await redis.flushall();
});

describe("RateLimiter", () => {
  it("allows up to the limit, then blocks with a retry time", async () => {
    for (let i = 0; i < 3; i++) expect((await limiter.hit("a", 3, 60)).allowed).toBe(true);

    const blocked = await limiter.hit("a", 3, 60);

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("counts keys separately", async () => {
    await limiter.hit("a", 1, 60);
    expect((await limiter.hit("a", 1, 60)).allowed).toBe(false);
    expect((await limiter.hit("b", 1, 60)).allowed).toBe(true);
  });

  it("starts a new window after the old one expires", async () => {
    await limiter.hit("a", 1, 1);
    expect((await limiter.hit("a", 1, 1)).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect((await limiter.hit("a", 1, 1)).allowed).toBe(true);
  });

  it("repairs a counter that has no expiry", async () => {
    await redis.set("rl:x", "5"); // no TTL: would block forever without the repair

    const decision = await limiter.hit("x", 3, 60);

    expect(decision.allowed).toBe(false);
    expect(await redis.ttl("rl:x")).toBeGreaterThan(0);
  });

  it("fails open when Redis is unavailable", async () => {
    const broken = new RateLimiter({ eval: () => Promise.reject(new Error("redis down")) });

    expect(await broken.hit("a", 1, 60)).toEqual({ allowed: true, retryAfterSec: 0 });
  });
});
