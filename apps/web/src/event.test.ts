import { describe, expect, it } from "vitest";
import { registrationPhase, timeToRaceStart } from "./event.js";

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

describe("timeToRaceStart", () => {
  it("splits the time left into days, hours, minutes and seconds", () => {
    expect(timeToRaceStart(new Date("2026-10-28T10:00:00Z"))).toEqual({
      days: 80,
      hours: 14,
      minutes: 30,
      seconds: 0,
      done: false,
    });
  });

  it("rounds up, so it never shows zero before the start", () => {
    expect(timeToRaceStart(new Date("2027-01-17T00:29:59.500Z"))).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 1,
      done: false,
    });
  });

  it("is done at the start time and after", () => {
    const done = { days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
    expect(timeToRaceStart(new Date("2027-01-17T00:30:00Z"))).toEqual(done);
    expect(timeToRaceStart(new Date("2027-02-01T00:00:00Z"))).toEqual(done);
  });
});
