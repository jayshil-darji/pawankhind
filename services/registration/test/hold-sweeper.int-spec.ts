import { HoldSweeper } from "../src/registrations/hold-sweeper.js";
import { RegistrationsRepository } from "../src/registrations/registrations.repository.js";
import { person, startTestDatabase, TestDatabase } from "./support/database.js";

let db: TestDatabase;
let repo: RegistrationsRepository;
let eventId: string;

beforeAll(async () => {
  db = await startTestDatabase();
  repo = new RegistrationsRepository(db.pool);
});

afterAll(async () => {
  await db?.stop();
});

beforeEach(async () => {
  await db.pool.query("DELETE FROM payments");
  await db.pool.query("DELETE FROM registrations");
  await db.pool.query(
    `UPDATE events SET slots_taken = 0, next_bib = first_bib, capacity = 5,
       reg_opens_at = now() - interval '1 day', reg_closes_at = now() + interval '1 day'`,
  );
  eventId = (await db.pool.query<{ id: string }>("SELECT id FROM events")).rows[0].id;
});

const expire = (name: string) =>
  db.pool.query(
    "UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE full_name = $1",
    [name],
  );

async function slotsTaken() {
  return (await db.pool.query<{ slots_taken: number }>("SELECT slots_taken FROM events")).rows[0]
    .slots_taken;
}

async function statusOf(name: string) {
  return (
    await db.pool.query<{ status: string }>(
      "SELECT status FROM registrations WHERE full_name = $1",
      [name],
    )
  ).rows[0].status;
}

describe("HoldSweeper", () => {
  it("tick frees the slot and marks only the overdue hold expired", async () => {
    await repo.reserveSlot(eventId, person(1));
    await repo.reserveSlot(eventId, person(2));
    await expire("Runner 1");

    const released = await new HoldSweeper(repo, 0).tick();

    expect(released).toBe(1);
    expect(await slotsTaken()).toBe(1);
    expect(await statusOf("Runner 1")).toBe("expired");
    expect(await statusOf("Runner 2")).toBe("held");
  });

  it("does nothing when no hold is overdue", async () => {
    await repo.reserveSlot(eventId, person(1));

    expect(await new HoldSweeper(repo, 0).tick()).toBe(0);
    expect(await slotsTaken()).toBe(1);
  });

  it("lets a freed slot be sold again", async () => {
    await db.pool.query("UPDATE events SET capacity = 1");
    await repo.reserveSlot(eventId, person(1));
    expect(await repo.reserveSlot(eventId, person(2))).toEqual({ ok: false, reason: "sold_out" });
    await expire("Runner 1");

    await new HoldSweeper(repo, 0).tick();

    expect((await repo.reserveSlot(eventId, person(2))).ok).toBe(true);
  });

  it("never throws when the database fails", async () => {
    const broken = {
      releaseExpiredHolds: () => Promise.reject(new Error("db down")),
    } as unknown as RegistrationsRepository;

    await expect(new HoldSweeper(broken, 0).tick()).resolves.toBe(0);
  });

  it("sweeps on its own when the timer is running", async () => {
    const sweeper = new HoldSweeper(repo, 50);
    await repo.reserveSlot(eventId, person(1));
    await expire("Runner 1");

    sweeper.onApplicationBootstrap();
    try {
      await vi.waitFor(async () => {
        expect(await slotsTaken()).toBe(0);
      });
    } finally {
      sweeper.onApplicationShutdown();
    }
  });
});
