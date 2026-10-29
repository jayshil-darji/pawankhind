import { z } from "zod";

const KEY_PREFIX = { test: "rzp_test_", live: "rzp_live_" } as const;

const fields = z.object({
  // Required, no defaults: a missing value must stop the app, never fall back to a mode.
  APP_ENV: z.enum(["dev", "prod"]),
  RAZORPAY_MODE: z.enum(["test", "live"]),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  // A hop count (e.g. "1" behind CloudFront) makes req.ip the address the nearest
  // trusted proxy appended to X-Forwarded-For. "true" trusts every hop, so the
  // client's own X-Forwarded-For entry wins: only for a proxy that overwrites it.
  TRUST_PROXY: z
    .string()
    .regex(/^(true|false|[1-9]\d*)$/, "use false, true or a hop count")
    .default("false")
    .transform((v) => (v === "true" ? true : v === "false" ? false : Number(v))),
  HOST: z.string().default("127.0.0.1"),
  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(8),
});

// Live payments only in production, and the key must belong to the declared mode.
const schema = fields.superRefine((c, ctx) => {
  if (c.RAZORPAY_MODE === "live" && c.APP_ENV !== "prod") {
    ctx.addIssue({ code: "custom", path: ["RAZORPAY_MODE"], message: "live only in prod" });
  }
  if (!c.RAZORPAY_KEY_ID.startsWith(KEY_PREFIX[c.RAZORPAY_MODE])) {
    ctx.addIssue({ code: "custom", path: ["RAZORPAY_KEY_ID"], message: "key does not match mode" });
  }
});

export type Config = z.infer<typeof schema>;

/** The one startup line about payments. Names the mode, never a key. */
export function describePaymentMode(config: Pick<Config, "RAZORPAY_MODE">): string {
  return `razorpay mode: ${config.RAZORPAY_MODE}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);

  if (!result.success) {
    const names = result.error.issues.map((i) => i.path.join(".")).join(", ");

    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return result.data;
}
