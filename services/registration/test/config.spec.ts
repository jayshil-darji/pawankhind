import { describePaymentMode, loadConfig } from "../src/config.js";
import { TEST_ENV as env } from "./support/config.js";

const LIVE_KEY = "rzp_live_abc123";
const prodLive = { ...env, APP_ENV: "prod", RAZORPAY_MODE: "live", RAZORPAY_KEY_ID: LIVE_KEY };

function rejected(e: NodeJS.ProcessEnv): string {
  try {
    loadConfig(e);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("config was accepted");
}

describe("APP_ENV and RAZORPAY_MODE", () => {
  it.each(["APP_ENV", "RAZORPAY_MODE"])("%s is required, with no default", (name) => {
    const missing: NodeJS.ProcessEnv = { ...env };
    delete missing[name];
    expect(rejected(missing)).toBe(`Invalid environment configuration: ${name}`);
  });

  it.each([
    ["APP_ENV", "production"],
    ["RAZORPAY_MODE", "LIVE"],
  ])("rejects an unknown %s value", (name, value) => {
    expect(rejected({ ...env, [name]: value })).toBe(`Invalid environment configuration: ${name}`);
  });

  it("accepts test mode with a test key in dev and in prod", () => {
    expect(loadConfig(env).RAZORPAY_MODE).toBe("test");
    expect(loadConfig({ ...env, APP_ENV: "prod" }).APP_ENV).toBe("prod");
  });

  it("accepts live mode with a live key in prod", () => {
    const c = loadConfig(prodLive);
    expect([c.APP_ENV, c.RAZORPAY_MODE, c.RAZORPAY_KEY_ID]).toEqual(["prod", "live", LIVE_KEY]);
  });

  it("refuses live mode outside prod, even with a live key", () => {
    expect(rejected({ ...prodLive, APP_ENV: "dev" })).toBe(
      "Invalid environment configuration: RAZORPAY_MODE",
    );
  });

  it("refuses a key that does not match the mode, without echoing it", () => {
    const testKeyInLive = rejected({ ...prodLive, RAZORPAY_KEY_ID: "rzp_test_abc123" });
    const liveKeyInTest = rejected({ ...env, RAZORPAY_KEY_ID: LIVE_KEY });

    expect(testKeyInLive).toBe("Invalid environment configuration: RAZORPAY_KEY_ID");
    expect(liveKeyInTest).toBe("Invalid environment configuration: RAZORPAY_KEY_ID");
    expect(liveKeyInTest).not.toContain("abc123");
  });

  it("describes the payment mode without any key or secret", () => {
    const line = describePaymentMode(loadConfig(prodLive));
    expect(line).toBe("razorpay mode: live");
    expect(line).not.toContain("rzp_");
  });
});

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
