import type pg from "pg";
import {
  applyDownMigration,
  applyMigration,
  insertRegistration,
  startTestDatabase,
  TestDatabase,
} from "./support/database.js";

const MIGRATION = "006_admin_auth_audit.sql";

async function eventIdOf(pool: pg.Pool): Promise<string> {
  return (await pool.query<{ id: string }>("SELECT id FROM events")).rows[0].id;
}

async function exists(pool: pg.Pool, table: string): Promise<boolean> {
  const { rows } = await pool.query<{ found: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS found",
    [table],
  );
  return rows[0].found;
}

async function columnType(pool: pg.Pool, table: string, column: string): Promise<string> {
  const { rows } = await pool.query<{ data_type: string }>(
    "SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = $2",
    [table, column],
  );
  return rows[0].data_type;
}

const snapshot = async (pool: pg.Pool) => ({
  registrations: (await pool.query("SELECT * FROM registrations ORDER BY id")).rows,
  payments: (await pool.query("SELECT * FROM payments ORDER BY id")).rows,
});

describe("migration 006 on a database with existing rows (at 005)", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase({ upTo: "005_environment_state.sql" });
  });

  afterAll(async () => {
    await db?.stop();
  });

  it("keeps every existing row unchanged and switches the operator columns to uuid", async () => {
    const eventId = await eventIdOf(db.pool);
    const held = await insertRegistration(db.pool, eventId, 1, "held");
    await insertRegistration(db.pool, eventId, 2, "expired");
    const confirmed = await insertRegistration(db.pool, eventId, 3, "confirmed");
    await db.pool.query(
      `INSERT INTO payments (registration_id, method, status, amount_paise, provider_order_id, provider_mode)
       VALUES ($1, 'razorpay', 'created', 20000, 'order_held', 'test')`,
      [held],
    );
    await db.pool.query(
      `INSERT INTO payments (registration_id, method, status, amount_paise, provider_order_id,
                             provider_payment_id, provider_mode, captured_at)
       VALUES ($1, 'razorpay', 'captured', 20000, 'order_paid', 'pay_paid', 'test', now())`,
      [confirmed],
    );
    const before = await snapshot(db.pool);

    await applyMigration(db.pool, MIGRATION);

    expect(await snapshot(db.pool)).toEqual(before);
    expect(before.registrations).toHaveLength(3);
    expect(before.payments).toHaveLength(2);
    expect(await columnType(db.pool, "registrations", "entered_by")).toBe("uuid");
    expect(await columnType(db.pool, "payments", "collected_by")).toBe("uuid");
    for (const table of ["admin_users", "admin_enrolments", "audit_log"]) {
      expect(await exists(db.pool, table)).toBe(true);
    }
  });
});

describe("migration 006 on a database with retired values", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase({ upTo: "005_environment_state.sql" });
  });

  afterAll(async () => {
    await db?.stop();
  });

  it("refuses with counts only and applies nothing", async () => {
    const eventId = await eventIdOf(db.pool);
    const upi = await insertRegistration(db.pool, eventId, 1, "confirmed", {
      channel: "admin_upi",
      enteredBy: "Desk Volunteer",
    });
    await db.pool.query(
      `INSERT INTO payments (registration_id, method, status, amount_paise, provider_mode, reference, captured_at)
       VALUES ($1, 'upi_manual', 'captured', 20000, 'test', 'UTR-SECRET-123', now())`,
      [upi],
    );

    const failure = await applyMigration(db.pool, MIGRATION).then(
      () => null,
      (err: Error) => err.message,
    );

    expect(failure).toBe(
      "migration 006 refused: 1 registrations with a retired channel, 1 payments with a retired method, 1 rows with an operator set",
    );
    expect(failure).not.toMatch(/Desk Volunteer|UTR-SECRET|Runner/);
    expect(await exists(db.pool, "admin_users")).toBe(false);
    expect(await columnType(db.pool, "registrations", "entered_by")).toBe("text");
  });
});

describe("migration 006 down and up again", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase({ upTo: MIGRATION });
  });

  afterAll(async () => {
    await db?.stop();
  });

  it("restores the 005 schema on down, then applies cleanly again", async () => {
    await applyDownMigration(db.pool, MIGRATION);

    for (const table of ["admin_users", "admin_enrolments", "audit_log"]) {
      expect(await exists(db.pool, table)).toBe(false);
    }
    expect(await columnType(db.pool, "registrations", "entered_by")).toBe("text");
    expect(await columnType(db.pool, "payments", "collected_by")).toBe("text");
    const eventId = await eventIdOf(db.pool);
    // The 005 rules are back: a retired channel with a text operator is accepted again.
    await insertRegistration(db.pool, eventId, 1, "held", {
      channel: "admin_upi",
      enteredBy: "someone",
    });
    await db.pool.query("TRUNCATE payments, registrations");

    await applyMigration(db.pool, MIGRATION);

    expect(await exists(db.pool, "audit_log")).toBe(true);
    expect(await columnType(db.pool, "registrations", "entered_by")).toBe("uuid");
  });
});
