/** A tiny in-memory stand-in for the parts of Redis the app uses in e2e tests. */
export class FakeRedis {
  private readonly counters = new Map<string, { count: number; expiresAt: number }>();

  ping() {
    return Promise.resolve("PONG");
  }

  disconnect() {}

  reset() {
    this.counters.clear();
  }

  /** Mimics the rate limiter script: count the hit, expiry set on the first one. */
  eval(_script: string, _numKeys: number, key: string, windowSec: number) {
    const now = Date.now();
    let entry = this.counters.get(key);
    if (!entry || entry.expiresAt <= now) {
      entry = { count: 0, expiresAt: now + windowSec * 1000 };
      this.counters.set(key, entry);
    }
    entry.count += 1;
    const ttl = Math.max(Math.ceil((entry.expiresAt - now) / 1000), 1);
    return Promise.resolve([entry.count, ttl]);
  }
}
