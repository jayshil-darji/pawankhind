import { loadConfig, type Config } from "../../src/config.js";

/** Every required variable, with test values. Tests pass overrides as strings, like real env vars. */
export const TEST_ENV = {
  APP_ENV: "dev",
  RAZORPAY_MODE: "test",
  DATABASE_URL: "postgres://unused",
  REDIS_URL: "redis://unused",
  RAZORPAY_KEY_ID: "rzp_test_fake",
  RAZORPAY_KEY_SECRET: "fake",
  RAZORPAY_WEBHOOK_SECRET: "fake-webhook",
};

/** A complete config built by the real loader, so tests never run with fields missing. */
export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({ ...TEST_ENV, ...overrides });
}
