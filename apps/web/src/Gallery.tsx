import { GALLERY } from "./images.js";

export default function Gallery() {
  if (GALLERY.length === 0) return null;

  return (
    <section className="bg-stone-950 px-4 py-14 text-white">
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-4 font-display text-4xl tracking-widest">GALLERY</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {GALLERY.map((src) => (
            <img
              key={src}
              src={src}
              alt="Photo from a previous Pawankhind run"
              loading="lazy"
              decoding="async"
              className="aspect-[4/3] w-full rounded-lg object-cover"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
