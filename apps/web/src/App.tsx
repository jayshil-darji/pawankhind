import { useState } from "react";
import {
  ApiError,
  getStatus,
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
  | { kind: "confirming"; registrationId: string }
  | { kind: "done"; bib: number }
  | { kind: "problem"; registrationId: string; message: string };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function messageFor(e: ApiError): string {
  if (e.code === "closed" || e.code === "no_event") return "Registration is not open right now.";
  if (e.code === "sold_out") return "Sorry, all places are taken.";
  if (e.code === "already_registered")
    return "This person is already registered, or a payment is in progress. If you just closed the payment window, please wait 15 minutes and try again.";
  if (e.httpStatus === 409) return "A registration with these details already exists.";
  if (e.httpStatus === 502) return "The payment service is unavailable. Please try again shortly.";
  return "Something went wrong. Please try again.";
}

export default function App() {
  const [view, setView] = useState<View>({ kind: "form" });
  const [banner, setBanner] = useState<string | null>(null);

  async function waitForConfirmation(registrationId: string) {
    for (let i = 0; i < 10; i++) {
      await sleep(3000);
      const s = await getStatus(registrationId).catch(() => undefined);
      if (s?.status === "confirmed" && s.bib !== undefined) {
        setView({ kind: "done", bib: s.bib });
        return;
      }
    }
    setView({
      kind: "problem",
      registrationId,
      message:
        "We have not received confirmation yet. If money was deducted, keep this reference and contact the organisers.",
    });
  }

  async function finish(registrationId: string, result: PaymentResult) {
    setView({ kind: "confirming", registrationId });
    try {
      const out = await verifyPayment({
        registrationId,
        razorpayPaymentId: result.razorpayPaymentId,
        razorpaySignature: result.razorpaySignature,
      });
      if (out.status === "confirmed") setView({ kind: "done", bib: out.bib });
      else await waitForConfirmation(registrationId);
    } catch (e) {
      const message =
        e instanceof ApiError && e.code === "needs_support"
          ? "Payment received but registration could not be completed. Contact the organisers with this reference."
          : "We could not confirm your payment. If money was deducted, contact the organisers with this reference.";
      setView({ kind: "problem", registrationId, message });
    }
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
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-2xl font-bold">Pawankhind Season 3 · 5 KM Run</h1>
      <p className="mb-6 mt-1 text-sm text-slate-600">
        Sunday 17 January 2027 · Fee ₹200 · No refunds, no BIB transfer
      </p>

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

      {view.kind === "done" && (
        <div className="rounded-lg border border-green-300 bg-green-50 p-6 text-center">
          <p className="text-sm text-green-800">You are registered. Your BIB number</p>
          <p className="my-2 text-5xl font-bold">{view.bib}</p>
          <p className="text-sm text-slate-600">
            Collect your kit 15 to 17 January. Carry a photo ID.
          </p>
        </div>
      )}

      {view.kind === "problem" && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4">
          <p>{view.message}</p>
          <p className="mt-2 text-sm">
            Reference: <code>{view.registrationId}</code>
          </p>
        </div>
      )}
    </main>
  );
}
