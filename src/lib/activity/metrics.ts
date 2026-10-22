import type { Activity, ActivityMetrics, MetricAvailability, MetricKey, Split, TrackPoint } from './types';
import { haversine } from './util';

/**
 * Calculation rules (also documented in docs/METRICS.md):
 *
 * Distance       override > device-recorded cumulative distance (TCX/FIT `distance`)
 *                > sum of haversine distances between consecutive GPS points > file summary.
 * Elapsed time   override > last timestamp - first timestamp > file summary elapsed.
 * Moving time    override > sum of intervals between consecutive timestamped points whose
 *                speed is >= MOVING_SPEED_MPS (0.5 m/s ≈ 33:20 min/km). Gaps longer than
 *                MAX_GAP_S are counted only if their average speed is also above the
 *                threshold. Falls back to the device's timer time, then elapsed time.
 * Avg pace       moving time / distance (s per km).  Avg speed = distance / moving time.
 * Max speed      highest average speed over any window of >= MAX_SPEED_WINDOW_S seconds
 *                (rolling window, suppresses single-point GPS spikes).
 * Best pace      fastest complete 1 km split.
 * Elevation      elevations are smoothed with a centred moving average of ELE_SMOOTH points;
 *                gain/loss accumulate only once a climb/descent exceeds ELE_HYSTERESIS_M
 *                (hysteresis), which removes barometric/GPS noise.
 *                Falls back to the file summary (FIT totalAscent) if no elevation samples.
 * Heart rate     time-weighted mean of samples; max = max sample. Cadence: time-weighted
 *                mean of non-zero samples (steps/min for running).
 * Splits         per 1 km (or 1 mile in imperial mode); boundary times are linearly
 *                interpolated between the points either side of the boundary.
 */
export const MOVING_SPEED_MPS = 0.5;
export const MAX_GAP_S = 30;
export const MAX_SPEED_WINDOW_S = 10;
export const ELE_SMOOTH = 5;
export const ELE_HYSTERESIS_M = 2;

export function cumulativeDistance(points: TrackPoint[]): { cum: number[]; source: 'device' | 'gps' | 'none' } {
  const cum = new Array<number>(points.length).fill(0);
  const deviceCount = points.filter((p) => p.dist !== undefined).length;
  if (deviceCount >= Math.max(2, points.length * 0.8)) {
    let last = 0;
    for (let i = 0; i < points.length; i++) {
      const d = points[i].dist;
      last = d !== undefined && d >= last ? d : last;
      cum[i] = last;
    }
    return { cum, source: 'device' };
  }
  let total = 0;
  let prev: TrackPoint | undefined;
  let any = false;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.lat !== undefined && p.lon !== undefined) {
      if (prev) {
        total += haversine(prev.lat!, prev.lon!, p.lat, p.lon);
        any = true;
      }
      prev = p;
    }
    cum[i] = total;
  }
  return { cum, source: any ? 'gps' : 'none' };
}

function smooth(values: number[], window: number): number[] {
  const half = Math.floor(window / 2);
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      s += values[j];
      c++;
    }
    out[i] = s / c;
  }
  return out;
}

export function elevationGainLoss(eles: number[]): { gain: number; loss: number } {
  if (eles.length < 2) return { gain: 0, loss: 0 };
  const s = smooth(eles, ELE_SMOOTH);
  let gain = 0;
  let loss = 0;
  let ref = s[0];
  for (let i = 1; i < s.length; i++) {
    const d = s[i] - ref;
    if (d >= ELE_HYSTERESIS_M) {
      gain += d;
      ref = s[i];
    } else if (d <= -ELE_HYSTERESIS_M) {
      loss -= d;
      ref = s[i];
    }
  }
  return { gain, loss };
}

