import {
  POOL_CONNECTION_TIMEOUT_MS,
  startTestDatabase,
  TestDatabase,
  testPool,
} from "./support/database.js";

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db?.stop();
});

describe("test pools", () => {
  // Without a connection timeout the second connect() waits forever; the per-test timeout
  // below then turns that hang into a failure instead of the default 60 s stall.
  it(
    "reject a connect with no free connection within the timeout",
    async () => {
      const pool = testPool(db.connectionUri, { max: 1 });
      const held = await pool.connect();
      try {
        const started = Date.now();
        await expect(pool.connect()).rejects.toThrow(/timeout/i);
        const waited = Date.now() - started;

        expect(waited).toBeGreaterThanOrEqual(POOL_CONNECTION_TIMEOUT_MS - 100);
        expect(waited).toBeLessThan(POOL_CONNECTION_TIMEOUT_MS + 2000);
      } finally {
        held.release();
        await pool.end();
      }
    },
    POOL_CONNECTION_TIMEOUT_MS + 5000,
  );
});
