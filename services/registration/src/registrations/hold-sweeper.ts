import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import type { RegistrationsRepository } from "./registrations.repository.js";

export class HoldSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(HoldSweeper.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  /** intervalMs <= 0 means: do not start a timer (tests call tick() themselves). */
  constructor(
    private readonly registrations: RegistrationsRepository,
    private readonly intervalMs: number,
  ) {}

  onApplicationBootstrap() {
    if (this.intervalMs <= 0) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One sweep. Never throws. Returns how many holds were released. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const released = await this.registrations.releaseExpiredHolds();
      if (released > 0) this.log.log(`released ${released} expired hold(s)`);
      return released;
    } catch (error) {
      this.log.error(`sweep failed: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
