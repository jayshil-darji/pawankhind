import { RegistrationsRepository } from "../src/registrations/registrations.repository.js";
import { PaymentsRepository } from "../src/payments/payments.repository.js";
import { startTestDatabase, person, TestDatabase, resetDatabase } from "./support/database.js";

const SEED = Number(process.env.STRESS_SEED ?? Date.now() % 100000);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Small deterministic random number generator (mulberry32).
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  eventId = await resetDatabase(db.pool, { capacity: 50 });
});

async function assertInvariants() {
  const e = (
    await db.pool.query<{
      capacity: number;
      first_bib: number;
      next_bib: number;
      slots_taken: number;
    }>("SELECT capacity, first_bib, next_bib, slots_taken FROM events WHERE id = $1", [eventId])
  ).rows[0];

  const r = (
    await db.pool.query<{
      held: number;
      confirmed: number;
      distinct_bibs: number;
      min_bib: number | null;
      max_bib: number | null;
    }>(
      `SELECT count(*) FILTER (WHERE status = 'held')::int      AS held,
              count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
              count(DISTINCT bib_number)::int                   AS distinct_bibs,
              min(bib_number)                                   AS min_bib,
              max(bib_number)                                   AS max_bib
         FROM registrations`,
    )
  ).rows[0];

  // Slot accounting matches the registrations.
  expect(e.slots_taken).toBe(r.held + r.confirmed);
  expect(e.slots_taken).toBeLessThanOrEqual(e.capacity);

  // BIBs are unique and gap-free: exactly first_bib .. next_bib - 1.
  expect(r.confirmed).toBe(e.next_bib - e.first_bib);
  expect(r.distinct_bibs).toBe(r.confirmed);
  if (r.confirmed > 0) {
    expect(r.min_bib).toBe(e.first_bib);
    expect(r.max_bib).toBe(e.next_bib - 1);
  }

  // No registration is paid twice, and every confirmed one has its payment.
  const doublePaid = await db.pool.query(
    `SELECT registration_id FROM payments WHERE status = 'captured'
      GROUP BY registration_id HAVING count(*) > 1`,
  );
  expect(doublePaid.rowCount).toBe(0);

  const unpaidConfirmed = await db.pool.query(
    `SELECT r.id FROM registrations r
      WHERE r.status = 'confirmed'
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.registration_id = r.id AND p.status = 'captured')`,
  );
  expect(unpaidConfirmed.rowCount).toBe(0);

  return r;
}

describe("stress", () => {
  it(`keeps every invariant under a mixed random load (seed ${SEED})`, async () => {
    const rand = seeded(SEED);
    let sweeping = true;

    const sweeper = (async () => {
      while (sweeping) {
        await registrations.releaseExpiredHolds();
        await sleep(15);
      }
    })();

    const expireHold = (registrationId: string) =>
      db.pool.query(
        "UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1 AND status = 'held'",
        [registrationId],
      );

    async function runner(i: number) {
      await sleep(rand() * 50);
      const reserved = await registrations.reserveSlot(eventId, person(i));
      if (!reserved.ok) return;

      const orderId = `order_${i}`;
      const intent = await payments.createPaymentIntent(reserved.registrationId, orderId);
      if (!intent) return;

      const pay = () =>
        payments.confirmOnlinePayment({
          providerOrderId: orderId,
          providerPaymentId: `pay_${i}`,
          amountPaise: intent.amountPaise,
        });

      const behaviour = rand();
      if (behaviour < 0.6) {
        // Pays promptly; the gateway may deliver the webhook up to 3 times at once.
        const repeats = 1 + Math.floor(rand() * 3);
        await Promise.all(Array.from({ length: repeats }, () => pay()));
      } else if (behaviour < 0.8) {
        // Walks away: the hold expires.
        await expireHold(reserved.registrationId);
      } else {
        // Pays after the hold expired.
        await expireHold(reserved.registrationId);
        await sleep(rand() * 60);
        await pay();
      }
    }

    await Promise.all(Array.from({ length: 150 }, (_, i) => runner(i + 1)));
    sweeping = false;
    await sweeper;
    await registrations.releaseExpiredHolds();

    const result = await assertInvariants();
    expect(result.held).toBe(0);
    console.log(`seed ${SEED}: ${result.confirmed} confirmed of 50 slots`);
  });
});
