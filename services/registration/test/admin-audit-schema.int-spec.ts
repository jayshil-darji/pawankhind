import {
  insertRegistration,
  resetDatabase,
  startTestDatabase,
  TestDatabase,
} from "./support/database.js";

let db: TestDatabase;
let eventId: string;
let admins = 0;

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db?.stop();
});

beforeEach(async () => {
  eventId = await resetDatabase(db.pool, { capacity: 5 });
});

async function createAdmin(): Promise<string> {
  admins += 1;
  const { rows } = await db.pool.query<{ id: string }>(
    `INSERT INTO admin_users (username, display_name, role)
     VALUES ($1, 'Organiser', 'admin') RETURNING id`,
    [`organiser${admins}`],
  );
  return rows[0].id;
}

interface CashFields {
  reference: string | null;
  collectedBy: string | null;
  status: "created" | "captured";
}

async function insertCash(registrationId: string, fields: CashFields): Promise<void> {
  await db.pool.query(
    `INSERT INTO payments (registration_id, method, status, amount_paise, provider_mode,
                           reference, collected_by, captured_at)
     VALUES ($1, 'cash', $2::text, 20000, 'test', $3, $4,
             CASE WHEN $2::text = 'captured' THEN now() END)`,
    [registrationId, fields.status, fields.reference, fields.collectedBy],
  );
}

describe("audit_log", () => {
  async function insertAudit(): Promise<void> {
    await db.pool.query("INSERT INTO audit_log (actor_kind, action) VALUES ('cli', 'user.create')");
  }

  it("accepts new rows", async () => {
    await insertAudit();

    const { rows } = await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM audit_log");
    expect(Number(rows[0].n)).toBeGreaterThan(0);
  });

  it.each([
    ["UPDATE", "UPDATE audit_log SET action = 'changed'"],
    ["DELETE", "DELETE FROM audit_log"],
    ["TRUNCATE", "TRUNCATE audit_log"],
  ])("refuses %s", async (op, sql) => {
    await insertAudit();

    await expect(db.pool.query(sql)).rejects.toThrow(`audit_log is append-only: ${op} refused`);
  });

  it("ties actor_id to actor_kind 'user'", async () => {
    const admin = await createAdmin();

    await expect(
      db.pool.query("INSERT INTO audit_log (actor_kind, action) VALUES ('user', 'login')"),
    ).rejects.toMatchObject({ code: "23514", constraint: "audit_actor_matches_kind" });
    await expect(
      db.pool.query(
        "INSERT INTO audit_log (actor_id, actor_kind, action) VALUES ($1, 'anonymous', 'login.failed')",
        [admin],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "audit_actor_matches_kind" });
  });

  it("documents the failed-login rule on the table", async () => {
    const { rows } = await db.pool.query<{ comment: string }>(
      "SELECT obj_description('audit_log'::regclass, 'pg_class') AS comment",
    );

    expect(rows[0].comment).toMatch(/typed username is never stored/);
  });
});

describe("records are never deleted", () => {
  it.each(["registrations", "payments", "admin_users"])("refuses DELETE on %s", async (table) => {
    const admin = await createAdmin();
    const registration = await insertRegistration(db.pool, eventId, 1, "confirmed");
    await insertCash(registration, { reference: "R-1", collectedBy: admin, status: "captured" });

    await expect(db.pool.query(`DELETE FROM ${table}`)).rejects.toThrow(
      `${table} rows cannot be deleted`,
    );
  });
});

describe("channels and methods", () => {
  it.each(["admin_cash", "admin_upi"])("rejects the retired channel %s", async (channel) => {
    const admin = await createAdmin();

    await expect(
      insertRegistration(db.pool, eventId, 1, "held", { channel, enteredBy: admin }),
    ).rejects.toMatchObject({ code: "23514", constraint: "registrations_channel_valid" });
  });

  it("rejects the retired method upi_manual", async () => {
    const registration = await insertRegistration(db.pool, eventId, 1, "held");

    await expect(
      db.pool.query(
        `INSERT INTO payments (registration_id, method, status, amount_paise, provider_mode)
         VALUES ($1, 'upi_manual', 'created', 20000, 'test')`,
        [registration],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "payments_method_valid" });
  });

  it("requires operators to be real admin users", async () => {
    const stranger = "00000000-0000-4000-8000-000000000000";
    const registration = await insertRegistration(db.pool, eventId, 1, "confirmed");

    await expect(
      insertRegistration(db.pool, eventId, 2, "held", {
        channel: "paper_form",
        enteredBy: stranger,
      }),
    ).rejects.toMatchObject({ code: "23503", constraint: "registrations_entered_by_fkey" });
    await expect(
      insertCash(registration, { reference: "R-1", collectedBy: stranger, status: "captured" }),
    ).rejects.toMatchObject({ code: "23503", constraint: "payments_collected_by_fkey" });
  });
});

