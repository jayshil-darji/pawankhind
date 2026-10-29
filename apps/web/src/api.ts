import type { z } from "zod";
import type { registrationRequestSchema } from "@pawankhind/schemas";

export type ParticipantInput = z.input<typeof registrationRequestSchema>;

export interface CheckoutDetails {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
}
export interface StartResponse {
  registrationId: string;
  holdExpiresAt: string;
  checkout: CheckoutDetails;
  resumed: boolean;
}
export type VerifyResponse = { status: "confirmed"; bib: number } | { status: "pending" };

export interface FieldIssue {
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  readonly issues: FieldIssue[];

  constructor(httpStatus: number, code: string, issues: FieldIssue[] = []) {
    super(code);
    this.httpStatus = httpStatus;
    this.code = code;
    this.issues = issues;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as {
    code?: string;
    issues?: FieldIssue[];
  };
  if (!res.ok) {
    throw new ApiError(res.status, body.code ?? "unknown_error", body.issues ?? []);
  }
  return body as T;
}

export function startRegistration(participant: ParticipantInput): Promise<StartResponse> {
  return request<StartResponse>("/api/registrations", {
    method: "POST",
    body: JSON.stringify(participant),
  });
}

export function verifyPayment(input: {
  registrationId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): Promise<VerifyResponse> {
  return request<VerifyResponse>("/api/payments/verify", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getStatus(registrationId: string): Promise<{ status: string; bib?: number }> {
  return request(`/api/registrations/${registrationId}/status`);
}
