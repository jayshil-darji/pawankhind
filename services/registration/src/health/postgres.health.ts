import { Inject, Injectable } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";
import PG from "pg";
import { PG_POOL } from "../infra/tokens.js";

@Injectable()
export class PostgresHealthIndicator {
  constructor(
    private readonly indicators: HealthIndicatorService,
    @Inject(PG_POOL) private readonly pool: PG.Pool,
  ) {}

  isHealthy(key: string) {
    return this.indicators
      .check(key)
      .attempt(async () => {
        await this.pool.query("select 1");
        return {};
      })
      .withTimeout(1000);
  }
}
