import type pg from "pg";

/**
 * The only place a BIB number is allocated: one UPDATE on the events row, so concurrent
 * confirmations serialise on that row and never share or skip a number.
 *
 * Call it only from a confirmation path, inside the transaction that records the captured
 * payment. It takes a PoolClient, not a Pool, so it can only run on the connection that holds
 * that transaction. The caller writes the returned number to the registration.
 */
export async function allocateBib(client: pg.PoolClient, eventId: string): Promise<number> {
  const allocated = await client.query<{ bib: number }>(
    `UPDATE events SET next_bib = next_bib + 1
      WHERE id = $1
      RETURNING next_bib - 1 AS bib`,
    [eventId],
  );
  return allocated.rows[0].bib;
}
