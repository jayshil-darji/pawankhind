import { z } from "zod";

const schema = z.object({
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
  RAZORPAY_KEY_ID: z.string().startsWith("rzp_test_", "use a TEST key (rzp_test_...)"),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(8),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);

  if (!result.success) {
    const names = result.error.issues.map((i) => i.path.join(".")).join(", ");

    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return result.data;
}
