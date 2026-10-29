import { useState, type ReactNode } from "react";
import Countdown from "./Countdown.js";
import { EVENT, phaseOverride, registrationPhase, type RegistrationPhase } from "./event.js";
import Faq from "./Faq.js";
import Gallery from "./Gallery.js";
import Hero from "./Hero.js";
import { LEGEND_IMAGE } from "./images.js";
import Partners from "./Partners.js";
import { PARTNER_TIERS } from "./partners.js";
import RegisterPage from "./RegisterPage.js";
import RouteMap from "./RouteMap.js";
import SiteFooter from "./SiteFooter.js";
import SiteHeader from "./SiteHeader.js";
import Timeline from "./Timeline.js";
import HeroBackdrop from "./HeroBackdrop.js";

const STATS = [
  { big: "5 KM", small: "One loop from SK University" },
  { big: "3,000", small: "Places in total" },
  { big: "17 JAN", small: "Sunday, race day" },
];

function initialPhase(): RegistrationPhase {
  // Named fields, not the whole import.meta.env, so Vite inlines each one at build time.
  const env = {
    DEV: import.meta.env.DEV,
    VITE_ALLOW_PHASE_OVERRIDE: import.meta.env.VITE_ALLOW_PHASE_OVERRIDE,
  };
  return phaseOverride(window.location.search, env) ?? registrationPhase(new Date());
}

function ctaLabel(phase: RegistrationPhase): string {
  if (phase === "before") return "Registration opens 15 Nov";
  if (phase === "after") return "Registration closed";
  return "Register now";
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-orange-900/20 bg-white/60 p-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-orange-800">{label}</dt>
      <dd className="mt-1 text-stone-900">{children}</dd>
    </div>
  );
}

function ContactBand() {
  return (
    <section className="bg-linear-to-r from-stone-900 to-orange-900 px-4 py-14 text-white">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-sm text-orange-200">Questions, or interested in partnering with us?</p>
        <h2 className="mt-1 font-display text-4xl tracking-widest">GOT A QUESTION?</h2>
        <p className="mt-2">Call or message {EVENT.contact.name}.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a
            href={`tel:${EVENT.contact.tel}`}
            className="rounded-full bg-white px-6 py-2 font-semibold text-orange-900"
          >
            {EVENT.contact.phone}
          </a>
          <a
            href={`https://wa.me/${EVENT.contact.tel.replace("+", "")}`}
            className="rounded-full border border-white/70 px-6 py-2 font-semibold"
          >
            WhatsApp
          </a>
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  const [phase] = useState(initialPhase);

  return (
    <>
      <SiteHeader />
      <div className="relative isolate bg-stone-950">
        <HeroBackdrop />
        <Hero cta={ctaLabel(phase)} />
      </div>

      <section id="about" className="scroll-mt-28 bg-stone-950 px-4 py-14">
        <div className="mx-auto grid max-w-5xl overflow-hidden rounded-t-2xl bg-white shadow-xl md:grid-cols-2">
          {LEGEND_IMAGE ? (
            <img
              src={LEGEND_IMAGE}
              alt=""
              loading="lazy"
              className="h-full min-h-56 w-full object-cover"
            />
          ) : (
            <div className="flex min-h-56 flex-col justify-center gap-4 bg-linear-to-br from-orange-800 to-stone-900 p-8 text-white">
              {STATS.map((s) => (
                <div key={s.big}>
                  <p className="font-display text-5xl tracking-wide">{s.big}</p>
                  <p className="text-sm text-orange-100">{s.small}</p>
                </div>
              ))}
            </div>
          )}
          <div className="bg-stone-900 p-8 text-white">
            <h2 className="font-display text-4xl tracking-wider">HONOR THE LEGEND</h2>
            <p className="mt-4 text-stone-200">
              Inspired by the bravery of Chhatrapati Shivaji Maharaj and the spirit of his warriors.
            </p>
            <p className="mt-3 font-display text-2xl tracking-widest text-orange-400">
              NOW IT’S YOUR TURN TO RUN WITH THAT SPIRIT!
            </p>
            <a
              href="#info"
              className="mt-6 inline-block rounded-full border border-white/70 px-6 py-2 text-sm"
            >
              RACE INFORMATION
            </a>
          </div>
        </div>
        <div className="mx-auto max-w-5xl rounded-b-2xl bg-linear-to-r from-orange-700 to-red-900 p-6 text-white">
          <Countdown />
        </div>
      </section>

      <section id="route" className="scroll-mt-28 bg-black px-4 py-14 text-white">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-4 font-display text-4xl tracking-widest">THE ROUTE</h2>
          <RouteMap />
          <p className="mt-2 text-xs text-stone-400">
            5 km loop from SK University and back. Illustrative map; the final route will be
            announced before race day.
          </p>
        </div>
      </section>

      <section id="info" className="scroll-mt-28 bg-[#f3e9d2] px-4 py-14">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-6 font-display text-4xl tracking-widest text-stone-900">
            RACE INFORMATION
          </h2>
          <Timeline />
          <dl className="grid gap-4 sm:grid-cols-2">
            <Fact label="Race day">{EVENT.raceDay}</Fact>
            <Fact label="Start and finish">{EVENT.venue}</Fact>
            <Fact label="Entry fee">₹{EVENT.feeRupees}</Fact>
            <Fact label="Registration">
              15 November 2026 to 8 January 2027, or until all {EVENT.capacity} places are taken
            </Fact>
            <Fact label="You get">T-shirt, finisher medal and refreshments after the run</Fact>
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
        </div>
      </section>

      <section id="register" className="scroll-mt-28 bg-stone-950 px-4 py-14">
        <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-5">
          <div className="text-white md:col-span-2">
            <h2 className="font-display text-4xl tracking-widest">REGISTER</h2>
            <ul className="mt-4 space-y-2 text-stone-300">
              <li>Entry fee ₹{EVENT.feeRupees}</li>
              <li>T-shirt, finisher medal and refreshments</li>
              <li>Pay online securely with Razorpay</li>
              <li>One registration per person</li>
            </ul>
          </div>
          <div className="rounded-2xl bg-white p-6 text-slate-900 shadow-xl md:col-span-3">
            {phase === "before" && <p>Registration opens on 15 November 2026.</p>}
            {phase === "after" && <p>Registration is closed.</p>}
            {phase === "open" && <RegisterPage />}
          </div>
        </div>
      </section>

      <Gallery />
      <Partners tiers={PARTNER_TIERS} />
      <Faq />
      <ContactBand />
      <SiteFooter />
    </>
  );
}
