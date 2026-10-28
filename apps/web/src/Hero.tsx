import { EVENT } from "./event.js";

export default function Hero({ cta }: { cta: string }) {
  return (
    <header id="top" className="text-white">
      <div className="mx-auto max-w-6xl px-4 pb-32 pt-16 sm:pt-24 md:pb-44">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-orange-300">
          Visnagar · Season 3
        </p>
        <h1 className="mt-3 font-display text-7xl tracking-wide sm:text-9xl">{EVENT.name}</h1>
        <p className="font-display text-4xl tracking-wider text-orange-400 sm:text-6xl">5 KM RUN</p>
        <p className="mt-5 max-w-md text-lg text-stone-200">
          {EVENT.raceDay} · Start and finish at {EVENT.venue}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="#register" className="rounded-full bg-orange-600 px-7 py-3 font-semibold">
            {cta}
          </a>
          <a href="#info" className="rounded-full border border-white/70 px-7 py-3 font-semibold">
            Race info
          </a>
        </div>
      </div>
    </header>
  );
}
