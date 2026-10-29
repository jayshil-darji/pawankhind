import { RegistrationsRepository } from "../src/registrations/registrations.repository.js";
import { person, resetDatabase, startTestDatabase, TestDatabase } from "./support/database.js";

let db: TestDatabase;
let seededEventId: string;

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

    expect(await count("registrations")).toBe(1);
    expect(await count("payments")).toBe(1);
  });

  it("removes the previous test's rows and resets the event counters", async () => {
    expect(await count("registrations")).toBe(0);
    expect(await count("payments")).toBe(0);
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

  it("fails, rather than cascading, when an unlisted table references a reset table", async () => {
    await db.pool.query(
      "CREATE TABLE stray_child (registration_id uuid REFERENCES registrations (id))",
    );
    try {
      await expect(resetDatabase(db.pool, { capacity: 5 })).rejects.toMatchObject({
        code: "0A000",
      });
    } finally {
      await db.pool.query("DROP TABLE stray_child");
    }
  });
});
