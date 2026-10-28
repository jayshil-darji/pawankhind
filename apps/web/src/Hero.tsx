import { EVENT } from "./event.js";

export default function Hero() {
  return (
    <header className="bg-linear-to-br from-orange-600 via-red-800 to-stone-950 px-4 py-20 text-center text-white">
      <p className="text-sm uppercase tracking-[0.3em] text-orange-200">Visnagar · Season 3</p>
      <h1 className="mt-3 text-6xl font-extrabold tracking-tight sm:text-8xl">{EVENT.name}</h1>
      <p className="mt-2 text-2xl font-semibold sm:text-3xl">5 KM Run</p>
      <p className="mt-6 text-lg">
        {EVENT.raceDay} · Start and finish at {EVENT.venue}
      </p>
      <a
        href="#register"
        className="mt-8 inline-block rounded-full bg-white px-8 py-3 font-semibold text-red-900"
      >
        Register now
      </a>
      <p className="mx-auto mt-12 max-w-md text-xs text-orange-100/80">
        Inspired by the 300 who ran through the night at Pawan Khind.
      </p>
    </header>
  );
}
