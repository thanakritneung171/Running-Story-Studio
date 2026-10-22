import type { Activity, ActivityMetrics } from '../activity/types';

export interface XY {
  x: number;
  y: number;
}
export interface RoutePoint extends XY {
  /** Cumulative distance along the route in metres. */
  d: number;
  /** Index into activity.points. */
  i: number;
}

/** Web-Mercator projection in metres-ish units (y grows downward, like canvas). */
export function project(lat: number, lon: number): XY {
  const R = 6378137;
  const x = (lon * Math.PI * R) / 180;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const y = R * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
  return { x, y: -y };
}

/** Ramer–Douglas–Peucker simplification (iterative). Tolerance in projected units. */
export function simplify<T extends XY>(pts: T[], tolerance: number): T[] {
  if (pts.length <= 2 || tolerance <= 0) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist2(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > tol2) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function segDist2(p: XY, a: XY, b: XY): number {
  let x = a.x;
  let y = a.y;
  let dx = b.x - x;
  let dy = b.y - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b.x;
      y = b.y;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p.x - x;
  dy = p.y - y;
  return dx * dx + dy * dy;
}

export interface ProjectedRoute {
  points: RoutePoint[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  totalD: number;
}

/**
 * Project the GPS track. `privacyTrimM` hides the first and last N metres (home/work privacy).
 * Mercator distortion is corrected implicitly because we fit to the projected bounds.
 */
export function projectRoute(a: Activity, m: ActivityMetrics, privacyTrimM = 0): ProjectedRoute | null {
  const out: RoutePoint[] = [];
  const total = m.cumDist[m.cumDist.length - 1] ?? 0;
  for (let i = 0; i < a.points.length; i++) {
    const p = a.points[i];
    if (p.lat === undefined || p.lon === undefined) continue;
    const d = m.cumDist[i];
    if (privacyTrimM > 0 && (d < privacyTrimM || d > total - privacyTrimM)) continue;
    const xy = project(p.lat, p.lon);
    out.push({ x: xy.x, y: xy.y, d, i });
  }
  if (out.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of out) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { points: out, bounds: { minX, minY, maxX, maxY }, totalD: total };
}

/** Fit projected route into a w×h box with padding, preserving aspect ratio. */
export function fitRoute(r: ProjectedRoute, w: number, h: number, padding: number, simplifyPx = 0.75): RoutePoint[] {
  const { minX, minY, maxX, maxY } = r.bounds;
  const bw = Math.max(maxX - minX, 1e-9);
  const bh = Math.max(maxY - minY, 1e-9);
  const iw = Math.max(1, w - padding * 2);
  const ih = Math.max(1, h - padding * 2);
  const s = Math.min(iw / bw, ih / bh);
  const ox = padding + (iw - bw * s) / 2;
  const oy = padding + (ih - bh * s) / 2;
  const fitted = r.points.map((p) => ({ x: ox + (p.x - minX) * s, y: oy + (p.y - minY) * s, d: p.d, i: p.i }));
  return simplify(fitted, simplifyPx);
}

/** Truncate a polyline to the first `fraction` of its distance (for draw animation). */
export function partialRoute(pts: RoutePoint[], fraction: number): RoutePoint[] {
  if (fraction >= 1) return pts;
  if (fraction <= 0 || pts.length < 2) return pts.slice(0, 1);
  const startD = pts[0].d;
  const target = startD + (pts[pts.length - 1].d - startD) * fraction;
  const out: RoutePoint[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.d <= target) out.push(p);
    else {
      const q = pts[i - 1];
      const f = (target - q.d) / Math.max(p.d - q.d, 1e-9);
      out.push({ x: q.x + (p.x - q.x) * f, y: q.y + (p.y - q.y) * f, d: target, i: q.i });
      break;
    }
  }
  return out;
}
