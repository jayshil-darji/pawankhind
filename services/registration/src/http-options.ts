import { FastifyAdapter } from "@nestjs/platform-fastify";
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

/** True when the path part (before '?') could route differently from how CloudFront matched it:
 *  CloudFront picks a behaviour (and the /api/admin* gate) from the raw path, Fastify routes on
 *  the decoded one, so /api/%61dmin/ping would skip the gate and still reach /api/admin/ping.
 *  Our paths never need percent-escapes, empty or dot segments, or backslashes. */
export function isAmbiguousPath(url: string): boolean {
  const path = url.split("?", 1)[0];
  return (
    path.includes("%") ||
    path.includes("\\") ||
    path.includes("//") ||
    path.includes("/./") ||
    path.includes("/../") ||
    path.endsWith("/.") ||
    path.endsWith("/..")
  );
}

/** onRequest hook: ambiguous paths get 400 before a handler runs. Fastify's callback form:
 *  after replying, done() must not be called. */
export function rejectAmbiguousPath(
  request: { url: string },
  reply: { code(status: number): { send(body: unknown): unknown } },
  done: () => void,
): void {
  if (isAmbiguousPath(request.url)) {
    reply.code(400).send({ code: "invalid_path" });
    return;
  }
  done();
}

/** The HTTP adapter for main.ts and the e2e tests: real options plus the path guard. */
export function httpAdapter(config: Pick<Config, "TRUST_PROXY">): FastifyAdapter {
  const adapter = new FastifyAdapter(fastifyOptions(config));
  adapter.getInstance().addHook("onRequest", rejectAmbiguousPath);
  return adapter;
}
