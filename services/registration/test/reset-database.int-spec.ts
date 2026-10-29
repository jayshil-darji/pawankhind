import { RegistrationsRepository } from "../src/registrations/registrations.repository.js";
import { person, resetDatabase, startTestDatabase, TestDatabase } from "./support/database.js";

let db: TestDatabase;
let seededEventId: string;

// Spelled out here, not taken from RESET_TABLES, so shortening that list makes a test fail.
const EMPTIED = ["payments", "registrations", "admin_enrolments", "audit_log", "admin_users"];

async function count(table: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
  return Number(rows[0].n);
}

beforeAll(async () => {
  db = await startTestDatabase();
  seededEventId = (await db.pool.query<{ id: string }>("SELECT id FROM events")).rows[0].id;
});

afterAll(async () => {
  await db?.stop();
});

// Tests in one file run in order; the second relies on the first having left rows behind.
describe("resetDatabase", () => {
  let eventId: string;

  beforeEach(async () => {
    eventId = await resetDatabase(db.pool, { capacity: 5 });
  });

  it("leaves a registration and a payment behind (setup for the next test)", async () => {
    const held = await new RegistrationsRepository(db.pool).reserveSlot(eventId, person(1));
    if (!held.ok) throw new Error(`reserveSlot failed: ${held.reason}`);
    await db.pool.query(
      `INSERT INTO payments (registration_id, method, status, amount_paise, provider_order_id, provider_mode)
       VALUES ($1, 'razorpay', 'created', 50000, 'order_isolation', 'test')`,
      [held.registrationId],
    );

    const admin = await db.pool.query<{ id: string }>(
      "INSERT INTO admin_users (username, display_name, role) VALUES ('kit1', 'Kit', 'kit') RETURNING id",
    );
    await db.pool.query(
      `INSERT INTO admin_enrolments (admin_user_id, token_hash, expires_at)
       VALUES ($1, decode(repeat('ab', 32), 'hex'), now() + interval '1 day')`,
      [admin.rows[0].id],
    );
    await db.pool.query(
      "INSERT INTO audit_log (actor_id, actor_kind, action) VALUES ($1, 'user', 'login')",
      [admin.rows[0].id],
    );

    for (const table of EMPTIED) expect(await count(table)).toBe(1);
  });

  it("removes the previous test's rows and resets the event counters", async () => {
    for (const table of EMPTIED) expect(await count(table)).toBe(0);
    const { rows } = await db.pool.query<{ slots_taken: number; at_first: boolean }>(
      "SELECT slots_taken, next_bib = first_bib AS at_first FROM events",
    );
    expect(rows).toEqual([{ slots_taken: 0, at_first: true }]);
  });

  it("keeps the events seed row", async () => {
    const { rows } = await db.pool.query<{ id: string }>("SELECT id FROM events");

    expect(rows).toEqual([{ id: seededEventId }]);
    expect(eventId).toBe(seededEventId);
  });

  it("keeps the environment_state row and its live mark", async () => {
    await db.pool.query("UPDATE environment_state SET live_activated_at = now()");

    await resetDatabase(db.pool, { capacity: 5 });

    const { rows } = await db.pool.query<{ marked: boolean }>(
      "SELECT live_activated_at IS NOT NULL AS marked FROM environment_state",
    );
    expect(rows).toEqual([{ marked: true }]);
  });

  it("leaves audit_log's TRUNCATE guard switched on", async () => {
    await expect(db.pool.query("TRUNCATE audit_log")).rejects.toThrow(
      "audit_log is append-only: TRUNCATE refused",
    );
  });

  it("fails, rather than cascading, when an unlisted table references a reset table", async () => {
    await db.pool.query(
      "CREATE TABLE stray_child (registration_id uuid REFERENCES registrations (id))",
    );
    try {
      await expect(resetDatabase(db.pool, { capacity: 5 })).rejects.toMatchObject({
        code: "0A000",
      });
      // The failed reset rolled back, so the guard it lifted is on again.
      await expect(db.pool.query("TRUNCATE audit_log")).rejects.toThrow(
        "audit_log is append-only: TRUNCATE refused",
      );
    } finally {
      await db.pool.query("DROP TABLE stray_child");
    }
  });
});
