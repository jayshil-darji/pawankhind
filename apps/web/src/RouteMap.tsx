import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ROUTE } from "./route.js";

export default function RouteMap() {
  const ref = useRef<SVGSVGElement>(null);
  // Browsers that cannot watch scrolling just show the finished map.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen]);

  return (
    <svg
      ref={ref}
      role="img"
      aria-label="Map of the 5 km loop, starting and finishing at SK University, Visnagar"
      viewBox={ROUTE.viewBox}
      className="route-map w-full rounded-2xl bg-stone-100"
      data-seen={seen}
    >
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="#e7e5e4" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="400" height="280" fill="url(#grid)" />

      <path
        d={ROUTE.d}
        pathLength={1}
        className="route-line"
        fill="none"
        stroke="#c2410c"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {ROUTE.kmMarks.map((m) => (
        <g key={m.km} className="route-km" style={{ "--i": m.km } as CSSProperties}>
          <circle cx={m.x} cy={m.y} r={9} fill="white" stroke="#c2410c" strokeWidth={2} />
          <text
            x={m.x}
            y={m.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={10}
            fontWeight={700}
            fill="#7c2d12"
          >
            {m.km}
          </text>
        </g>
      ))}

      <circle
        cx={ROUTE.start.x}
        cy={ROUTE.start.y}
        r={8}
        fill="#166534"
        stroke="white"
        strokeWidth={2}
      />
      <text
        x={ROUTE.start.x}
        y={ROUTE.start.y + 26}
        textAnchor="middle"
        fontSize={11}
        fill="#44403c"
      >
        Start / Finish · SK University
      </text>
    </svg>
  );
}
