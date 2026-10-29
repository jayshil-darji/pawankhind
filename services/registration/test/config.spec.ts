import { loadConfig } from "../src/config.js";

const env = {
  DATABASE_URL: "postgres://x",
  REDIS_URL: "redis://x",
  RAZORPAY_KEY_ID: "rzp_test_fake",
  RAZORPAY_KEY_SECRET: "secret",
  RAZORPAY_WEBHOOK_SECRET: "webhook-secret",
};

describe("TRUST_PROXY", () => {
  it("defaults to false", () => {
    expect(loadConfig(env).TRUST_PROXY).toBe(false);
  });

  it.each([
    ["false", false],
    ["true", true],
    ["1", 1],
    ["2", 2],
  ])("parses %s", (value, expected) => {
    expect(loadConfig({ ...env, TRUST_PROXY: value }).TRUST_PROXY).toBe(expected);
  });

  it.each(["0", "-1", "yes", "1.5", ""])("rejects %j without echoing values", (value) => {
    expect(() => loadConfig({ ...env, TRUST_PROXY: value })).toThrow(
      "Invalid environment configuration: TRUST_PROXY",
    );
  });
});
