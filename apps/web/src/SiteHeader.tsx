import { useState } from "react";

const LINKS = [
  { label: "About", href: "#about" },
  { label: "Route", href: "#route" },
  { label: "Race info", href: "#info" },
  { label: "FAQ", href: "#faq" },
];

/** basePath is "" on the home page, and "/" on other pages so the links lead back to home. */
export default function SiteHeader({ basePath = "" }: { basePath?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <nav aria-label="Main" className="sticky top-0 z-50 bg-stone-900 text-white shadow-md">
      <div className="mx-auto flex max-w-6xl items-stretch justify-between">
        <a
          href={basePath === "" ? "#top" : basePath}
          className="logo-plate flex items-center bg-orange-600 py-3 pl-4 pr-10 font-display text-2xl tracking-widest"
        >
          PAWANKHIND
        </a>
        <button
          type="button"
          aria-label="Menu"
          aria-expanded={open}
          aria-controls="site-menu"
          onClick={() => setOpen((o) => !o)}
          className="px-4 text-2xl md:hidden"
        >
          {open ? "✕" : "☰"}
        </button>
        <ul
          id="site-menu"
          className={`${open ? "flex" : "hidden"} absolute inset-x-0 top-full flex-col gap-1 bg-stone-900 px-4 pb-4 md:static md:flex md:flex-row md:items-center md:gap-6 md:p-0 md:pr-4`}
        >
          {LINKS.map((l) => (
            <li key={l.href}>
              <a
                href={`${basePath}${l.href}`}
                onClick={() => setOpen(false)}
                className="block py-2 text-sm font-medium text-stone-200 hover:text-white"
              >
                {l.label}
              </a>
            </li>
          ))}
          <li>
            <a
              href={`${basePath}#register`}
              onClick={() => setOpen(false)}
              className="inline-block rounded-full bg-orange-600 px-5 py-2 text-sm font-semibold"
            >
              Register
            </a>
          </li>
        </ul>
      </div>
    </nav>
  );
}
