import pg from "pg";
import { withTransaction } from "../infra/transaction.js";
import { isUniqueViolation } from "../infra/db-errors.js";

export interface ParticipantInput {
  fullName: string;
  dateOfBirth: string; // YYYY-MM-DD
  gender: "male" | "female" | "other";
  mobile: string;
  tshirtSize: "XS" | "S" | "M" | "L" | "XL" | "XXL";
  city: string;
  emergencyContactName: string;
  emergencyContactMobile: string;
}

export type ReserveResult =
  | { ok: true; registrationId: string; holdExpiresAt: Date }
  | { ok: false; reason: "sold_out" | "closed" | "already_registered" };

const HOLD_MINUTES = 10;

export class RegistrationsRepository {
  constructor(private readonly pool: pg.Pool) {}

  async reserveSlot(eventId: string, p: ParticipantInput): Promise<ReserveResult> {
    try {
      return await withTransaction(this.pool, async (client) => {
        const slot = await client.query(
          `UPDATE events
              SET slots_taken = slots_taken + 1
            WHERE id = $1
              AND slots_taken < capacity
              AND now() >= reg_opens_at
              AND now() <= reg_closes_at`,
          [eventId],
        );

        if (slot.rowCount === 0) {
          const why = await client.query<{ full: boolean }>(
            `SELECT slots_taken >= capacity AS full FROM events WHERE id = $1`,
            [eventId],
          );
          return { ok: false, reason: why.rows[0]?.full ? "sold_out" : "closed" } as const;
        }

        const inserted = await client.query(
          `INSERT INTO registrations
             (event_id, status, channel, full_name, date_of_birth, gender, mobile,
              tshirt_size, city, emergency_contact_name, emergency_contact_mobile, hold_expires_at)
           VALUES ($1, 'held', 'online', $2, $3, $4, $5, $6, $7, $8, $9,
                   now() + make_interval(mins => $10))
           RETURNING id, hold_expires_at`,
          [
            eventId,
            p.fullName,
            p.dateOfBirth,
            p.gender,
            p.mobile,
            p.tshirtSize,
            p.city,
            p.emergencyContactName,
            p.emergencyContactMobile,
            HOLD_MINUTES,
          ],
        );

        const row = inserted.rows[0] as { id: string; hold_expires_at: Date };
        return { ok: true, registrationId: row.id, holdExpiresAt: row.hold_expires_at } as const;
      });
    } catch (error) {
      if (isUniqueViolation(error, "registrations_one_active_per_person")) {
        return { ok: false, reason: "already_registered" };
      }
      throw error;
    }
  }

  /** Expires overdue holds and returns their slots. Returns how many were expired. */
  async releaseExpiredHolds(limit = 500): Promise<number> {
    const result = await this.pool.query<{ released: number }>(
      `WITH expired AS (
         UPDATE registrations
            SET status = 'expired'
          WHERE id IN (
            SELECT id FROM registrations
             WHERE status = 'held' AND hold_expires_at < now()
             ORDER BY hold_expires_at
             LIMIT $1
             FOR UPDATE SKIP LOCKED)
          RETURNING event_id
       ), per_event AS (
         SELECT event_id, count(*)::int AS n FROM expired GROUP BY event_id
       ), released AS (
         UPDATE events e
            SET slots_taken = e.slots_taken - p.n
           FROM per_event p
          WHERE e.id = p.event_id
          RETURNING p.n
       )
       SELECT coalesce(sum(n), 0)::int AS released FROM released`,
      [limit],
    );
    return result.rows[0].released;
  }

  async getCurrentEvent(): Promise<{ id: string; feePaise: number } | null> {
    const r = await this.pool.query<{ id: string; fee_paise: number }>(
      "SELECT id, fee_paise FROM events ORDER BY event_date DESC LIMIT 1",
    );
    const row = r.rows[0];
    return row ? { id: row.id, feePaise: row.fee_paise } : null;
  }

  /** Releases one hold immediately (used when payment setup fails). */
  async abandonHold(registrationId: string): Promise<void> {
    await this.pool.query(
      `WITH gone AS (
         UPDATE registrations SET status = 'expired'
          WHERE id = $1 AND status = 'held'
          RETURNING event_id)
       UPDATE events e SET slots_taken = e.slots_taken - 1
         FROM gone WHERE e.id = gone.event_id`,
      [registrationId],
    );
  }

  async getPublicStatus(
    registrationId: string,
  ): Promise<{ status: string; bib: number | null } | null> {
    const r = await this.pool.query<{ status: string; bib_number: number | null }>(
      "SELECT status, bib_number FROM registrations WHERE id = $1",
      [registrationId],
    );
    const row = r.rows[0];
    return row ? { status: row.status, bib: row.bib_number } : null;
  }

  /** The person's own hold, if it is still live. Matches the "one active per person" index. */
  async findLiveHold(
    eventId: string,
    p: ParticipantInput,
  ): Promise<{ registrationId: string; holdExpiresAt: Date } | null> {
    const r = await this.pool.query<{ id: string; hold_expires_at: Date }>(
      `SELECT id, hold_expires_at FROM registrations
        WHERE event_id = $1 AND status = 'held' AND hold_expires_at > now()
          AND mobile = $2 AND lower(btrim(full_name)) = lower(btrim($3))
          AND date_of_birth = $4`,
      [eventId, p.mobile, p.fullName, p.dateOfBirth],
    );
    const row = r.rows[0];
    return row ? { registrationId: row.id, holdExpiresAt: row.hold_expires_at } : null;
  }
}
