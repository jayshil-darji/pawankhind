import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type pg from "pg";
import { allocateBib } from "../src/payments/allocate-bib.js";

// Static guard for the CLAUDE.md rule: "BIBs are allocated only by allocateBib, called only
// from the two confirmation paths, each inside the transaction that records a captured payment."

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): { path: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!entry.name.endsWith(".ts")) return [];
    return [{ path: relative(ROOT, full), text: readFileSync(full, "utf8") }];
  });
}

const files = sourceFiles(SRC);

/** Files (and how many calls each) allowed to call allocateBib: the confirmation paths.
 *  Today only confirmOnlinePayment; paper + cash (admin plan A10) will be the second. */
const CONFIRMATION_PATH_CALLERS = { "src/payments/payments.repository.ts": 1 };

describe("BIB allocation rule (source check)", () => {
  it("writes the BIB counter (next_bib) only inside allocateBib", () => {
    const writers = files.filter((f) => /\bnext_bib\s*=(?!=)/.test(f.text)).map((f) => f.path);

    expect(writers).toEqual(["src/payments/allocate-bib.ts"]);
  });

  it("calls allocateBib only from the confirmation paths", () => {
    const callers = Object.fromEntries(
      files
        .filter((f) => f.path !== "src/payments/allocate-bib.ts")
        .map((f): [string, number] => [f.path, (f.text.match(/\ballocateBib\s*\(/g) ?? []).length])
        .filter(([, calls]) => calls > 0),
    );

    expect(callers).toEqual(CONFIRMATION_PATH_CALLERS);
  });

  it("assigns registrations.bib_number only in the confirmation repository", () => {
    const assigners = files.filter((f) => /\bbib_number\s*=(?!=)/.test(f.text)).map((f) => f.path);

    expect(assigners).toEqual(["src/payments/payments.repository.ts"]);
  });

  it("needs a transaction's client, not the pool (checked by tsc)", () => {
    const pool = {} as pg.Pool;
    // @ts-expect-error A Pool is not a PoolClient: allocateBib must run on the caller's
    // transaction connection. If this line ever compiles, check-types fails here.
    const call = () => allocateBib(pool, "event");

    expect(typeof call).toBe("function");
  });
});
