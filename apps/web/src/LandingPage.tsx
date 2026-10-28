import { useState, type ReactNode } from "react";
import { EVENT, registrationPhase, type RegistrationPhase } from "./event.js";
import Hero from "./Hero.js";
import RegisterPage from "./RegisterPage.js";
import RouteMap from "./RouteMap.js";

/** In development only, ?phase=open|before|after lets you see each state. Never in the built site. */
function initialPhase(): RegistrationPhase {
  const forced = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("phase")
    : null;
  if (forced === "before" || forced === "open" || forced === "after") return forced;
  return registrationPhase(new Date());
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-stone-200 p-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</dt>
      <dd className="mt-1 text-stone-900">{children}</dd>
    </div>
  );
}

export default function LandingPage() {
  const [phase] = useState(initialPhase);

  return (
    <>
      <Hero />

      <section className="mx-auto max-w-3xl px-4 py-12">
        <h2 className="mb-4 text-2xl font-bold">The route</h2>
        <RouteMap />
        <p className="mt-2 text-xs text-stone-500">
          5 km loop from SK University and back. Illustrative map; the final route will be announced
          before race day.
        </p>
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-12">
        <h2 className="mb-4 text-2xl font-bold">Event details</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Fact label="Race day">{EVENT.raceDay}</Fact>
          <Fact label="Start and finish">{EVENT.venue}</Fact>
          <Fact label="Entry fee">₹{EVENT.feeRupees}</Fact>
          <Fact label="Registration">
            15 November 2026 to 8 January 2027, or until all {EVENT.capacity} places are taken
          </Fact>
          <Fact label="Kit collection">
            {EVENT.kit.map((k) => (
              <p key={k.day}>{`${k.day}: ${k.time}`}</p>
            ))}
            <p className="mt-1 text-sm text-stone-600">
              Kits are not given on race day. Carry a photo ID.
            </p>
          </Fact>
          <Fact label="Please note">
            No refunds. A BIB cannot be transferred. No registration on race day.
          </Fact>
        </dl>
      </section>

      <section id="register" className="bg-stone-50 px-4 py-12">
        <div className="mx-auto max-w-xl">
          <h2 className="mb-4 text-2xl font-bold">Register</h2>
          {phase === "before" && <p>Registration opens on 15 November 2026.</p>}
          {phase === "after" && <p>Registration is closed.</p>}
          {phase === "open" && <RegisterPage />}
        </div>
      </section>

      <footer className="bg-stone-900 px-4 py-8 text-center text-sm text-stone-300">
        <p>
          Questions? Call {EVENT.contact.name}:{" "}
          <a className="underline" href={`tel:${EVENT.contact.tel}`}>
            {EVENT.contact.phone}
          </a>
        </p>
      </footer>
    </>
  );
}
