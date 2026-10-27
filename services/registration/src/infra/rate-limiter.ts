import { Logger } from "@nestjs/common";

/** The one thing we need from Redis. */
export interface RedisEval {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

// Atomic: count the hit, set the expiry on the first one, and repair a counter that lost its expiry.
const SCRIPT = `
local c = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if c == 1 or ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {c, ttl}
`;

export interface RateDecision {
  allowed: boolean;
  retryAfterSec: number;
}

export class RateLimiter {
  private readonly log = new Logger(RateLimiter.name);

  constructor(private readonly redis: RedisEval) {}

  async hit(key: string, limit: number, windowSec: number): Promise<RateDecision> {
    try {
      const [count, ttl] = (await this.redis.eval(SCRIPT, 1, `rl:${key}`, windowSec)) as [
        number,
        number,
      ];
      if (count > limit) return { allowed: false, retryAfterSec: Math.max(ttl, 1) };
      return { allowed: true, retryAfterSec: 0 };
    } catch (error) {
      // Fail open: a Redis outage must not stop people registering.
      this.log.warn(
        `rate limiter unavailable, allowing request: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      return { allowed: true, retryAfterSec: 0 };
    }
  }
}
