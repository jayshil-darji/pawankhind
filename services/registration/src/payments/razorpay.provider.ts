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
    const body = (await this.call(`/payments/${encodeURIComponent(paymentId)}`)) as {
      id?: unknown;
      order_id?: unknown;
      amount?: unknown;
      status?: unknown;
    };
    if (
      typeof body.id !== "string" ||
      typeof body.order_id !== "string" ||
      typeof body.amount !== "number" ||
      typeof body.status !== "string"
    ) {
      throw new Error("Razorpay payment response had an unexpected shape");
    }
    return { id: body.id, orderId: body.order_id, amountPaise: body.amount, status: body.status };
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    const expected = createHmac("sha256", this.config.webhookSecret).update(rawBody).digest("hex");
    return safeEqualHex(expected, signature);
  }
}
