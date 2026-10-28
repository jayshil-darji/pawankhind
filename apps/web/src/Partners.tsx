export interface Partner {
  name: string;
  logo: string;
  url?: string;
}
export interface PartnerTier {
  title: string;
  partners: Partner[];
}

/** Renders nothing until at least one tier has a partner. */
export default function Partners({ tiers }: { tiers: PartnerTier[] }) {
  const shown = tiers.filter((t) => t.partners.length > 0);
  if (shown.length === 0) return null;

  return (
    <section id="partners" className="bg-white px-4 py-14">
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="mb-8 font-display text-4xl tracking-widest text-stone-900">Our Partners</h2>
        {shown.map((tier) => (
          <div key={tier.title} className="mb-8">
            <h3 className="mb-3 font-semibold text-stone-600">{tier.title}</h3>
            <div className="flex flex-wrap justify-center gap-4">
              {tier.partners.map((p) => (
                <div key={p.name} className="rounded-xl bg-white px-8 py-6 shadow-md">
                  <img src={p.logo} alt={p.name} className="h-16 w-auto object-contain" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
