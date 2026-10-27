import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import type { RegistrationFlow } from "../registrations/registration-flow.service.js";
import type { PaymentProvider } from "./payment-provider.js";
import type { PaymentsRepository } from "./payments.repository.js";

export interface ReconciliationResult {
  confirmed: number;
  needsHuman: number;
}

export class ReconciliationJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(ReconciliationJob.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly reported = new Set<string>();

  /** intervalMs <= 0 means: no timer (tests call tick() themselves). */
  constructor(
    private readonly flow: RegistrationFlow,
    private readonly payments: PaymentsRepository,
    private readonly provider: PaymentProvider,
    private readonly intervalMs: number,
    private readonly lookbackSeconds: number,
  ) {}

  onApplicationBootstrap() {
    if (this.intervalMs <= 0) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass. Never throws. */
  async tick(): Promise<ReconciliationResult> {
    const result: ReconciliationResult = { confirmed: 0, needsHuman: 0 };
    if (this.running) return result;
    this.running = true;
    try {
      const now = Math.floor(Date.now() / 1000);
      const listed = await this.provider.listPayments({
        fromUnix: now - this.lookbackSeconds,
        toUnix: now,
      });
      const captured = listed.filter((p) => p.status === "captured");
      const open = await this.payments.findUnconfirmedOrders(captured.map((p) => p.orderId));
      this.log.log(
        `pass: ${captured.length} captured payment(s) listed, ${open.length} awaiting confirmation`,
      );
      const byOrder = new Map(open.map((o) => [o.providerOrderId, o]));

      for (const payment of captured) {
        const order = byOrder.get(payment.orderId);
        if (!order) continue;
        const outcome = await this.flow.confirmFetched(order, payment);
        if (outcome.kind === "confirmed") {
          result.confirmed += 1;
          this.log.log(`reconciled payment ${payment.id} (order ${payment.orderId})`);
        } else if (!this.reported.has(payment.id)) {
          this.reported.add(payment.id);
          result.needsHuman += 1;
          this.log.error(
            `payment ${payment.id} on order ${payment.orderId} is captured but ${outcome.kind}: needs a human`,
          );
        }
      }
      return result;
    } catch (error) {
      this.log.error(
        `reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { confirmed: 0, needsHuman: 0 };
    } finally {
      this.running = false;
    }
  }
}
