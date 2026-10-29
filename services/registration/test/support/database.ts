import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
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
export const RESET_TABLES = ["payments", "registrations"] as const;

/** Empties RESET_TABLES and resets the seeded event's counters and window. TRUNCATE, not
 *  DELETE: row-level BEFORE DELETE guards do not fire on it. Returns the event id. */
export async function resetDatabase(pool: pg.Pool, event: { capacity: number }): Promise<string> {
  await pool.query(`TRUNCATE ${RESET_TABLES.join(", ")} RESTART IDENTITY`);
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE events SET slots_taken = 0, next_bib = first_bib, capacity = $1,
       reg_opens_at = now() - interval '1 day', reg_closes_at = now() + interval '1 day'
     RETURNING id`,
    [event.capacity],
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