export function computeMetrics(a: Activity, splitUnitM = 1000): ActivityMetrics {
  const pts = a.points;
  const { cum, source } = cumulativeDistance(pts);
  const av = {} as Record<MetricKey, MetricAvailability>;
  const na = (reason: string): MetricAvailability => ({ available: false, reason });
  const ok: MetricAvailability = { available: true };

  // Distance
  let distanceM: number | null = null;
  let distanceSource: ActivityMetrics['distanceSource'] = 'none';
  if (a.overrides.distanceM !== undefined) {
    distanceM = a.overrides.distanceM;
    distanceSource = 'override';
  } else if (source !== 'none' && cum[cum.length - 1] > 0) {
    distanceM = cum[cum.length - 1];
    distanceSource = source;
  } else if (a.fileSummary.distanceM !== undefined) {
    distanceM = a.fileSummary.distanceM;
    distanceSource = 'summary';
  }
  av.distance = distanceM !== null ? ok : na('The file has no GPS positions or recorded distance.');

  // Times
  const timedIdx: number[] = [];
  pts.forEach((p, i) => p.time !== undefined && timedIdx.push(i));
  let elapsedS: number | null = a.overrides.elapsedS ?? null;
  if (elapsedS === null && timedIdx.length >= 2)
    elapsedS = (pts[timedIdx[timedIdx.length - 1]].time! - pts[timedIdx[0]].time!) / 1000;
  if (elapsedS === null && a.fileSummary.elapsedS !== undefined) elapsedS = a.fileSummary.elapsedS;

  let movingS: number | null = a.overrides.movingS ?? null;
  let maxSpeed: number | null = null;
  if (movingS === null && timedIdx.length >= 2 && source !== 'none') {
    let m = 0;
    for (let k = 1; k < timedIdx.length; k++) {
      const i0 = timedIdx[k - 1];
      const i1 = timedIdx[k];
      const dt = (pts[i1].time! - pts[i0].time!) / 1000;
      if (dt <= 0) continue;
      const v = (cum[i1] - cum[i0]) / dt;
      if (v >= MOVING_SPEED_MPS) m += dt;
    }
    movingS = m;
  }
  if (movingS === null && a.fileSummary.movingS !== undefined) movingS = a.fileSummary.movingS;
  if (movingS === null && elapsedS !== null) movingS = elapsedS;
  if (timedIdx.length >= 2 && source !== 'none') {
    // Rolling window max speed
    let j = 0;
    for (let k = 0; k < timedIdx.length; k++) {
      const ik = timedIdx[k];
      while (j < k && (pts[ik].time! - pts[timedIdx[j + 1]].time!) / 1000 >= MAX_SPEED_WINDOW_S) j++;
      const ij = timedIdx[j];
      const dt = (pts[ik].time! - pts[ij].time!) / 1000;
      if (dt >= MAX_SPEED_WINDOW_S) {
        const v = (cum[ik] - cum[ij]) / dt;
        if (maxSpeed === null || v > maxSpeed) maxSpeed = v;
      }
    }
  }
  const noTime = 'The file has no timestamps.';
  av.elapsedTime = elapsedS !== null ? ok : na(noTime);
  av.movingTime = movingS !== null ? ok : na(noTime);

  const avgSpeed = distanceM && movingS ? distanceM / movingS : null;
  const avgPace = distanceM && movingS ? movingS / (distanceM / 1000) : null;
  av.avgPace = avgPace !== null ? ok : na('Needs both distance and time.');
  av.avgSpeed = av.avgPace;
  av.maxSpeed = maxSpeed !== null ? ok : na('Needs timestamped GPS or distance samples.');

  // Splits
  const splits: Split[] = [];
  if (timedIdx.length >= 2 && source !== 'none') {
    const timeAt = (d: number): number | null => {
      for (let k = 1; k < timedIdx.length; k++) {
        const i0 = timedIdx[k - 1];
        const i1 = timedIdx[k];
        if (cum[i1] >= d) {
          const span = cum[i1] - cum[i0];
          const f = span > 0 ? (d - cum[i0]) / span : 0;
          return pts[i0].time! + f * (pts[i1].time! - pts[i0].time!);
        }
      }
      return null;
    };
    const eleAt = (d: number): number | null => {
      for (let i = 1; i < pts.length; i++) if (cum[i] >= d && pts[i].ele !== undefined) return pts[i].ele!;
      return null;
    };
    const total = cum[cum.length - 1];
    let startD = 0;
    let startT = pts[timedIdx[0]].time!;
    let startE = eleAt(0);
    for (let idx = 1; startD < total - 1; idx++) {
      const endD = Math.min(idx * splitUnitM, total);
      const endT = timeAt(endD);
      if (endT === null) break;
      const endE = eleAt(endD);
      const len = endD - startD;
      if (len < 50 && endD === total) break; // ignore tiny trailing fragments
      const dur = (endT - startT) / 1000;
      splits.push({
        index: idx,
        distanceM: len,
        durationS: dur,
        paceSPerKm: dur / (len / 1000),
        elevDeltaM: startE !== null && endE !== null ? endE - startE : null,
      });
      startD = endD;
      startT = endT;
      startE = endE;
    }
  }
  const full = splits.filter((s) => s.distanceM >= splitUnitM - 1);
  const bestPace = full.length ? Math.min(...full.map((s) => s.paceSPerKm)) : null;
  av.bestPace = bestPace !== null ? ok : na('Needs at least one complete split with timestamps.');
  av.fastestSplit = av.bestPace;

  // Elevation
  const eles = pts.map((p) => p.ele).filter((e): e is number => e !== undefined);
  let elevGain: number | null = null;
  let elevLoss: number | null = null;
  if (eles.length >= 2) {
    const r = elevationGainLoss(eles);
    elevGain = r.gain;
    elevLoss = r.loss;
  } else {
    elevGain = a.fileSummary.elevGainM ?? null;
    elevLoss = a.fileSummary.elevLossM ?? null;
  }
  const noEle = 'The file has no elevation data.';
  av.elevGain = elevGain !== null ? ok : na(noEle);
  av.elevLoss = elevLoss !== null ? ok : na(noEle);
  const minEle = eles.length ? Math.min(...eles) : null;
  const maxEle = eles.length ? Math.max(...eles) : null;
  av.minEle = minEle !== null ? ok : na(noEle);
  av.maxEle = av.minEle;

  // HR & cadence — time-weighted
  const weighted = (get: (p: TrackPoint) => number | undefined, skipZero: boolean) => {
    let sum = 0;
    let w = 0;
    let max: number | null = null;
    let count = 0;
    for (let i = 0; i < pts.length; i++) {
      const v = get(pts[i]);
      if (v === undefined || (skipZero && v === 0)) continue;
      count++;
      max = max === null ? v : Math.max(max, v);
      const next = pts[i + 1];
      const dt = pts[i].time !== undefined && next?.time !== undefined ? Math.min((next.time - pts[i].time!) / 1000, MAX_GAP_S) : 1;
      const wt = dt > 0 ? dt : 1;
      sum += v * wt;
      w += wt;
    }
    return { avg: count ? sum / w : null, max };
  };
  const hr = weighted((p) => p.hr, true);
  const avgHr = hr.avg ?? a.fileSummary.avgHr ?? null;
  const maxHr = hr.max ?? a.fileSummary.maxHr ?? null;
  av.avgHr = avgHr !== null ? ok : na('No heart-rate data in the file.');
  av.maxHr = maxHr !== null ? ok : na('No heart-rate data in the file.');
  const cad = weighted((p) => p.cad, true);
  av.avgCadence = cad.avg !== null ? ok : na('No cadence data in the file.');

  const calories = a.overrides.calories ?? a.fileSummary.calories ?? null;
  av.calories = calories !== null ? ok : na('The file has no calorie data (it can be entered manually).');
  av.date = a.startTime !== undefined ? ok : na('The file has no start time.');
  av.startTime = av.date;
  av.name = ok;
  av.location = a.overrides.location ? ok : na('Add a location in Activity details.');

  return {
    distanceM,
    elapsedS,
    movingS,
    avgPaceSPerKm: avgPace,
    avgSpeedMps: avgSpeed,
    maxSpeedMps: maxSpeed,
    bestPaceSPerKm: bestPace,
    elevGainM: elevGain,
    elevLossM: elevLoss,
    minEleM: minEle,
    maxEleM: maxEle,
    avgHr,
    maxHr,
    avgCadence: cad.avg,
    calories,
    splits,
    cumDist: cum,
    distanceSource,
    availability: av,
  };
}

