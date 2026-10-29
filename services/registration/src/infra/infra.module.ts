import { Global, Inject, Logger, Module, OnApplicationShutdown } from "@nestjs/common";
import { loadConfig, type Config } from "../config.js";
import PG from "pg";
import { APP_CONFIG, PG_POOL, REDIS } from "./tokens.js";
import { LiveModeMarker } from "./live-mode-marker.js";
import { Redis } from "ioredis";

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => new PG.Pool({ connectionString: loadConfig().DATABASE_URL }),
    },
    {
      provide: REDIS,
      useFactory: () => {
        const client = new Redis(loadConfig().REDIS_URL);
        client.on("error", (err) => Logger.warn(`redis: ${err.message}`, "Redis"));
        return client;
      },
    },
    {
      provide: APP_CONFIG,
      useFactory: () => loadConfig(),
    },
    {
      provide: LiveModeMarker,
      useFactory: (pool: PG.Pool, config: Config) => new LiveModeMarker(pool, config),
      inject: [PG_POOL, APP_CONFIG],
    },
  ],
  exports: [PG_POOL, REDIS, APP_CONFIG],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly pool: PG.Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown() {
    await this.pool.end();
    this.redis.disconnect();
  }
}
