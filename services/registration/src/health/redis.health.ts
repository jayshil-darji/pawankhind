import { Inject, Injectable } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";
import { REDIS } from "../infra/tokens.js";
import { Redis } from "ioredis";

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly indicators: HealthIndicatorService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  isHealthy(key: string) {
    return this.indicators
      .check(key)
      .attempt(async () => {
        await this.redis.ping();
        return {};
      })
      .withTimeout(1000);
  }
}
