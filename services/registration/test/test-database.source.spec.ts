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

const testFiles = sourceFiles(join(ROOT, "test"));

describe("test database rules (source check)", () => {
  it("builds pools only in testPool, which sets the connection timeout", () => {
    const builders = testFiles
      .filter((f) => /new\s+(?:\w+\.)?Pool\s*\(/.test(f.text))
      .map((f) => f.path);

    expect(builders).toEqual(["test/support/database.ts"]);
  });
});
