const STEPS = [
  { date: "15 Nov 2026", label: "Registration opens" },
  { date: "8 Jan 2027", label: "Registration closes, or earlier if all 3,000 places are taken" },
  { date: "15–16 Jan 2027", label: "Kit collection" },
  { date: "17 Jan 2027", label: "Race day, reporting 6:00 am and flag off time 7:00" },
];

export default function Timeline() {
  return (
    <ol className="mb-8 grid gap-4 sm:grid-cols-4">
      {STEPS.map((s) => (
        <li key={s.date} className="border-t-4 border-orange-600 bg-white/60 p-4">
          <p className="font-display text-2xl tracking-wide text-orange-800">{s.date}</p>
          <p className="mt-1 text-sm text-stone-700">{s.label}</p>
        </li>
      ))}
    </ol>
  );
}
