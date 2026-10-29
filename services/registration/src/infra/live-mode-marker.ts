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

    // An UPDATE that matched nothing proves nothing: the row may be gone (TRUNCATE does not
    // fire the delete trigger). Read the mark back and refuse to run live without it.
    const check = await this.pool.query<{ live_activated_at: Date | null }>(
      "SELECT live_activated_at FROM environment_state",
    );
    if (check.rows.length !== 1 || check.rows[0].live_activated_at === null) {
      throw new Error("environment_state has no live mark; refusing to start in live mode");
    }
  }
}
