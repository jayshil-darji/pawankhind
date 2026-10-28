import { useState } from "react";
import { useNavigate } from "react-router";
import {
  ApiError,
  startRegistration,
  verifyPayment,
  type FieldIssue,
  type ParticipantInput,
  type StartResponse,
} from "./api.js";
import { openCheckout, type PaymentResult } from "./razorpay.js";
import { RegistrationForm } from "./RegistrationForm.js";

type View =
  | { kind: "form" }
  | { kind: "payment"; start: StartResponse; participant: ParticipantInput }
  | { kind: "confirming" };

function messageFor(e: ApiError): string {
  if (e.code === "closed" || e.code === "no_event") return "Registration is not open right now.";
  if (e.code === "sold_out") return "Sorry, all places are taken.";
  if (e.code === "already_registered") return "This person is already registered.";
  if (e.code === "setup_in_progress")
    return "Your registration is being set up. Please try again in a few seconds.";
  if (e.code === "rate_limited")
    return "Too many attempts. Please wait a few minutes and try again.";
  if (e.httpStatus === 409) return "A registration with these details already exists.";
  if (e.httpStatus === 502) return "The payment service is unavailable. Please try again shortly.";
  return "Something went wrong. Please try again.";
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>({ kind: "form" });
  const [banner, setBanner] = useState<string | null>(null);

  async function finish(registrationId: string, result: PaymentResult) {
    setView({ kind: "confirming" });
    let supportNotice = false;
    try {
      await verifyPayment({
        registrationId,
        razorpayPaymentId: result.razorpayPaymentId,
        razorpaySignature: result.razorpaySignature,
      });
    } catch (e) {
      // Even if verify failed, go to the result page: the webhook or reconciliation may still confirm.
      supportNotice = e instanceof ApiError && e.code === "needs_support";
    }
    void navigate(`/registration/${registrationId}`, { state: { supportNotice } });
  }

  async function pay(start: StartResponse, participant: ParticipantInput) {
    setView({ kind: "payment", start, participant });
    let result: PaymentResult;
    try {
      result = await openCheckout(start.checkout, {
        name: participant.fullName,
        contact: participant.mobile,
      });
    } catch {
      setBanner(
        "Payment was not completed. Your place is held for a short time, so you can try again.",
      );
      return;
    }
    setBanner(null);
    await finish(start.registrationId, result);
  }

  async function begin(participant: ParticipantInput): Promise<FieldIssue[] | undefined> {
    setBanner(null);
    try {
      const start = await startRegistration(participant);
      if (start.resumed)
        setBanner("Your earlier registration is still being held. Continuing with payment.");
      await pay(start, participant);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "invalid_request") return e.issues;
        setBanner(messageFor(e));
      } else {
        setBanner("Something went wrong. Please try again.");
      }
    }
    return undefined;
  }

  return (
    <>
      {banner && (
        <p role="alert" className="mb-4 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
          {banner}
        </p>
      )}

      {view.kind === "form" && <RegistrationForm onSubmit={begin} />}

      {view.kind === "payment" && (
        <div className="space-y-3">
          <p>
            Your place is held until{" "}
            <strong>{new Date(view.start.holdExpiresAt).toLocaleTimeString()}</strong>.
          </p>
          <button
            className="w-full rounded-lg bg-slate-900 px-4 py-3 font-medium text-white"
            onClick={() => void pay(view.start, view.participant)}
          >
            Pay ₹{view.start.checkout.amountPaise / 100}
          </button>
        </div>
      )}

      {view.kind === "confirming" && <p>Confirming your payment… please do not close this page.</p>}
    </>
  );
}
