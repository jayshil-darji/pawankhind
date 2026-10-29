import { Logger, type OnApplicationBootstrap } from "@nestjs/common";
import type pg from "pg";
import type { Config } from "../config.js";

/**
 * Records, once and for ever, that this environment has started in live mode. The pre-launch
 * reset script refuses to run once the mark exists. If the mark cannot be written, the app
 * does not start: a live environment must never be able to look unused.
 */
export class LiveModeMarker implements OnApplicationBootstrap {
  private readonly log = new Logger(LiveModeMarker.name);

  constructor(
    private readonly pool: pg.Pool,
    private readonly config: Pick<Config, "RAZORPAY_MODE">,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.RAZORPAY_MODE !== "live") return;

    const marked = await this.pool.query(
      "UPDATE environment_state SET live_activated_at = now() WHERE live_activated_at IS NULL",
    );
    if (marked.rowCount) this.log.log("first live start recorded");
  }
}
