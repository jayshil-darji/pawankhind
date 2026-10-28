// PLACEHOLDER: an invented street-grid loop, NOT the real route.
// When the real GPX exists, a script will generate this same shape from it.
// 980 units of path = 5 km, so one kilometre is 196 units.
export const ROUTE = {
  viewBox: "0 0 400 280",
  d: "M60 230 L60 150 L130 150 L130 70 L250 70 L250 120 L340 120 L340 230 L220 230 L220 180 L150 180 L150 230 Z",
  start: { x: 60, y: 230 },
  kmMarks: [
    { km: 1, x: 130, y: 104 },
    { km: 2, x: 250, y: 112 },
    { km: 3, x: 340, y: 218 },
    { km: 4, x: 206, y: 180 },
  ],
} as const;
