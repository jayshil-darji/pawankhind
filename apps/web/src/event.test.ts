import { describe, expect, it } from "vitest";
import { phaseOverride, registrationPhase, timeToRaceStart } from "./event.js";

describe("phaseOverride", () => {
  const production = { DEV: false };
  const flagged = { DEV: false, VITE_ALLOW_PHASE_OVERRIDE: "true" };
  const development = { DEV: true };

  it("is ignored in a production build without VITE_ALLOW_PHASE_OVERRIDE", () => {
    for (const phase of ["before", "open", "after"]) {
      expect(phaseOverride(`?phase=${phase}`, production)).toBeNull();
    }
  });

  it("works in a production build with VITE_ALLOW_PHASE_OVERRIDE=true", () => {
    expect(phaseOverride("?phase=before", flagged)).toBe("before");
    expect(phaseOverride("?phase=open", flagged)).toBe("open");
    expect(phaseOverride("?phase=after", flagged)).toBe("after");
  });

  it("needs the flag to be exactly true", () => {
    for (const value of ["TRUE", "1", "yes", "true ", ""]) {
      expect(
        phaseOverride("?phase=open", { DEV: false, VITE_ALLOW_PHASE_OVERRIDE: value }),
      ).toBeNull();
    }
  });

  it("ignores invalid phase values, with or without the flag", () => {
    for (const env of [production, flagged, development]) {
      for (const search of [
        "?phase=OPEN",
        "?phase=closed",
        "?phase=",
        "?phase=open%20",
        "?other=open",
        "",
      ]) {
        expect(phaseOverride(search, env)).toBeNull();
      }
    }
  });
});

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
      hours: 15,
      minutes: 30,
      seconds: 0,
      done: false,
    });
  });

  it("rounds up, so it never shows zero before the start", () => {
    expect(timeToRaceStart(new Date("2027-01-17T01:29:59.500Z"))).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 1,
      done: false,
    });
  });

  it("is done at the start time and after", () => {
    const done = { days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
    expect(timeToRaceStart(new Date("2027-01-17T01:30:00Z"))).toEqual(done);
    expect(timeToRaceStart(new Date("2027-02-01T00:00:00Z"))).toEqual(done);
  });
});
