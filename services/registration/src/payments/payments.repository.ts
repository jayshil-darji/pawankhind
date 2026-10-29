import pg from "pg";
import { withTransaction } from "../infra/transaction.js";
import { isUniqueViolation } from "../infra/db-errors.js";
import type { Config } from "../config.js";

/** The Razorpay mode a payment was created in. Stamped by the server, never by a client. */
export type ProviderMode = Config["RAZORPAY_MODE"];

export type ConfirmResult =
  | { ok: true; bib: number; registrationId: string; alreadyConfirmed: boolean }
  | {
      ok: false;
      reason: "unknown_order" | "amount_mismatch" | "no_slot" | "duplicate_registration";
    };

interface PaymentRow {
  id: string;
  registration_id: string;
  status: string;
  amount_paise: number;
}

interface RegistrationRow {
  id: string;
  event_id: string;
  status: string;
  bib_number: number | null;
}

export class PaymentsRepository {
  constructor(
    private readonly pool: pg.Pool,
    private readonly mode: ProviderMode,
  ) {}

  /** Creates the payment row for a held registration. Amount always comes from the event fee. */
  async createPaymentIntent(
    registrationId: string,
    providerOrderId: string,
  ): Promise<{ paymentId: string; amountPaise: number } | null> {
    const result = await this.pool.query<{ id: string; amount_paise: number }>(
      `INSERT INTO payments
         (registration_id, method, status, amount_paise, provider_order_id, provider_mode)
       SELECT r.id, 'razorpay', 'created', e.fee_paise, $2, $3
         FROM registrations r JOIN events e ON e.id = r.event_id
        WHERE r.id = $1 AND r.status = 'held'
       RETURNING id, amount_paise`,
      [registrationId, providerOrderId, this.mode],
    );
    const row = result.rows[0];
    return row ? { paymentId: row.id, amountPaise: row.amount_paise } : null;
  }

  /** Call only after the payment service has verified the gateway signature. */
  async confirmOnlinePayment(input: {
    providerOrderId: string;
    providerPaymentId: string;
    amountPaise: number;
  }): Promise<ConfirmResult> {
    try {
      return await this.confirmInTransaction(input);
    } catch (error) {
      if (isUniqueViolation(error, "registrations_one_active_per_person")) {
        // The same person registered again after this hold expired. Money is real: record it.
        await this.pool.query(
          `UPDATE payments
              SET status = 'captured', provider_payment_id = $2, captured_at = now()
            WHERE provider_order_id = $1 AND status <> 'captured'`,
          [input.providerOrderId, input.providerPaymentId],
        );
        return { ok: false, reason: "duplicate_registration" };
      }
      throw error;
    }
  }

  async findLatestOrder(
    registrationId: string,
  ): Promise<{ providerOrderId: string; amountPaise: number } | null> {
    const r = await this.pool.query<{ provider_order_id: string; amount_paise: number }>(
      `SELECT provider_order_id, amount_paise FROM payments
        WHERE registration_id = $1 AND method = 'razorpay' AND provider_order_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
      [registrationId],
    );
    const row = r.rows[0];
    return row ? { providerOrderId: row.provider_order_id, amountPaise: row.amount_paise } : null;
  }

  async findOrderByProviderOrderId(
    providerOrderId: string,
  ): Promise<{ providerOrderId: string; amountPaise: number } | null> {
    const r = await this.pool.query<{ provider_order_id: string; amount_paise: number }>(
      `SELECT provider_order_id, amount_paise FROM payments
        WHERE provider_order_id = $1 AND method = 'razorpay'`,
      [providerOrderId],
    );
    const row = r.rows[0];
    return row ? { providerOrderId: row.provider_order_id, amountPaise: row.amount_paise } : null;
  }

  /** Our Razorpay orders whose registration is not confirmed and not already flagged for a human. */
  async findUnconfirmedOrders(
    providerOrderIds: string[],
  ): Promise<{ providerOrderId: string; amountPaise: number }[]> {
    if (providerOrderIds.length === 0) return [];
    const r = await this.pool.query<{ provider_order_id: string; amount_paise: number }>(
      `SELECT p.provider_order_id, p.amount_paise
         FROM payments p JOIN registrations r ON r.id = p.registration_id
        WHERE p.method = 'razorpay'
          AND p.provider_order_id = ANY($1::text[])
          AND r.status <> 'confirmed'
          AND p.status <> 'captured'`,
      [providerOrderIds],
    );
    return r.rows.map((row) => ({
      providerOrderId: row.provider_order_id,
      amountPaise: row.amount_paise,
    }));
  }

  private confirmInTransaction(input: {
    providerOrderId: string;
    providerPaymentId: string;
    amountPaise: number;
  }): Promise<ConfirmResult> {
    return withTransaction(this.pool, async (client): Promise<ConfirmResult> => {
      // Lock order: payment -> registration -> event.
      const pay = await client.query<PaymentRow>(
        `SELECT id, registration_id, status, amount_paise
           FROM payments WHERE provider_order_id = $1 FOR UPDATE`,
        [input.providerOrderId],
      );
      const payment = pay.rows[0];
      if (!payment) return { ok: false, reason: "unknown_order" };

      const reg = await client.query<RegistrationRow>(
        `SELECT id, event_id, status, bib_number FROM registrations WHERE id = $1 FOR UPDATE`,
        [payment.registration_id],
      );
      const registration = reg.rows[0];

      if (payment.status === "captured" && registration.bib_number !== null) {
        return {
          ok: true,
          bib: registration.bib_number,
          registrationId: registration.id,
          alreadyConfirmed: true,
        };
      }

      if (registration.status === "confirmed") {
        // A different payment for a registration that already has its BIB: keep the money
        // on record, flag it for a human, and never touch the BIB.
        await client.query(
          `UPDATE payments
              SET status = 'captured', provider_payment_id = $2, captured_at = now()
            WHERE id = $1`,
          [payment.id, input.providerPaymentId],
        );
        return { ok: false, reason: "duplicate_registration" };
      }

      if (input.amountPaise !== payment.amount_paise) {
        return { ok: false, reason: "amount_mismatch" };
      }

      if (registration.status === "expired") {
        const retaken = await client.query(
          `UPDATE events SET slots_taken = slots_taken + 1
            WHERE id = $1 AND slots_taken < capacity`,
          [registration.event_id],
        );
        if (retaken.rowCount === 0) {
          await client.query(
            `UPDATE payments
                SET status = 'captured', provider_payment_id = $2, captured_at = now()
              WHERE id = $1`,
            [payment.id, input.providerPaymentId],
          );
          return { ok: false, reason: "no_slot" };
        }
      }

      const allocated = await client.query<{ bib: number }>(
        `UPDATE events SET next_bib = next_bib + 1
          WHERE id = $1
          RETURNING next_bib - 1 AS bib`,
        [registration.event_id],
      );
      const bib = allocated.rows[0].bib;

      await client.query(
        `UPDATE registrations
            SET status = 'confirmed', bib_number = $2, confirmed_at = now()
          WHERE id = $1`,
        [registration.id, bib],
      );
      await client.query(
        `UPDATE payments
            SET status = 'captured', provider_payment_id = $2, captured_at = now()
          WHERE id = $1`,
        [payment.id, input.providerPaymentId],
      );

      return { ok: true, bib, registrationId: registration.id, alreadyConfirmed: false };
    });
  }
}
