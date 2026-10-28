import { HERO_IMAGE } from "./images.js";

/** Covers the hero only. A short fade at the bottom blends into the dark section below. */
export default function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden">
      {HERO_IMAGE ? (
        <img
          src={HERO_IMAGE}
          alt=""
          fetchPriority="high"
          className="h-full w-full object-cover object-center"
        />
      ) : (
        <div className="hero-fallback h-full w-full" />
      )}
      <div className="absolute inset-0 bg-linear-to-r from-stone-950/90 via-stone-950/55 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-stone-950 to-transparent" />
    </div>
  );
}
