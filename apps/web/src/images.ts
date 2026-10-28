const urls = (files: Record<string, string>) =>
  Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, url]) => url);

const hero = import.meta.glob<string>("./assets/hero.{jpg,jpeg,png,webp,avif}", {
  eager: true,
  query: "?url",
  import: "default",
});
const legend = import.meta.glob<string>("./assets/legend.{jpg,jpeg,png,webp,avif}", {
  eager: true,
  query: "?url",
  import: "default",
});
const gallery = import.meta.glob<string>("./assets/gallery/*.{jpg,jpeg,png,webp,avif}", {
  eager: true,
  query: "?url",
  import: "default",
});

/** Drop files named hero.webp, legend.webp and gallery/*.webp into src/assets and restart dev. */
export const HERO_IMAGE: string | null = urls(hero)[0] ?? null;
export const LEGEND_IMAGE: string | null = urls(legend)[0] ?? null;
export const GALLERY: string[] = urls(gallery);
