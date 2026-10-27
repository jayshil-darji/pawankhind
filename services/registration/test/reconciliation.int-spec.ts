import { Logger } from "@nestjs/common";
import type { PaymentProvider, ProviderPayment } from "../src/payments/payment-provider.js";
import { PaymentsRepository } from "../src/payments/payments.repository.js";
import { ReconciliationJob } from "../src/payments/reconciliation.job.js";
import { RegistrationFlow } from "../src/registrations/registration-flow.service.js";
import { RegistrationsRepository } from "../src/registrations/registrations.repository.js";
import { person, startTestDatabase, TestDatabase } from "./support/database.js";

let db: TestDatabase;
let registrations: RegistrationsRepository;
let payments: PaymentsRepository;
let eventId: string;
let listed: ProviderPayment[] = [];
let listFails = false;

const provider = {
  listPayments: () =>
    listFails ? Promise.reject(new Error("razorpay down")) : Promise.resolve(listed),
} as unknown as PaymentProvider;

const job = () =>
  new ReconciliationJob(
    new RegistrationFlow(registrations, payments, provider),
    payments,
    provider,
    0,
    3600,
  );

beforeAll(async () => {
  db = await startTestDatabase();
  registrations = new RegistrationsRepository(db.pool);
  payments = new PaymentsRepository(db.pool);
});

afterAll(async () => {
  await db?.stop();
});

beforeEach(async () => {
  listed = [];
  listFails = false;
  await db.pool.query("DELETE FROM payments");
  await db.pool.query("DELETE FROM registrations");
  await db.pool.query(
    `UPDATE events SET slots_taken = 0, next_bib = first_bib, capacity = 5,
       reg_opens_at = now() - interval '1 day', reg_closes_at = now() + interval '1 day'`,
  );
  eventId = (await db.pool.query<{ id: string }>("SELECT id FROM events")).rows[0].id;
});

async function startPayment(i: number, orderId: string): Promise<string> {
  const reserved = await registrations.reserveSlot(eventId, person(i));
  if (!reserved.ok) throw new Error("could not reserve a slot");
  await payments.createPaymentIntent(reserved.registrationId, orderId);
  return reserved.registrationId;
}

const captured = (id: string, orderId: string, over: Partial<ProviderPayment> = {}) => ({
  id,
  orderId,
  amountPaise: 20000,
  status: "captured",
  ...over,
});

async function regRow(id: string) {
  return (
    await db.pool.query<{ status: string; bib_number: number | null }>(
      "SELECT status, bib_number FROM registrations WHERE id = $1",
      [id],
    )
  ).rows[0];
}

async function slotsTaken() {
  return (await db.pool.query<{ slots_taken: number }>("SELECT slots_taken FROM events")).rows[0]
    .slots_taken;
}

const expireAll = () =>
  db.pool.query("UPDATE registrations SET hold_expires_at = now() - interval '1 minute'");

describe("ReconciliationJob", () => {
  it("confirms a captured payment that nobody reported", async () => {
    const id = await startPayment(1, "order_1");
    listed = [captured("pay_1", "order_1")];

    expect(await job().tick()).toEqual({ confirmed: 1, needsHuman: 0 });
    expect(await regRow(id)).toEqual({ status: "confirmed", bib_number: 1001 });
  });

  it("confirms a payment whose hold already expired, when a slot is free", async () => {
    const id = await startPayment(1, "order_1");
    await expireAll();
    await registrations.releaseExpiredHolds();
    expect(await slotsTaken()).toBe(0);
    listed = [captured("pay_1", "order_1")];

    expect(await job().tick()).toEqual({ confirmed: 1, needsHuman: 0 });
    expect(await regRow(id)).toEqual({ status: "confirmed", bib_number: 1001 });
    expect(await slotsTaken()).toBe(1);
  });

  it("is idempotent: a second pass changes nothing", async () => {
    await startPayment(1, "order_1");
    listed = [captured("pay_1", "order_1")];
    const j = job();

    await j.tick();
    expect(await j.tick()).toEqual({ confirmed: 0, needsHuman: 0 });

    const next = await db.pool.query<{ next_bib: number }>("SELECT next_bib FROM events");
    expect(next.rows[0].next_bib).toBe(1002);
  });

  it("ignores payments for orders that are not ours", async () => {
    const id = await startPayment(1, "order_1");
    listed = [captured("pay_x", "order_from_another_app")];

    expect(await job().tick()).toEqual({ confirmed: 0, needsHuman: 0 });
    expect((await regRow(id)).status).toBe("held");
  });

  it("ignores payments that are not captured", async () => {
    const id = await startPayment(1, "order_1");
    listed = [captured("pay_1", "order_1", { status: "authorized" })];

    expect(await job().tick()).toEqual({ confirmed: 0, needsHuman: 0 });
    expect((await regRow(id)).status).toBe("held");
  });

  it("does not confirm a different amount, and flags it only once", async () => {
    const id = await startPayment(1, "order_1");
    listed = [captured("pay_1", "order_1", { amountPaise: 19900 })];
    const j = job();

    expect(await j.tick()).toEqual({ confirmed: 0, needsHuman: 1 });
    expect(await j.tick()).toEqual({ confirmed: 0, needsHuman: 0 });
    expect((await regRow(id)).status).toBe("held");
  });

  it("flags a paid registration whose slot was taken, and does not retry it", async () => {
    await db.pool.query("UPDATE events SET capacity = 1");
    const id = await startPayment(1, "order_1");
    await expireAll();
    await registrations.releaseExpiredHolds();
    await registrations.reserveSlot(eventId, person(2)); // someone else takes the freed slot
    listed = [captured("pay_1", "order_1")];
    const j = job();

    expect(await j.tick()).toEqual({ confirmed: 0, needsHuman: 1 });
    expect((await regRow(id)).status).toBe("expired");
    expect(await j.tick()).toEqual({ confirmed: 0, needsHuman: 0 });
  });

  it("never throws when Razorpay is down", async () => {
    listFails = true;

    await expect(job().tick()).resolves.toEqual({ confirmed: 0, needsHuman: 0 });
  });

  it("logs a one-line summary for every pass", async () => {
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
    try {
      await startPayment(1, "order_1");
      listed = [captured("pay_1", "order_1"), captured("pay_2", "order_other")];

      await job().tick();

      const logged = log.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("2 captured payment(s) listed, 1 awaiting confirmation");
    } finally {
      log.mockRestore();
    }
  });
});
