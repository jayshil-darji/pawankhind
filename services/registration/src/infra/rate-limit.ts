import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RateLimiter } from "./rate-limiter.js";

export interface RateLimitRule {
  name: string;
  limit: number;
  windowSec: number;
}

/** Per address, per 10 minutes. Generous: many people can share one network. */
export const LIMITS = {
  start: { name: "start", limit: 60, windowSec: 600 },
  verify: { name: "verify", limit: 120, windowSec: 600 },
  status: { name: "status", limit: 600, windowSec: 600 },
} satisfies Record<string, RateLimitRule>;

const RATE_LIMIT_KEY = "rate-limit-rule";
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RATE_LIMIT_KEY, rule);

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.get<RateLimitRule | undefined>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!rule) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<{ ip: string }>();
    const res = http.getResponse<{ header: (name: string, value: string | number) => unknown }>();

    const decision = await this.limiter.hit(`${rule.name}:${req.ip}`, rule.limit, rule.windowSec);
    if (decision.allowed) return true;

    res.header("retry-after", decision.retryAfterSec);
    throw new HttpException({ code: "rate_limited", retryAfterSec: decision.retryAfterSec }, 429);
  }
}