describe("cash payments", () => {
  it("accepts a complete cash payment", async () => {
    const admin = await createAdmin();
    const registration = await insertRegistration(db.pool, eventId, 1, "confirmed");

    await insertCash(registration, { reference: "R-1", collectedBy: admin, status: "captured" });
  });

  it.each([
    ["no receipt", { reference: null }],
    ["a blank receipt", { reference: "   " }],
    ["no collector", { collectedBy: null }],
    ["a status other than captured", { status: "created" }],
  ] as const)("rejects one with %s", async (_label, change) => {
    const admin = await createAdmin();
    const registration = await insertRegistration(db.pool, eventId, 1, "confirmed");
    const fields: CashFields = { reference: "R-1", collectedBy: admin, status: "captured" };

    await expect(insertCash(registration, { ...fields, ...change })).rejects.toMatchObject({
      code: "23514",
      constraint: "payments_cash_complete",
    });
  });

  it("rejects a receipt number already used, ignoring case and spaces", async () => {
    const admin = await createAdmin();
    const first = await insertRegistration(db.pool, eventId, 1, "confirmed");
    const second = await insertRegistration(db.pool, eventId, 2, "confirmed");
    await insertCash(first, { reference: " R-12 ", collectedBy: admin, status: "captured" });

    await expect(
      insertCash(second, { reference: "r-12", collectedBy: admin, status: "captured" }),
    ).rejects.toMatchObject({ code: "23505", constraint: "payments_cash_receipt_key" });
  });

  it("rejects a second cash payment for one registration", async () => {
    const admin = await createAdmin();
    const registration = await insertRegistration(db.pool, eventId, 1, "confirmed");
    await insertCash(registration, { reference: "R-1", collectedBy: admin, status: "captured" });

    await expect(
      insertCash(registration, { reference: "R-2", collectedBy: admin, status: "captured" }),
    ).rejects.toMatchObject({ code: "23505", constraint: "payments_one_cash_per_registration" });
  });

  it("documents what provider_mode means for cash", async () => {
    const { rows } = await db.pool.query<{ comment: string }>(
      `SELECT col_description('payments'::regclass, attnum) AS comment
         FROM pg_attribute WHERE attrelid = 'payments'::regclass AND attname = 'provider_mode'`,
    );

    expect(rows[0].comment).toMatch(/Cash rows: the environment's RAZORPAY_MODE/);
  });
});

describe("a confirmed registration", () => {
  const LOCKED: [string, string][] = [
    ["bib_number", "bib_number = bib_number + 1"],
    ["date_of_birth", "date_of_birth = date_of_birth + 1"],
    ["event_id", "event_id = gen_random_uuid()"],
    ["channel", "channel = 'paper_form'"],
    ["status", "status = 'expired'"],
    ["confirmed_at", "confirmed_at = confirmed_at - interval '1 minute'"],
    ["declarations_accepted_at", "declarations_accepted_at = now() - interval '1 day'"],
    ["declarations_version", "declarations_version = 'other-version'"],
  ];

  it.each(LOCKED)("keeps %s", async (_column, change) => {
    const registration = await insertRegistration(db.pool, eventId, 1, "confirmed");

    await expect(
      db.pool.query(`UPDATE registrations SET ${change} WHERE id = $1`, [registration]),
    ).rejects.toThrow(`confirmed registration ${registration}:`);
  });

  it("allows name, mobile and T-shirt corrections", async () => {
    const registration = await insertRegistration(db.pool, eventId, 1, "confirmed");

    await db.pool.query(
      `UPDATE registrations SET full_name = 'Corrected Name', mobile = '9123456789', tshirt_size = 'L'
        WHERE id = $1`,
      [registration],
    );
  });

  it("does not restrict held rows", async () => {
    const registration = await insertRegistration(db.pool, eventId, 1, "held");

    await db.pool.query(
      `UPDATE registrations
          SET date_of_birth = date_of_birth + 1, declarations_accepted_at = now(),
              declarations_version = 'other-version', status = 'expired'
        WHERE id = $1`,
      [registration],
    );
  });
});

describe("admin users and enrolments", () => {
  it("keeps usernames unique ignoring case", async () => {
    await db.pool.query(
      "INSERT INTO admin_users (username, display_name, role) VALUES ('Asha', 'Asha', 'kit')",
    );

    await expect(
      db.pool.query(
        "INSERT INTO admin_users (username, display_name, role) VALUES ('asha', 'Asha', 'kit')",
      ),
    ).rejects.toMatchObject({ code: "23505", constraint: "admin_users_username_key" });
  });

  it("refuses a password without MFA enrolment", async () => {
    await expect(
      db.pool.query(
        `INSERT INTO admin_users (username, display_name, role, password_hash)
         VALUES ('nomfa', 'No MFA', 'admin', 'argon2id-hash')`,
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "admin_password_with_mfa" });
  });

  it("refuses MFA enrolment without a TOTP secret", async () => {
    await expect(
      db.pool.query(
        `INSERT INTO admin_users (username, display_name, role, password_hash, mfa_enrolled_at)
         VALUES ('nosecret', 'No Secret', 'admin', 'argon2id-hash', now())`,
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "admin_mfa_has_secret" });
  });

  it("stores only a 32-byte token hash for enrolment links", async () => {
    const admin = await createAdmin();
    const insert = (bytes: number) =>
      db.pool.query(
        `INSERT INTO admin_enrolments (admin_user_id, token_hash, expires_at)
         VALUES ($1, decode(repeat('ab', $2), 'hex'), now() + interval '1 day')`,
        [admin, bytes],
      );

    await insert(32);
    await expect(insert(16)).rejects.toMatchObject({
      code: "23514",
      constraint: "enrolment_token_is_sha256",
    });
  });
});
