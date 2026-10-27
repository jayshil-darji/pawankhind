import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentProvider, ProviderPayment } from "./payment-provider.js";

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

const API = "https://api.razorpay.com/v1";

function safeEqualHex(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function toProviderPayment(raw: unknown): ProviderPayment | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as { id?: unknown; order_id?: unknown; amount?: unknown; status?: unknown };
  if (
    typeof b.id !== "string" ||
    typeof b.order_id !== "string" ||
    typeof b.amount !== "number" ||
    typeof b.status !== "string"
  ) {
    return null;
  }
  return { id: b.id, orderId: b.order_id, amountPaise: b.amount, status: b.status };
}

export class RazorpayProvider implements PaymentProvider {
  constructor(
    private readonly config: RazorpayConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private authHeader(): string {
    const token = Buffer.from(`${this.config.keyId}:${this.config.keySecret}`).toString("base64");
    return `Basic ${token}`;
  }

  private async call(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.fetchImpl(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      // Never include request headers or the secret in the error.
      throw new Error(
        `Razorpay request failed: ${init.method ?? "GET"} ${path} -> ${response.status}`,
      );
    }
    return response.json();
  }

  async createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<{ orderId: string }> {
    const body = await this.call("/orders", {
      method: "POST",
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: "INR",
        receipt: input.receipt.slice(0, 40),
        notes: input.notes ?? {},
      }),
    });
    const id = (body as { id?: unknown }).id;
    if (typeof id !== "string") throw new Error("Razorpay order response had no id");
    return { orderId: id };
  }

  verifyCheckoutSignature(input: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean {
    const expected = createHmac("sha256", this.config.keySecret)
      .update(`${input.orderId}|${input.paymentId}`)
      .digest("hex");
    return safeEqualHex(expected, input.signature);
  }

  async fetchPayment(paymentId: string): Promise<ProviderPayment> {
    const payment = toProviderPayment(
      await this.call(`/payments/${encodeURIComponent(paymentId)}`),
    );
    if (!payment) throw new Error("Razorpay payment response had an unexpected shape");
    return payment;
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    const expected = createHmac("sha256", this.config.webhookSecret).update(rawBody).digest("hex");
    return safeEqualHex(expected, signature);
  }

  async listPayments(input: { fromUnix: number; toUnix: number }): Promise<ProviderPayment[]> {
    const PAGE = 100;
    const MAX_PAGES = 20;
    const payments: ProviderPayment[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = (await this.call(
        `/payments?from=${input.fromUnix}&to=${input.toUnix}&count=${PAGE}&skip=${page * PAGE}`,
      )) as { items?: unknown };
      if (!Array.isArray(body.items)) {
        throw new Error("Razorpay payments list had an unexpected shape");
      }
      for (const raw of body.items) {
        const payment = toProviderPayment(raw); // payments without an order id are skipped
        if (payment) payments.push(payment);
      }
      if (body.items.length < PAGE) break;
    }
    return payments;
  }
}
