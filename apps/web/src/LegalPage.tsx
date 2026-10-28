import { Link } from "react-router";
import { EVENT } from "./event.js";
import SiteFooter from "./SiteFooter.js";
import SiteHeader from "./SiteHeader.js";

const PAGES = {
  terms: {
    title: "Terms of Use",
    points: [
      "Pawankhind Season 3 is a 5 km run on Sunday, 17 January 2027, starting and finishing at SK University, Visnagar.",
      "Registration is complete only after online payment is confirmed. Your BIB number is issued after confirmation.",
      "The entry fee is ₹200 per person. One registration covers one participant.",
      "Kits are collected on 15 January (4 pm to 8 pm) and 16 January (10 am to 8 pm). Kits are not given on race day.",
      "A BIB belongs to the registered participant and cannot be transferred.",
      "There is no registration on race day.",
    ],
  },
  privacy: {
    title: "Privacy Policy",
    points: [
      "We collect the details you enter on the registration form, such as your name, mobile number and date of birth.",
      "We use them to register you, issue your BIB and contact you about the event.",
      "Payments are processed by Razorpay. We do not store your card or UPI details.",
    ],
  },
  refunds: {
    title: "Refund and Transfer Policy",
    points: [
      "Registrations are non-refundable.",
      "A BIB cannot be transferred to, or exchanged for, another person.",
      "If money was deducted but you did not receive a BIB, contact us with the reference shown on your registration page. We will check the payment and resolve it.",
    ],
  },
};

export default function LegalPage({ page }: { page: keyof typeof PAGES }) {
  const { title, points } = PAGES[page];

  return (
    <>
      <SiteHeader basePath="/" />

      <header className="hero-fallback px-4 py-14 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-orange-300">
            Pawankhind · Season 3
          </p>
          <h1 className="mt-2 font-display text-5xl tracking-wide sm:text-6xl">{title}</h1>
        </div>
      </header>

      <main className="bg-[#f3e9d2] px-4 py-12">
        <article className="mx-auto max-w-3xl rounded-xl border border-orange-900/20 bg-white/70 p-6 text-stone-800 shadow-sm sm:p-8">
          <ul className="space-y-4">
            {points.map((p) => (
              <li key={p} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-2 h-2 w-2 shrink-0 rounded-full bg-orange-600"
                />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-sm text-stone-600">
            Questions? Call {EVENT.contact.name} on {EVENT.contact.phone}.
          </p>
          <Link
            to="/"
            className="mt-4 inline-block rounded-full bg-orange-600 px-6 py-2 text-sm font-semibold text-white"
          >
            Back to home
          </Link>
        </article>
      </main>

      <SiteFooter />
    </>
  );
}
