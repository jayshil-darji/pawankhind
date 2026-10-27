import { BadGatewayException, Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import type { PaymentProvider, ProviderPayment } from "../payments/payment-provider.js";
import type { PaymentsRepository } from "../payments/payments.repository.js";
import type { ParticipantInput, RegistrationsRepository } from "./registrations.repository.js";

export type StartResult =
  | {
      ok: true;
      registrationId: string;
      holdExpiresAt: Date;
      order: { orderId: string; amountPaise: number; currency: "INR" };
    }
  | { ok: false; reason: "sold_out" | "closed" | "already_registered" | "no_event" };

export type VerifyOutcome =
  | { kind: "confirmed"; bib: number }
  | { kind: "pending" }
  | { kind: "bad_signature" | "unknown" | "mismatch" | "needs_support" };

export type WebhookOutcome = VerifyOutcome | { kind: "bad_payload" | "ignored" };

const HANDLED_EVENTS = new Set(["payment.captured", "order.paid"]);

const webhookSchema = z.object({
  event: z.string(),
  payload: z
    .object({
      payment: z.object({ entity: z.object({ id: z.string().min(1) }) }).optional(),
    })
    .optional(),
});

@Injectable()
export class RegistrationFlow {
  private readonly log = new Logger(RegistrationFlow.name);

  constructor(
    private readonly registrations: RegistrationsRepository,
    private readonly payments: PaymentsRepository,
    private readonly provider: PaymentProvider,
  ) {}

  async start(participant: ParticipantInput): Promise<StartResult> {
    const event = await this.registrations.getCurrentEvent();
    if (!event) return { ok: false, reason: "no_event" };

    const reserved = await this.registrations.reserveSlot(event.id, participant);
    if (!reserved.ok) return reserved;

    try {
      const order = await this.provider.createOrder({
        amountPaise: event.feePaise,
        receipt: reserved.registrationId,
        notes: { registrationId: reserved.registrationId },
      });
      const intent = await this.payments.createPaymentIntent(
        reserved.registrationId,
        order.orderId,
      );
      if (!intent || intent.amountPaise !== event.feePaise) {
        throw new Error("payment intent does not match the event fee");
      }
      return {
        ok: true,
        registrationId: reserved.registrationId,
        holdExpiresAt: reserved.holdExpiresAt,
        order: { orderId: order.orderId, amountPaise: intent.amountPaise, currency: "INR" },
      };
    } catch {
      await this.registrations.abandonHold(reserved.registrationId);
      throw new BadGatewayException({ code: "payment_setup_failed", message: "Please try again." });
    }
  }

  async verify(input: {
    registrationId: string;
    paymentId: string;
    signature: string;
  }): Promise<VerifyOutcome> {
    const order = await this.payments.findLatestOrder(input.registrationId);
    if (!order) return { kind: "unknown" };

    const signatureOk = this.provider.verifyCheckoutSignature({
      orderId: order.providerOrderId,
      paymentId: input.paymentId,
      signature: input.signature,
    });
    if (!signatureOk) return { kind: "bad_signature" };

    const remote = await this.fetchRemote(input.paymentId);
    return this.confirmFetched(order, remote);
  }

  /** Razorpay -> us. `rawBody` must be the exact bytes received. */
  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<WebhookOutcome> {
    if (!rawBody || !signature || !this.provider.verifyWebhookSignature(rawBody, signature)) {
      return { kind: "bad_signature" };
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return { kind: "bad_payload" };
    }
    const parsed = webhookSchema.safeParse(json);
    if (!parsed.success) return { kind: "bad_payload" };

    const paymentId = parsed.data.payload?.payment?.entity.id;
    if (!HANDLED_EVENTS.has(parsed.data.event) || !paymentId) return { kind: "ignored" };

    // Trust the Razorpay API, not the webhook body, for order, amount and status.
    const remote = await this.fetchRemote(paymentId);
    const order = await this.payments.findOrderByProviderOrderId(remote.orderId);
    if (!order) {
      this.log.warn(`webhook for unknown order ${remote.orderId}`);
      return { kind: "unknown" };
    }

    const outcome = await this.confirmFetched(order, remote);
    if (outcome.kind === "needs_support" || outcome.kind === "mismatch") {
      this.log.error(
        `payment ${paymentId} on order ${remote.orderId}: ${outcome.kind}, needs a human`,
      );
    }
    return outcome;
  }

  private async fetchRemote(paymentId: string): Promise<ProviderPayment> {
    try {
      return await this.provider.fetchPayment(paymentId);
    } catch {
      throw new BadGatewayException({ code: "provider_unavailable", message: "Please retry." });
    }
  }

  private async confirmFetched(
    order: { providerOrderId: string; amountPaise: number },
    remote: ProviderPayment,
  ): Promise<VerifyOutcome> {
    if (remote.orderId !== order.providerOrderId || remote.amountPaise !== order.amountPaise) {
      return { kind: "mismatch" };
    }
    if (remote.status !== "captured") return { kind: "pending" };

    const result = await this.payments.confirmOnlinePayment({
      providerOrderId: order.providerOrderId,
      providerPaymentId: remote.id,
      amountPaise: remote.amountPaise,
    });
    if (result.ok) return { kind: "confirmed", bib: result.bib };
    if (result.reason === "unknown_order") return { kind: "unknown" };
    if (result.reason === "amount_mismatch") return { kind: "mismatch" };
    return { kind: "needs_support" };
  }
}
