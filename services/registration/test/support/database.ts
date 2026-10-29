import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { withTransaction } from "../../src/infra/transaction.js";
import type { ParticipantInput } from "../../src/registrations/registrations.repository.js";

export interface TestDatabase {
  pool: pg.Pool;
  stop: () => Promise<void>;
  connectionUri: string;
}

const MIGRATIONS_DIR = join(import.meta.dirname, "../../migrations");

/** A test that waits for a pool connection fails after this long instead of hanging. */
export const POOL_CONNECTION_TIMEOUT_MS = 5000;

/** Every pool in the tests comes from here (test-database.source.spec.ts enforces it). The
 *  owner ends it before its container stops. */
export function testPool(connectionString: string, options: { max?: number } = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: options.max,
    connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
  });
  pool.on("error", () => {
    // During teardown the server may tell idle clients it is going away. Not a test failure.
  });
  return pool;
}

/** Runs the Up part of one migration file, the way startTestDatabase does. */
export async function applyMigration(pool: pg.Pool, file: string): Promise<void> {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  await pool.query(sql.split("-- Down Migration")[0]);
}

/** Runs the Down part of one migration file. */
export async function applyDownMigration(pool: pg.Pool, file: string): Promise<void> {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  const down = sql.split("-- Down Migration")[1];
  if (!down?.trim()) throw new Error(`${file} has no Down Migration`);
  await pool.query(down);
}

/** `upTo` stops after that migration file (inclusive), to test a later one against older data. */
export async function startTestDatabase(options: { upTo?: string } = {}): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    "postgres:17",
  ).start();
  const pool = testPool(container.getConnectionUri(), { max: 20 });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && (!options.upTo || f <= options.upTo))
    .sort()) {
    await applyMigration(pool, file);
  }
  return {
    pool,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
    connectionUri: container.getConnectionUri(),
  };
}

/** Tables emptied between tests. Listed one by one, never "all tables": events keeps its seed
 *  row and environment_state its single row (the live-mode check depends on it). No CASCADE,
 *  so a new table referencing these fails the reset until it is added here on purpose. */
export const RESET_TABLES = [
  "payments",
  "registrations",
  "admin_enrolments",
  "audit_log",
  "admin_users",
] as const;

/** Empties RESET_TABLES and resets the seeded event's counters and window. TRUNCATE, not
 *  DELETE: row-level BEFORE DELETE guards do not fire on it. audit_log's TRUNCATE guard is
 *  lifted only inside this transaction, so a failed reset rolls back with the guard still on.
 *  Returns the event id. */
export async function resetDatabase(pool: pg.Pool, event: { capacity: number }): Promise<string> {
  return withTransaction(pool, async (client) => {
    await client.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_truncate");
    await client.query(`TRUNCATE ${RESET_TABLES.join(", ")} RESTART IDENTITY`);
    await client.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_truncate");
    const { rows } = await client.query<{ id: string }>(
      `UPDATE events SET slots_taken = 0, next_bib = first_bib, capacity = $1,
         reg_opens_at = now() - interval '1 day', reg_closes_at = now() + interval '1 day'
       RETURNING id`,
      [event.capacity],
    );
    return rows[0].id;
  });
}

/** Inserts a registration directly (no app code), so schema tests can set any status. Confirmed
 *  rows get BIB 2000 + i. Works on every schema from 003 on. */
export async function insertRegistration(
  pool: pg.Pool,
  eventId: string,
  i: number,
  status: "held" | "confirmed" | "expired",
  options: { channel?: string; enteredBy?: string | null } = {},
): Promise<string> {
  const p = person(i);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO registrations
       (event_id, status, channel, entered_by, full_name, date_of_birth, gender, mobile,
        tshirt_size, city, emergency_contact_name, emergency_contact_mobile,
        hold_expires_at, bib_number, confirmed_at, declarations_accepted_at, declarations_version)
     VALUES ($1, $2::text, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             CASE WHEN $2::text = 'held' THEN now() + interval '10 minutes' END,
             CASE WHEN $2::text = 'confirmed' THEN 2000 + $13::int END,
             CASE WHEN $2::text = 'confirmed' THEN now() END,
             now(), 'test-v1')
     RETURNING id`,
    [
      eventId,
      status,
      options.channel ?? "online",
      options.enteredBy ?? null,
      p.fullName,
      p.dateOfBirth,
      p.gender,
      p.mobile,
      p.tshirtSize,
      p.city,
      p.emergencyContactName,
      p.emergencyContactMobile,
      i,
    ],
  );
  return rows[0].id;
}

export function person(i: number): ParticipantInput {
  return {
    fullName: `Runner ${i}`,
    dateOfBirth: "1995-05-05",
    gender: "male",
    mobile: `9${String(i).padStart(9, "0")}`,
    tshirtSize: "M",
    city: "Visnagar",
    emergencyContactName: "Contact",
    emergencyContactMobile: "9876543211",
    healthDeclaration: true,
    termsAccepted: true,
  };
}
