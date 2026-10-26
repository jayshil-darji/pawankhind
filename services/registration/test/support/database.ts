import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { ParticipantInput } from "../../src/registrations/registrations.repository.js";

export interface TestDatabase {
  pool: pg.Pool;
  stop: () => Promise<void>;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    "postgres:17",
  ).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  const dir = join(import.meta.dirname, "../../migrations");
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(dir, file), "utf8");
    await pool.query(sql.split("-- Down Migration")[0]);
  }
  return {
    pool,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
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
  };
}