/** Distance-indexed series (for charts and pace-coloured routes). */
export function buildSeries(a: Activity, m: ActivityMetrics, kind: 'elevation' | 'pace' | 'heartrate', samples = 200) {
  const pts = a.points;
  const total = m.cumDist[m.cumDist.length - 1] ?? 0;
  if (total <= 0 || pts.length < 2) return [] as { d: number; v: number }[];
  const out: { d: number; v: number }[] = [];
  let i = 0;
  for (let s = 0; s <= samples; s++) {
    const d = (s / samples) * total;
    while (i < pts.length - 1 && m.cumDist[i + 1] < d) i++;
    if (kind === 'elevation') {
      const e = pts[i].ele;
      if (e !== undefined) out.push({ d, v: e });
    } else if (kind === 'heartrate') {
      const h = pts[i].hr;
      if (h !== undefined) out.push({ d, v: h });
    } else {
      // pace from a ~100 m window around d
      const lo = Math.max(0, d - 50);
      const hi = Math.min(total, d + 50);
      const t0 = timeAtDist(a, m, lo);
      const t1 = timeAtDist(a, m, hi);
      if (t0 !== null && t1 !== null && hi > lo && t1 > t0) out.push({ d, v: (t1 - t0) / 1000 / ((hi - lo) / 1000) });
    }
  }
  return out;
}

function timeAtDist(a: Activity, m: ActivityMetrics, d: number): number | null {
  const pts = a.points;
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (m.cumDist[mid] < d) lo = mid + 1;
    else hi = mid;
  }
  const p1 = pts[lo];
  const p0 = pts[Math.max(0, lo - 1)];
  if (p0.time === undefined || p1.time === undefined) return null;
  const span = m.cumDist[lo] - m.cumDist[Math.max(0, lo - 1)];
  const f = span > 0 ? (d - m.cumDist[Math.max(0, lo - 1)]) / span : 0;
  return p0.time + f * (p1.time - p0.time);
}
