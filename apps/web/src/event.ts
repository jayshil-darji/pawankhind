// Indian time. Keep in step with the event row on the server (the server is the authority).
const REGISTRATION_OPENS = new Date("2026-11-15T00:00:00+05:30").getTime();
const REGISTRATION_CLOSES = new Date("2027-01-09T00:00:00+05:30").getTime(); // end of 8 Jan

// 7:00 am Indian time.
const RACE_START = new Date("2027-01-17T07:00:00+05:30").getTime();

export const EVENT = {
  name: "Pawankhind",
  raceDay: "Sunday, 17 January 2027",
  venue: "SK University, Visnagar",
  feeRupees: 200,
  capacity: 3000,
  kit: [
    { day: "Friday, 15 January", time: "4 pm to 8 pm" },
    { day: "Saturday, 16 January", time: "10 am to 8 pm" },
  ],
  contact: { name: "Jayshil", phone: "+91 9033049847", tel: "+919033049847" },
} as const;

export type RegistrationPhase = "before" | "open" | "after";

export function registrationPhase(now: Date): RegistrationPhase {
  if (now.getTime() < REGISTRATION_OPENS) return "before";
  if (now.getTime() >= REGISTRATION_CLOSES) return "after";
  return "open";
}

export interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  done: boolean;
}

/** Time left until the start. Rounded up, so it never shows zero before the start. */
export function timeToRaceStart(now: Date): TimeLeft {
  const total = Math.max(0, Math.ceil((RACE_START - now.getTime()) / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    done: total === 0,
  };
}
