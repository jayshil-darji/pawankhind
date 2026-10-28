import { useEffect, useState } from "react";
import { timeToRaceStart } from "./event.js";

const pad = (n: number) => String(n).padStart(2, "0");

export default function Countdown() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const t = timeToRaceStart(now);
  if (t.done) return <p className="font-display text-3xl tracking-widest">Race day is here</p>;

  const units = [
    { value: String(t.days), label: "Days" },
    { value: pad(t.hours), label: "Hours" },
    { value: pad(t.minutes), label: "Minutes" },
    { value: pad(t.seconds), label: "Seconds" },
  ];

  return (
    <div role="timer" className="flex justify-center gap-4 sm:gap-8">
      {units.map((u) => (
        <div key={u.label} className="min-w-16 text-center">
          <span className="block font-display text-5xl sm:text-6xl">{u.value}</span>
          <span className="block text-xs uppercase tracking-widest">{u.label}</span>
        </div>
      ))}
    </div>
  );
}
