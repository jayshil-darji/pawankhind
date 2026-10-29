import { PaymentsRepository } from "../src/payments/payments.repository.js";
import { RegistrationsRepository } from "../src/registrations/registrations.repository.js";
import { person, startTestDatabase, TestDatabase, resetDatabase } from "./support/database.js";

let db: TestDatabase;
let registrations: RegistrationsRepository;
let payments: PaymentsRepository;
let eventId: string;

beforeAll(async () => {
  db = await startTestDatabase();
  registrations = new RegistrationsRepository(db.pool);
  payments = new PaymentsRepository(db.pool, "test");
});

afterAll(async () => {
  await db?.stop();
});

beforeEach(async () => {
  eventId = await resetDatabase(db.pool, { capacity: 5 });
});

describe("a second payment for an already confirmed registration", () => {
  it("is recorded and flagged, and never issues or replaces a BIB", async () => {
    const reserved = await registrations.reserveSlot(eventId, person(1));
    if (!reserved.ok) throw new Error("could not reserve a slot");
    await payments.createPaymentIntent(reserved.registrationId, "order_A");
    const first = await payments.confirmOnlinePayment({
      providerOrderId: "order_A",
      providerPaymentId: "pay_A",
      amountPaise: 20000,
    });
    expect(first).toMatchObject({ ok: true, bib: 1001 });

    await db.pool.query(
      `INSERT INTO payments
         (registration_id, method, status, amount_paise, provider_order_id, provider_mode)
       VALUES ($1, 'razorpay', 'created', 20000, 'order_B', 'test')`,
      [reserved.registrationId],
    );
    const second = await payments.confirmOnlinePayment({
      providerOrderId: "order_B",
      providerPaymentId: "pay_B",
      amountPaise: 20000,
    });

    expect(second).toEqual({ ok: false, reason: "duplicate_registration" });
    const reg = await db.pool.query<{ bib_number: number }>("SELECT bib_number FROM registrations");
    expect(reg.rows[0].bib_number).toBe(1001);
    const ev = await db.pool.query<{ next_bib: number }>("SELECT next_bib FROM events");
    expect(ev.rows[0].next_bib).toBe(1002);
    const pay = await db.pool.query<{ status: string }>(
      "SELECT status FROM payments WHERE provider_order_id = 'order_B'",
    );
    expect(pay.rows[0].status).toBe("captured");
  });
});
