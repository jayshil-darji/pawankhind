import { RegistrationsRepository } from "../src/registrations/registrations.repository.js";
import { PaymentsRepository } from "../src/payments/payments.repository.js";
import { startTestDatabase, person, TestDatabase } from "./support/database.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  await db.pool.query("DELETE FROM payments");
  await db.pool.query("DELETE FROM registrations");
  await db.pool.query(
    `UPDATE events SET slots_taken = 0, next_bib = first_bib, capacity = 5,
       reg_opens_at = now() - interval '1 day', reg_closes_at = now() + interval '1 day'`,
  );
  eventId = (await db.pool.query<{ id: string }>("SELECT id FROM events")).rows[0].id;
});

async function heldWithOrder(i: number) {
  const reserved = await registrations.reserveSlot(eventId, person(i));
  if (!reserved.ok) throw new Error("test setup: reservation failed");

  const intent = await payments.createPaymentIntent(reserved.registrationId, `order_${i}`);
  if (!intent) throw new Error("test setup: no payment intent");

  return {
    registrationId: reserved.registrationId,
    orderId: `order_${i}`,
    amount: intent.amountPaise,
  };
}

function confirm(h: { orderId: string; amount: number }, paymentId = `pay_${h.orderId}`) {
  return payments.confirmOnlinePayment({
    providerOrderId: h.orderId,
    providerPaymentId: paymentId,
    amountPaise: h.amount,
  });
}

async function event() {
  return (
    await db.pool.query<{ slots_taken: number; next_bib: number }>(
      "SELECT slots_taken, next_bib FROM events WHERE id = $1",
      [eventId],
    )
  ).rows[0];
}

async function waitForBlocked(count: number) {
  for (let i = 0; i < 150; i++) {
    const r = await db.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (r.rows[0].n >= count) return;
    await sleep(20);
  }
  throw new Error(`fewer than ${count} sessions became blocked`);
}

describe("confirmOnlinePayment", () => {
  it("confirms and issues the first BIB", async () => {
    const h = await heldWithOrder(1);
    const result = await confirm(h);

    expect(result).toEqual({
      ok: true,
      bib: 1001,
      registrationId: h.registrationId,
      alreadyConfirmed: false,
    });
    const reg = (
      await db.pool.query<{ status: string; bib_number: number }>(
        "SELECT status, bib_number FROM registrations WHERE id = $1",
        [h.registrationId],
      )
    ).rows[0];
    expect(reg).toEqual({ status: "confirmed", bib_number: 1001 });
    expect((await event()).next_bib).toBe(1002);
  });

  it("is idempotent when the same payment is reported twice", async () => {
    const h = await heldWithOrder(1);
    const first = await confirm(h);
    const second = await confirm(h);

    expect(first).toMatchObject({ ok: true, bib: 1001, alreadyConfirmed: false });
    expect(second).toMatchObject({ ok: true, bib: 1001, alreadyConfirmed: true });
    expect((await event()).next_bib).toBe(1002);
  });

  it("issues one BIB when the same payment arrives 10 times in parallel", async () => {
    const h = await heldWithOrder(1);
    const results = await Promise.all(Array.from({ length: 10 }, () => confirm(h)));

    expect(results.every((r) => r.ok && r.bib === 1001)).toBe(true);
    expect(results.filter((r) => r.ok && !r.alreadyConfirmed)).toHaveLength(1);
    expect((await event()).next_bib).toBe(1002);
  });

  it("issues unique, gap-free BIBs for 5 parallel confirmations", async () => {
    const holds = [];
    for (let i = 1; i <= 5; i++) holds.push(await heldWithOrder(i));

    const results = await Promise.all(holds.map((h) => confirm(h)));

    const bibs = results.map((r) => (r.ok ? r.bib : -1)).sort((a, b) => a - b);
    expect(bibs).toEqual([1001, 1002, 1003, 1004, 1005]);
    expect((await event()).next_bib).toBe(1006);
  });

  it("rejects a wrong amount and changes nothing", async () => {
    const h = await heldWithOrder(1);
    const result = await payments.confirmOnlinePayment({
      providerOrderId: h.orderId,
      providerPaymentId: "pay_x",
      amountPaise: h.amount - 100,
    });

    expect(result).toEqual({ ok: false, reason: "amount_mismatch" });
    expect((await event()).next_bib).toBe(1001);
  });

  it("rejects an unknown order", async () => {
    const result = await payments.confirmOnlinePayment({
      providerOrderId: "order_nope",
      providerPaymentId: "pay_nope",
      amountPaise: 20000,
    });
    expect(result).toEqual({ ok: false, reason: "unknown_order" });
  });

  it("re-takes a slot for a late payment when one is free", async () => {
    const h = await heldWithOrder(1);
    await db.pool.query("UPDATE registrations SET hold_expires_at = now() - interval '1 minute'");
    expect(await registrations.releaseExpiredHolds()).toBe(1);
    expect((await event()).slots_taken).toBe(0);

    const result = await confirm(h);

    expect(result).toMatchObject({ ok: true, bib: 1001 });
    expect((await event()).slots_taken).toBe(1);
  });

  it("records a late payment but does not confirm when no slot is left", async () => {
    await db.pool.query("UPDATE events SET capacity = 1");
    const late = await heldWithOrder(1);
    await db.pool.query("UPDATE registrations SET hold_expires_at = now() - interval '1 minute'");
    await registrations.releaseExpiredHolds();
    const taker = await registrations.reserveSlot(eventId, person(2));
    expect(taker.ok).toBe(true);

    const result = await confirm(late);

    expect(result).toEqual({ ok: false, reason: "no_slot" });
    const unfulfilled = await db.pool.query(
      `SELECT p.id FROM payments p JOIN registrations r ON r.id = p.registration_id
        WHERE p.status = 'captured' AND r.status <> 'confirmed'`,
    );
    expect(unfulfilled.rowCount).toBe(1);
  });

  it("records a late payment when the same person registered again", async () => {
    const late = await heldWithOrder(1);
    await db.pool.query("UPDATE registrations SET hold_expires_at = now() - interval '1 minute'");
    await registrations.releaseExpiredHolds();
    const again = await registrations.reserveSlot(eventId, person(1));
    expect(again.ok).toBe(true);

    const result = await confirm(late);

    expect(result).toEqual({ ok: false, reason: "duplicate_registration" });
    const row = (
      await db.pool.query<{ status: string }>(
        "SELECT status FROM payments WHERE provider_order_id = 'order_1'",
      )
    ).rows[0];
    expect(row.status).toBe("captured");
  });

  it("issues one BIB when 10 identical payments are forced to overlap", async () => {
    const h = await heldWithOrder(1);

    const blocker = await db.pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT 1 FROM registrations WHERE id = $1 FOR UPDATE", [h.registrationId]);

    const pending = Array.from({ length: 10 }, () => confirm(h));
    await waitForBlocked(10);

    await blocker.query("COMMIT");
    blocker.release();

    const results = await Promise.all(pending);

    expect(results.every((r) => r.ok && r.bib === 1001)).toBe(true);
    expect(results.filter((r) => r.ok && !r.alreadyConfirmed)).toHaveLength(1);
    expect((await event()).next_bib).toBe(1002);
  });
});
