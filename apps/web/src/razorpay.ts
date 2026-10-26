import type { CheckoutDetails } from "./api.js";

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

export interface PaymentResult {
  razorpayPaymentId: string;
  razorpaySignature: string;
}

interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; contact: string };
  handler: (r: RazorpaySuccess) => void;
  modal: { ondismiss: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

let scriptPromise: Promise<void> | undefined;

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = SCRIPT_SRC;
    el.onload = () => resolve();
    el.onerror = () => {
      scriptPromise = undefined; // allow a retry
      reject(new Error("checkout_script_failed"));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

/** Opens Razorpay Checkout. Resolves on payment, rejects if the user closes it. */
export async function openCheckout(
  checkout: CheckoutDetails,
  prefill: { name: string; contact: string },
): Promise<PaymentResult> {
  await loadScript();
  const Razorpay = window.Razorpay;
  if (!Razorpay) throw new Error("checkout_script_failed");

  return new Promise<PaymentResult>((resolve, reject) => {
    const rzp = new Razorpay({
      key: checkout.keyId,
      order_id: checkout.orderId,
      amount: checkout.amountPaise,
      currency: checkout.currency,
      name: "Pawankhind Season 3",
      description: "5 KM run registration",
      prefill,
      handler: (r) =>
        resolve({
          razorpayPaymentId: r.razorpay_payment_id,
          razorpaySignature: r.razorpay_signature,
        }),
      modal: { ondismiss: () => reject(new Error("checkout_dismissed")) },
    });
    rzp.open();
  });
}
