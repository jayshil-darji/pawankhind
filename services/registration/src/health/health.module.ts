import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { HealthController } from "./health.controller.js";
import { RedisHealthIndicator } from "./redis.health.js";
import { PostgresHealthIndicator } from "./postgres.health.js";

@Module({
    imports: [TerminusModule],
    controllers: [HealthController],
    providers: [PostgresHealthIndicator, RedisHealthIndicator]
})
export class HealthModule {}