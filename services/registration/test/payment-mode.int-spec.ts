import { PaymentsRepository } from "../src/payments/payments.repository.js";
import { RegistrationsRepository } from "../src/registrations/registrations.repository.js";
import { applyMigration, person, startTestDatabase, TestDatabase } from "./support/database.js";

const OPEN_WINDOW = `UPDATE events SET reg_opens_at = now() - interval '1 day',
                                     reg_closes_at = now() + interval '1 day'`;

async function heldRegistration(db: TestDatabase, i: number): Promise<string> {
  await db.pool.query(OPEN_WINDOW);
  const event = await db.pool.query<{ id: string }>("SELECT id FROM events");
  const reserved = await new RegistrationsRepository(db.pool).reserveSlot(
    event.rows[0].id,
    person(i),
  );
  if (!reserved.ok) throw new Error(`reserve failed: ${reserved.reason}`);
  return reserved.registrationId;
}

async function modeOf(db: TestDatabase, orderId: string): Promise<string> {
  const r = await db.pool.query<{ provider_mode: string }>(
    "SELECT provider_mode FROM payments WHERE provider_order_id = $1",
    [orderId],
  );
  return r.rows[0].provider_mode;
}

describe("payments.provider_mode", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  });

  afterAll(async () => {
    await db?.stop();
  });

  it.each(["test", "live"] as const)(
    "stamps the server's mode (%s) on a new payment",
    async (mode) => {
      const registrationId = await heldRegistration(db, mode === "test" ? 1 : 2);

      await new PaymentsRepository(db.pool, mode).createPaymentIntent(
        registrationId,
        `order_${mode}`,
      );

      expect(await modeOf(db, `order_${mode}`)).toBe(mode);
    },
  );

  it("has no default: an insert that omits the mode is refused", async () => {
    const registrationId = await heldRegistration(db, 3);

    await expect(
      db.pool.query(
        `INSERT INTO payments (registration_id, method, status, amount_paise, provider_order_id)
         VALUES ($1, 'razorpay', 'created', 20000, 'order_no_mode')`,
        [registrationId],
      ),
    ).rejects.toMatchObject({ code: "23502" }); // not_null_violation
  });

  it("accepts only 'test' or 'live'", async () => {
    const registrationId = await heldRegistration(db, 4);

    await expect(
      db.pool.query(
        `INSERT INTO payments
           (registration_id, method, status, amount_paise, provider_order_id, provider_mode)
         VALUES ($1, 'razorpay', 'created', 20000, 'order_bad_mode', 'staging')`,
        [registrationId],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "payments_provider_mode_valid" });
  });
});

describe("migration 004 on existing data", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase({ upTo: "003_registration_declarations.sql" });
  });

  afterAll(async () => {
    await db?.stop();
  });

  it("marks payments made before it as test mode", async () => {
    const registrationId = await heldRegistration(db, 1);
    await db.pool.query(
      `INSERT INTO payments (registration_id, method, status, amount_paise, provider_order_id)
       VALUES ($1, 'razorpay', 'created', 20000, 'order_before_004')`,
      [registrationId],
    );

    await applyMigration(db.pool, "004_payment_provider_mode.sql");

    expect(await modeOf(db, "order_before_004")).toBe("test");
  });
});
