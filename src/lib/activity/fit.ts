import { Decoder, Stream } from '@garmin/fitsdk';
import type { Activity, Lap, TrackPoint } from './types';
import { ActivityImportError } from './errors';
import { isRunningSport, validLatLon } from './util';
import { stripExt } from './gpx';

type Rec = Record<string, unknown>;
const SEMI_TO_DEG = 180 / 2 ** 31;

const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const ts = (v: unknown): number | undefined =>
  v instanceof Date ? v.getTime() : typeof v === 'number' ? v : undefined;

export function parseFit(bytes: Uint8Array, fileName: string): Omit<Activity, 'id'> {
  const stream = Stream.fromByteArray(Array.from(bytes) as unknown as number[]);
  const decoder = new Decoder(stream);
  if (!decoder.isFIT()) throw new ActivityImportError('This is not a valid FIT file.', 'malformed');
  const warnings: string[] = [];
  if (!decoder.checkIntegrity()) warnings.push('The FIT file failed its integrity check (CRC); data may be incomplete.');

  const { messages, errors } = decoder.read({
    applyScaleAndOffset: true,
    expandComponents: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
    mergeHeartRates: true,
  }) as unknown as { messages: Record<string, Rec[] | undefined>; errors: Error[] };
  if (errors.length) warnings.push(`FIT decoder reported: ${errors[0].message}`);

  const session = messages.sessionMesgs?.[0] ?? {};
  const sport = String(session.sport ?? 'running').toLowerCase();
  const running = isRunningSport(sport);
  const records = messages.recordMesgs ?? [];
  if (records.length === 0 && !messages.sessionMesgs?.length)
    throw new ActivityImportError('The FIT file contains no activity records.', 'no_data');

  const points: TrackPoint[] = records.map((r) => {
    const p: TrackPoint = {};
    const lat = n(r.positionLat);
    const lon = n(r.positionLong);
    if (lat !== undefined && lon !== undefined) {
      const la = lat * SEMI_TO_DEG;
      const lo = lon * SEMI_TO_DEG;
      if (validLatLon(la, lo)) {
        p.lat = la;
        p.lon = lo;
      }
    }
    const t = ts(r.timestamp);
    if (t !== undefined) p.time = t;
    const ele = n(r.enhancedAltitude) ?? n(r.altitude);
    if (ele !== undefined) p.ele = ele;
    const hr = n(r.heartRate);
    if (hr !== undefined && hr > 0) p.hr = hr;
    const cad = n(r.cadence);
    if (cad !== undefined) {
      const full = cad + (n(r.fractionalCadence) ?? 0);
      p.cad = running ? full * 2 : full;
    }
    const d = n(r.distance);
    if (d !== undefined) p.dist = d;
    return p;
  });

  const laps: Lap[] = (messages.lapMesgs ?? []).map((l) => ({
    startTime: ts(l.startTime),
    durationS: n(l.totalTimerTime),
    distanceM: n(l.totalDistance),
  }));
  if (!points.some((p) => p.lat !== undefined)) warnings.push('No GPS positions were found, so no route can be drawn.');

  return {
    source: { format: 'fit', fileName, importedAt: Date.now() },
    name: stripExt(fileName),
    sport,
    startTime: ts(session.startTime) ?? points.find((p) => p.time !== undefined)?.time,
    points,
    laps,
    fileSummary: {
      distanceM: n(session.totalDistance),
      elapsedS: n(session.totalElapsedTime),
      movingS: n(session.totalTimerTime),
      calories: n(session.totalCalories),
      elevGainM: n(session.totalAscent),
      elevLossM: n(session.totalDescent),
      avgHr: n(session.avgHeartRate),
      maxHr: n(session.maxHeartRate),
    },
    overrides: {},
    warnings,
  };
}
