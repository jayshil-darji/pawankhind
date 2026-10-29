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
