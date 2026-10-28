const ITEMS = [
  {
    q: "What do I get when I register?",
    a: "A T-shirt, a finisher medal and refreshments after you complete the 5 km run. You also get your BIB number.",
  },
  {
    q: "When and where do I collect my kit?",
    a: "On 15 January from 4 pm to 8 pm, or on 16 January from 10 am to 8 pm. Please carry a photo ID. Kits are not handed out on race day.",
  },
  {
    q: "Can I register on the day?",
    a: "No. There is no on-spot registration. Register online before 8 January 2027, or until all 3,000 places are taken.",
  },
  {
    q: "Can I get a refund or give my BIB to someone else?",
    a: "No. Registrations are non-refundable and a BIB cannot be transferred.",
  },
  {
    q: "Is the run timed? Will I get a certificate?",
    a: "There is no timing chip and there are no certificates. Every finisher receives a medal.",
  },
  {
    q: "How do I get my BIB number?",
    a: "You see it on the confirmation page as soon as your payment is confirmed. Keep the link to that page to see it again.",
  },
  {
    q: "Who can I contact?",
    a: "Call Jayshil on +91 9033049847.",
  },
];

export default function Faq() {
  return (
    <section id="faq" className="scroll-mt-28 bg-[#f3e9d2] px-4 py-14">
      <div className="mx-auto max-w-3xl">
        <h2 className="mb-4 font-display text-4xl tracking-widest text-stone-900">
          FREQUENTLY ASKED QUESTIONS
        </h2>
        <div className="divide-y divide-orange-900/20 rounded-xl border border-orange-900/20 bg-white/60">
          {ITEMS.map((i) => (
            <details key={i.q} className="p-4">
              <summary className="cursor-pointer font-semibold text-stone-900">{i.q}</summary>
              <p className="mt-2 text-stone-700">{i.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
