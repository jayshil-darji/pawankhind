import { startTestDatabase, TestDatabase } from "./support/database.js";

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db?.stop();
});

const liveActivatedAt = async () =>
  (
    await db.pool.query<{ live_activated_at: Date | null }>(
      "SELECT live_activated_at FROM environment_state",
    )
  ).rows;

describe("environment_state", () => {
  it("starts as exactly one row, not yet live", async () => {
    expect(await liveActivatedAt()).toEqual([{ live_activated_at: null }]);
  });

  it("refuses a second row", async () => {
    await expect(
      db.pool.query("INSERT INTO environment_state (singleton) VALUES (false)"),
    ).rejects.toMatchObject({ code: "23514", constraint: "environment_state_one_row" });
  });

  it("can be marked live once, and never cleared, changed or deleted afterwards", async () => {
    await db.pool.query("UPDATE environment_state SET live_activated_at = now()");
    const [marked] = await liveActivatedAt();
    expect(marked.live_activated_at).toBeInstanceOf(Date);

    await expect(
      db.pool.query("UPDATE environment_state SET live_activated_at = NULL"),
    ).rejects.toThrow("live_activated_at cannot change once set");
    await expect(
      db.pool.query(
        "UPDATE environment_state SET live_activated_at = live_activated_at + interval '1 day'",
      ),
    ).rejects.toThrow("live_activated_at cannot change once set");
    await expect(db.pool.query("DELETE FROM environment_state")).rejects.toThrow(
      "environment_state cannot be deleted",
    );

    expect(await liveActivatedAt()).toEqual([marked]);
  });
});
