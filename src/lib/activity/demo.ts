import type { Activity, TrackPoint } from './types';
import { uid } from '../design/ids';

/**
 * Deterministic DEMONSTRATION activity (clearly flagged with isDemo). Not real data.
 * A 7.3 km loop shaped around a city park, ~5:20/km with gentle undulation.
 */
export function demoActivity(): Activity {
  const pts: TrackPoint[] = [];
  const c = { lat: 13.7307, lon: 100.5418 };
  const mPerDeg = (Math.PI / 180) * 6371008.8;
  const n = 1400;
  let t = Date.UTC(2026, 4, 3, 5, 30, 0);
  let prev: { x: number; y: number } | null = null;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 520 + 160 * Math.sin(3 * a) + 60 * Math.cos(5 * a);
    const x = Math.cos(a) * r * 1.3;
    const y = Math.sin(a) * r;
    if (prev) t += (Math.hypot(x - prev.x, y - prev.y) / (3.1 + 0.4 * Math.sin(a * 2))) * 1000;
    prev = { x, y };
    pts.push({
      lat: c.lat + y / mPerDeg,
      lon: c.lon + x / (mPerDeg * Math.cos((c.lat * Math.PI) / 180)),
      ele: 8 + 6 * Math.sin(a * 2) + 3 * Math.sin(a * 7),
      time: Math.round(t),
      hr: Math.round(145 + 12 * Math.sin(a)),
      cad: 172,
    });
  }
  return {
    id: uid('a'),
    source: { format: 'gpx', fileName: 'demo-activity.gpx', importedAt: Date.now() },
    name: 'Morning Park Loop (demo data)',
    sport: 'running',
    startTime: pts[0].time,
    points: pts,
    laps: [],
    fileSummary: { calories: 512 },
    overrides: {},
    isDemo: true,
    warnings: ['This is demonstration data, not a real activity.'],
  };
}
