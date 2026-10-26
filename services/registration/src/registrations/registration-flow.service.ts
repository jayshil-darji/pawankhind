import { BadGatewayException, Injectable } from "@nestjs/common";
import type { PaymentProvider } from "../payments/payment-provider.js";
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

@Injectable()
export class RegistrationFlow {
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

    let remote;
    try {
      remote = await this.provider.fetchPayment(input.paymentId);
    } catch {
      throw new BadGatewayException({ code: "provider_unavailable", message: "Please retry." });
    }
    if (remote.orderId !== order.providerOrderId || remote.amountPaise !== order.amountPaise) {
      return { kind: "mismatch" };
    }
    if (remote.status !== "captured") return { kind: "pending" };

    const result = await this.payments.confirmOnlinePayment({
      providerOrderId: order.providerOrderId,
      providerPaymentId: input.paymentId,
      amountPaise: remote.amountPaise,
    });
    if (result.ok) return { kind: "confirmed", bib: result.bib };
    if (result.reason === "unknown_order") return { kind: "unknown" };
    if (result.reason === "amount_mismatch") return { kind: "mismatch" };
    return { kind: "needs_support" };
  }
}
