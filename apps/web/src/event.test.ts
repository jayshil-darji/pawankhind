import { describe, expect, it } from "vitest";
import { registrationPhase } from "./event.js";

describe("registrationPhase", () => {
  it("opens at midnight Indian time on 15 November 2026", () => {
    expect(registrationPhase(new Date("2026-11-14T18:29:59Z"))).toBe("before");
    expect(registrationPhase(new Date("2026-11-14T18:30:00Z"))).toBe("open");
  });

  it("stays open through all of 8 January 2027", () => {
    expect(registrationPhase(new Date("2027-01-08T18:29:59Z"))).toBe("open");
    expect(registrationPhase(new Date("2027-01-08T18:30:00Z"))).toBe("after");
  });
});
