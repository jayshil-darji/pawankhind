import { EVENT } from "./event.js";

const HOLES = ["left-3 top-3", "right-3 top-3", "left-3 bottom-3", "right-3 bottom-3"];

export default function BibCard({ bib, reference }: { bib: number; reference: string }) {
  return (
    <div className="bib-print relative mx-auto w-full max-w-md overflow-hidden rounded-xl bg-white text-stone-900 shadow-2xl">
      {HOLES.map((h) => (
        <span
          key={h}
          aria-hidden="true"
          className={`absolute ${h} z-10 h-3 w-3 rounded-full bg-stone-900 ring-1 ring-white/50`}
        />
      ))}

      <div className="bg-orange-600 px-8 py-5 text-center text-white">
        <p className="font-display text-3xl tracking-[0.25em]">PAWANKHIND</p>
        <p className="text-xs font-semibold tracking-[0.35em]">SEASON 3 · 5 KM RUN</p>
      </div>

      <div className="px-6 pb-6 pt-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-stone-500">
          Your BIB number
        </p>
        <p className="font-display text-[8rem] leading-none sm:text-[10rem]">{bib}</p>
      </div>

      <div className="relative border-t-2 border-dashed border-stone-300 px-6 py-4 text-center text-xs text-stone-600">
        <span
          aria-hidden="true"
          className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-stone-950 print:hidden"
        />
        <span
          aria-hidden="true"
          className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-stone-950 print:hidden"
        />
        <p className="font-semibold uppercase tracking-wide text-stone-800">
          Kit collection · carry a photo ID
        </p>
        {EVENT.kit.map((k) => (
          <p key={k.day}>{`${k.day}: ${k.time}`}</p>
        ))}
        <p>Kits are not given on race day.</p>
      </div>

      <div className="bg-stone-900 px-8 py-5 text-center text-white">
        <p className="font-display text-xl tracking-[0.2em]">
          {EVENT.raceDay.toUpperCase()} · VISNAGAR
        </p>
        <p className="mt-1 text-[10px] text-stone-400">
          Reference <span className="text-stone-300">{reference}</span>
        </p>
      </div>
    </div>
  );
}
