import { RazorpayProvider } from "../src/payments/razorpay.provider.js";

const config = { keyId: "rzp_test_abc", keySecret: "test_secret", webhookSecret: "whsec_test" };

function provider(fetchImpl?: typeof fetch) {
  return new RazorpayProvider(config, fetchImpl);
}

describe("checkout signature", () => {
  // Known-answer: HMAC-SHA256("test_secret", "order_ABC|pay_XYZ")
  const good = "15656b40fea6f2159b578efa459e969de9f5e223fb8a08393e274ac578d9d005";

  it("accepts the correct signature", () => {
    expect(
      provider().verifyCheckoutSignature({
        orderId: "order_ABC",
        paymentId: "pay_XYZ",
        signature: good,
      }),
    ).toBe(true);
  });

  it("rejects a signature for a different order", () => {
    expect(
      provider().verifyCheckoutSignature({
        orderId: "order_OTHER",
        paymentId: "pay_XYZ",
        signature: good,
      }),
    ).toBe(false);
  });

  it("rejects a signature for a different payment", () => {
    expect(
      provider().verifyCheckoutSignature({
        orderId: "order_ABC",
        paymentId: "pay_OTHER",
        signature: good,
      }),
    ).toBe(false);
  });

  it("rejects garbage and wrong-length signatures without throwing", () => {
    expect(
      provider().verifyCheckoutSignature({
        orderId: "order_ABC",
        paymentId: "pay_XYZ",
        signature: "nope",
      }),
    ).toBe(false);
    expect(
      provider().verifyCheckoutSignature({
        orderId: "order_ABC",
        paymentId: "pay_XYZ",
        signature: "",
      }),
    ).toBe(false);
  });
});

describe("webhook signature", () => {
  const body = '{"event":"order.paid"}';
  const good = "1bd3788d3c7f6e6a85fcb09f9c84a3e7cc87040ce1751fd9331dff21a5d4d275";

  it("accepts the right signature for the exact raw body", () => {
    expect(provider().verifyWebhookSignature(body, good)).toBe(true);
    expect(provider().verifyWebhookSignature(Buffer.from(body), good)).toBe(true);
  });

  it("rejects when the body differs by even one character", () => {
    expect(provider().verifyWebhookSignature('{"event":"order.paid" }', good)).toBe(false);
  });
});

describe("createOrder and fetchPayment", () => {
  it("sends Basic auth, paise amount and INR, and returns the order id", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify({ id: "order_123" }), { status: 200 }));
    }) as unknown as typeof fetch;

    const result = await provider(fake).createOrder({ amountPaise: 20000, receipt: "reg-1" });

    expect(result).toEqual({ orderId: "order_123" });
    expect(calls[0].url).toBe("https://api.razorpay.com/v1/orders");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("rzp_test_abc:test_secret").toString("base64")}`,
    );
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({
      amount: 20000,
      currency: "INR",
      receipt: "reg-1",
    });
  });

  it("fails without leaking the secret when Razorpay returns an error", async () => {
    const fake = (() =>
      Promise.resolve(new Response("{}", { status: 401 }))) as unknown as typeof fetch;
    const error = await provider(fake)
      .createOrder({ amountPaise: 20000, receipt: "r" })
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("401");
    expect((error as Error).message).not.toContain("test_secret");
  });

  it("maps a payment response and rejects an unexpected shape", async () => {
    const ok = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ id: "pay_1", order_id: "order_1", amount: 20000, status: "captured" }),
          { status: 200 },
        ),
      )) as unknown as typeof fetch;
    expect(await provider(ok).fetchPayment("pay_1")).toEqual({
      id: "pay_1",
      orderId: "order_1",
      amountPaise: 20000,
      status: "captured",
    });

    const bad = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "pay_1" }), { status: 200 }),
      )) as unknown as typeof fetch;
    await expect(provider(bad).fetchPayment("pay_1")).rejects.toThrow("unexpected shape");
  });
});

describe("listPayments", () => {
  const item = (id: string, order: string | null) => ({
    id,
    order_id: order,
    amount: 20000,
    status: "captured",
  });
  const respond = (items: unknown[]) =>
    new Response(JSON.stringify({ entity: "collection", count: items.length, items }), {
      status: 200,
    });

  it("maps payments, skips ones without an order, and sends the time window", async () => {
    const urls: string[] = [];
    const fake = ((url: string) => {
      urls.push(url);
      return Promise.resolve(respond([item("pay_1", "order_1"), item("pay_2", null)]));
    }) as unknown as typeof fetch;

    const result = await provider(fake).listPayments({ fromUnix: 1000, toUnix: 2000 });

    expect(result).toEqual([
      { id: "pay_1", orderId: "order_1", amountPaise: 20000, status: "captured" },
    ]);
    expect(urls).toEqual([
      "https://api.razorpay.com/v1/payments?from=1000&to=2000&count=100&skip=0",
    ]);
  });

  it("keeps paging until it gets a short page", async () => {
    const pages = [
      Array.from({ length: 100 }, (_, i) => item(`pay_${i}`, `order_${i}`)),
      [item("pay_last", "order_last")],
    ];
    const urls: string[] = [];
    const fake = ((url: string) => {
      urls.push(url);
      return Promise.resolve(respond(pages[urls.length - 1]));
    }) as unknown as typeof fetch;

    const result = await provider(fake).listPayments({ fromUnix: 1, toUnix: 2 });

    expect(result).toHaveLength(101);
    expect(urls[1]).toContain("skip=100");
  });

  it("fails on a response that is not a list", async () => {
    const fake = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ nope: true }), { status: 200 }),
      )) as unknown as typeof fetch;

    await expect(provider(fake).listPayments({ fromUnix: 1, toUnix: 2 })).rejects.toThrow(
      "unexpected shape",
    );
  });
});
