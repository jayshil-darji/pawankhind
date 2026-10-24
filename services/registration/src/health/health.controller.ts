import { Controller, Get } from "@nestjs/common";
import { HealthCheck, HealthCheckService } from "@nestjs/terminus";
import { PostgresHealthIndicator } from "./postgres.health.js";
import { RedisHealthIndicator } from "./redis.health.js";

@Controller("health")
export class HealthController {
    constructor(
        private readonly health: HealthCheckService,
        private readonly postgress: PostgresHealthIndicator,
        private readonly redis: RedisHealthIndicator
    ) {}

    @Get("live")
    live() {
        return { status: "ok" };
    }

    @Get("ready")
    @HealthCheck()
    ready() {
        return this.health.check([
            () => this.postgress.isHealthy("postgres"),
            () => this.redis.isHealthy("redis")
        ]);
    }
}