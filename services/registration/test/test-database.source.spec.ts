import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Static guards for how the tests use the database.

const ROOT = join(import.meta.dirname, "..");

function sourceFiles(dir: string): { path: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!entry.name.endsWith(".ts")) return [];
    return [{ path: relative(ROOT, full), text: readFileSync(full, "utf8") }];
  });
}

/** Comments may mention TRUNCATE or DELETE; only code counts. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const testFiles = sourceFiles(join(ROOT, "test"));
const srcFiles = sourceFiles(join(ROOT, "src"));

/** Tables that have, or will get (admin plan A3), row-level DELETE guards. */
const PROTECTED_TABLES = [
  "registrations",
  "payments",
  "kit_collections",
  "audit_log",
  "admin_users",
];

describe("test database rules (source check)", () => {
  it("never DELETEs from protected tables, in src or test (tests reset with TRUNCATE)", () => {
    const deleteFrom = new RegExp(`\\bDELETE\\s+FROM\\s+(${PROTECTED_TABLES.join("|")})\\b`, "i");
    const offenders = [...srcFiles, ...testFiles]
      .filter((f) => deleteFrom.test(withoutComments(f.text)))
      .map((f) => f.path);

    expect(offenders).toEqual([]);
  });

  it("never TRUNCATEs in the app", () => {
    const offenders = srcFiles
      .filter((f) => /\bTRUNCATE\b/i.test(withoutComments(f.text)))
      .map((f) => f.path);

    expect(offenders).toEqual([]);
  });

  it("builds pools only in testPool, which sets the connection timeout", () => {
    const builders = testFiles
      .filter((f) => /new\s+(?:\w+\.)?Pool\s*\(/.test(f.text))
      .map((f) => f.path);

    expect(builders).toEqual(["test/support/database.ts"]);
  });
});
