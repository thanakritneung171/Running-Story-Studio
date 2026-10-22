import type { Activity, ActivityMetrics, MetricKey } from './types';

export type Units = 'metric' | 'imperial';
const M_PER_MI = 1609.344;
const FT_PER_M = 3.28084;

export function formatDuration(s: number): string {
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
const pad = (n: number) => String(n).padStart(2, '0');

export function formatPace(sPerKm: number, units: Units): string {
  const s = units === 'metric' ? sPerKm : sPerKm * (M_PER_MI / 1000);
  if (!Number.isFinite(s) || s <= 0) return '–';
  let m = Math.floor(s / 60);
  let sec = Math.round(s - m * 60);
  if (sec === 60) {
    m += 1;
    sec = 0;
  }
  return `${m}:${pad(sec)}`;
}

export interface MetricDescriptor {
  key: MetricKey;
  label: string;
  /** Short label used on graphics. */
  short: string;
}

export const METRICS: MetricDescriptor[] = [
  { key: 'distance', label: 'Distance', short: 'Distance' },
  { key: 'movingTime', label: 'Moving time', short: 'Time' },
  { key: 'elapsedTime', label: 'Elapsed time', short: 'Elapsed' },
  { key: 'avgPace', label: 'Average pace', short: 'Pace' },
  { key: 'avgSpeed', label: 'Average speed', short: 'Speed' },
  { key: 'maxSpeed', label: 'Max speed', short: 'Max speed' },
  { key: 'bestPace', label: 'Fastest km/mi split', short: 'Best split' },
  { key: 'elevGain', label: 'Elevation gain', short: 'Elev gain' },
  { key: 'elevLoss', label: 'Elevation loss', short: 'Elev loss' },
  { key: 'minEle', label: 'Min elevation', short: 'Min elev' },
  { key: 'maxEle', label: 'Max elevation', short: 'Max elev' },
  { key: 'avgHr', label: 'Average heart rate', short: 'Avg HR' },
  { key: 'maxHr', label: 'Max heart rate', short: 'Max HR' },
  { key: 'avgCadence', label: 'Average cadence', short: 'Cadence' },
  { key: 'calories', label: 'Calories', short: 'Calories' },
  { key: 'date', label: 'Date', short: 'Date' },
  { key: 'startTime', label: 'Start time', short: 'Start' },
  { key: 'name', label: 'Activity name', short: 'Name' },
  { key: 'location', label: 'Location', short: 'Location' },
];
export const metricLabel = (k: MetricKey) => METRICS.find((m) => m.key === k)?.short ?? k;

export interface FormattedMetric {
  value: string;
  unit: string;
  /** Numeric value for count-up animation, in display units. */
  numeric?: number;
  decimals?: number;
  available: boolean;
}

export function formatMetric(key: MetricKey, a: Activity, m: ActivityMetrics, units: Units): FormattedMetric {
  const imperial = units === 'imperial';
  const missing: FormattedMetric = { value: '–', unit: '', available: false };
  switch (key) {
    case 'distance': {
      if (m.distanceM === null) return missing;
      const v = imperial ? m.distanceM / M_PER_MI : m.distanceM / 1000;
      return { value: v.toFixed(2), unit: imperial ? 'mi' : 'km', numeric: v, decimals: 2, available: true };
    }
    case 'movingTime':
      return m.movingS === null ? missing : { value: formatDuration(m.movingS), unit: '', numeric: m.movingS, available: true };
    case 'elapsedTime':
      return m.elapsedS === null ? missing : { value: formatDuration(m.elapsedS), unit: '', numeric: m.elapsedS, available: true };
    case 'avgPace':
      return m.avgPaceSPerKm === null
        ? missing
        : { value: formatPace(m.avgPaceSPerKm, units), unit: imperial ? '/mi' : '/km', available: true };
    case 'bestPace':
    case 'fastestSplit':
      return m.bestPaceSPerKm === null
        ? missing
        : { value: formatPace(m.bestPaceSPerKm, units), unit: imperial ? '/mi' : '/km', available: true };
    case 'avgSpeed':
    case 'maxSpeed': {
      const v = key === 'avgSpeed' ? m.avgSpeedMps : m.maxSpeedMps;
      if (v === null) return missing;
      const d = imperial ? v * 2.236936 : v * 3.6;
      return { value: d.toFixed(1), unit: imperial ? 'mph' : 'km/h', numeric: d, decimals: 1, available: true };
    }
    case 'elevGain':
    case 'elevLoss':
    case 'minEle':
    case 'maxEle': {
      const v = { elevGain: m.elevGainM, elevLoss: m.elevLossM, minEle: m.minEleM, maxEle: m.maxEleM }[key];
      if (v === null) return missing;
      const d = imperial ? v * FT_PER_M : v;
      return { value: String(Math.round(d)), unit: imperial ? 'ft' : 'm', numeric: d, decimals: 0, available: true };
    }
    case 'avgHr':
    case 'maxHr': {
      const v = key === 'avgHr' ? m.avgHr : m.maxHr;
      return v === null ? missing : { value: String(Math.round(v)), unit: 'bpm', numeric: v, decimals: 0, available: true };
    }
    case 'avgCadence':
      return m.avgCadence === null
        ? missing
        : { value: String(Math.round(m.avgCadence)), unit: 'spm', numeric: m.avgCadence, decimals: 0, available: true };
    case 'calories':
      return m.calories === null
        ? missing
        : { value: String(Math.round(m.calories)), unit: 'kcal', numeric: m.calories, decimals: 0, available: true };
    case 'date':
      return a.startTime === undefined
        ? missing
        : {
            value: new Date(a.startTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
            unit: '',
            available: true,
          };
    case 'startTime':
      return a.startTime === undefined
        ? missing
        : { value: new Date(a.startTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), unit: '', available: true };
    case 'name':
      return { value: a.overrides.name ?? a.name, unit: '', available: true };
    case 'location':
      return a.overrides.location ? { value: a.overrides.location, unit: '', available: true } : missing;
  }
}
