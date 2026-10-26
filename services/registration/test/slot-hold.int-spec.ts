import pg from "pg";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  ParticipantInput,
  RegistrationsRepository,
} from "../src/registrations/registrations.repository.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;
let repo: RegistrationsRepository;
let eventId: string;

function person(i: number): ParticipantInput {
  return {
    fullName: `Runner ${i}`,
    dateOfBirth: "1992-12-28",
    gender: "male",
    mobile: `9${String(i).padStart(9, "0")}`,
    tshirtSize: "M",
    city: "Visnagar",
    emergencyContactName: "Janvi",
    emergencyContactMobile: "9876543210",
  };
}

async function applyMigrations(p: pg.Pool) {
  const dir = join(import.meta.dirname, "../migrations");
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(dir, file), "utf8");
    await p.query(sql.split("-- Down Migration")[0]);
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17").start();
  pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  await applyMigrations(pool);
  repo = new RegistrationsRepository(pool);
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

beforeEach(async () => {
  await pool.query("DELETE FROM payments");
  await pool.query("DELETE FROM registrations");
  await pool.query(
    `UPDATE events SET slots_taken = 0, next_bib = first_bib,
       capacity = 5, reg_opens_at = now() - interval '1 day', reg_closes_at = now() + interval '1 day'`,
  );
  eventId = (await pool.query<{ id: string }>("SELECT id FROM events")).rows[0].id;
});

async function counts() {
  const e = (
    await pool.query<{ slots_taken: number }>("SELECT slots_taken FROM events WHERE id = $1", [
      eventId,
    ])
  ).rows[0];
  const r = (
    await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM registrations WHERE status IN ('held','confirmed')",
    )
  ).rows[0];
  return { slotsTaken: e.slots_taken, active: r.n };
}

describe("reserveSlot", () => {
  it("reserves a slot and keeps the counter in step", async () => {
    const result = await repo.reserveSlot(eventId, person(1));
    expect(result.ok).toBe(true);
    expect(await counts()).toEqual({ slotsTaken: 1, active: 1 });
  });

  it("never oversells under 40 parallel requests for 5 slots", async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => repo.reserveSlot(eventId, person(i + 1))),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.filter((r) => !r.ok && r.reason === "sold_out")).toHaveLength(35);
    expect(await counts()).toEqual({ slotsTaken: 5, active: 5 });
  });

  it("rolls the slot back when the same person registers twice", async () => {
    await repo.reserveSlot(eventId, person(1));
    const again = await repo.reserveSlot(eventId, person(1));
    expect(again).toEqual({ ok: false, reason: "already_registered" });
    expect(await counts()).toEqual({ slotsTaken: 1, active: 1 });
  });

  it("refuses when registration is closed", async () => {
    await pool.query(
      "UPDATE events SET reg_closes_at = now() - interval '1 hour', reg_opens_at = now() - interval '2 days'",
    );
    const result = await repo.reserveSlot(eventId, person(1));
    expect(result).toEqual({ ok: false, reason: "closed" });
    expect(await counts()).toEqual({ slotsTaken: 0, active: 0 });
  });
});

describe("releaseExpiredHolds", () => {
  it("returns the slots of expired holds only", async () => {
    await repo.reserveSlot(eventId, person(1));
    await repo.reserveSlot(eventId, person(2));
    await pool.query(
      "UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE full_name = 'Runner 1'",
    );

    const released = await repo.releaseExpiredHolds();

    expect(released).toBe(1);
    expect(await counts()).toEqual({ slotsTaken: 1, active: 1 });
  });

  it("is safe to run twice at the same time", async () => {
    for (let i = 1; i <= 3; i++) await repo.reserveSlot(eventId, person(i));
    await pool.query("UPDATE registrations SET hold_expires_at = now() - interval '1 minute'");

    const [a, b] = await Promise.all([repo.releaseExpiredHolds(), repo.releaseExpiredHolds()]);

    expect(a + b).toBe(3);
    expect(await counts()).toEqual({ slotsTaken: 0, active: 0 });
  });
});
