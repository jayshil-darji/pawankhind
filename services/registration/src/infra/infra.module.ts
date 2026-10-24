import { Global, Inject, Logger, Module, OnApplicationShutdown } from "@nestjs/common";
import { loadConfig } from "../config.js";
import PG from "pg";
import { PG_POOL, REDIS } from "./tokens.js";
import { Redis } from "ioredis";

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () =>
        new PG.Pool({ connectionString: loadConfig().DATABASE_URL }),
    },
    { provide: REDIS, useFactory: () => {
        const client = new Redis(loadConfig().REDIS_URL);
        client.on("error", (err) => Logger.warn(`redis: ${err.message}`, "Redis"));
        return client;
    }},
  ],
  exports: [PG_POOL, REDIS],
})
export class InfraModule implements OnApplicationShutdown {
    constructor(
        @Inject(PG_POOL) private readonly pool: PG.Pool,
        @Inject(REDIS) private readonly redis: Redis
    ) {}

    async onApplicationShutdown() {
        await this.pool.end();
        await this.redis.disconnect();
    }
}
