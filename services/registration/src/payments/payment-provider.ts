export interface ProviderPayment {
  id: string;
  orderId: string;
  amountPaise: number;
  status: string;
}

export interface PaymentProvider {
  createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<{ orderId: string }>;

  /** Verifies the signature Checkout returned. `orderId` must come from OUR database. */
  verifyCheckoutSignature(input: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean;

  fetchPayment(paymentId: string): Promise<ProviderPayment>;

  /** Verifies a webhook against the RAW request body. */
  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean;
}
