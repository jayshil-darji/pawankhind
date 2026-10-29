import type { Config } from "./config.js";

/** Fastify options shared by main.ts and the e2e tests, so tests run the real proxy setting. */
export function fastifyOptions(config: Pick<Config, "TRUST_PROXY">) {
  const trust = config.TRUST_PROXY;
  return {
    bodyLimit: 16 * 1024,
    // Fastify 5.12 treats a bare number as "trust nothing" (fastify/lib/request.js
    // getTrustProxyFn; docs/Reference/Server.md "trustProxy"), so a hop count
    // becomes a function: trust the socket peer and the next hops-1 entries, then
    // take the next X-Forwarded-For entry from the right. Fastify's docs warn this
    // is unsafe if the app can be reached directly: it is safe only while the
    // network lets nothing but the proxy reach us (dev: SG allows CloudFront only).
    trustProxy: typeof trust === "number" ? (_address: string, hop: number) => hop < trust : trust,
  };
}
