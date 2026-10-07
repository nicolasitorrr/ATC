// Flat-earth geometry in nautical miles. x grows east, y grows north,
// angles are compass degrees (0 = north, clockwise).

export const DEG = Math.PI / 180;

export function norm360(a: number): number {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
}

/** Signed shortest turn from `from` to `to`, in (-180, 180]. Positive = right. */
export function angleDiff(from: number, to: number): number {
  let d = norm360(to - from);
  if (d > 180) d -= 360;
  return d;
}

export function bearing(x1: number, y1: number, x2: number, y2: number): number {
  return norm360(Math.atan2(x2 - x1, y2 - y1) / DEG);
}

export function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function project(x: number, y: number, hdg: number, d: number): { x: number; y: number } {
  return { x: x + Math.sin(hdg * DEG) * d, y: y + Math.cos(hdg * DEG) * d };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Small seedable PRNG so sessions and tests are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
