import type { Activity, Lap, TrackPoint } from './types';
import { ActivityImportError } from './errors';
import { asArray, num, parseXml, str, time } from './xml';
import { isRunningSport, validLatLon } from './util';
import { stripExt } from './gpx';

type Node = Record<string, unknown>;

export function parseTcx(text: string, fileName: string): Omit<Activity, 'id'> {
  const doc = parseXml(text, ['Activity', 'Lap', 'Track', 'Trackpoint']);
  const root = doc.TrainingCenterDatabase as Node | undefined;
  if (!root) throw new ActivityImportError('No <TrainingCenterDatabase> root element found.', 'malformed');
  const acts = asArray((root.Activities as Node | undefined)?.Activity as Node[] | undefined);
  if (acts.length === 0) throw new ActivityImportError('The TCX file contains no activities.', 'no_data');
  const act = acts[0];
  const warnings: string[] = [];
  if (acts.length > 1) warnings.push(`The file has ${acts.length} activities; only the first one was imported.`);

  const sport = (str(act['@Sport']) ?? 'running').toLowerCase();
  const running = isRunningSport(sport);
  const laps: Lap[] = [];
  const points: TrackPoint[] = [];
  let calories = 0;
  let hasCalories = false;
  let lapDistance = 0;
  let lapTime = 0;
  let maxHr: number | undefined;

  for (const lap of asArray(act.Lap as Node[] | undefined)) {
    const durationS = num(lap.TotalTimeSeconds);
    const distanceM = num(lap.DistanceMeters);
    laps.push({ startTime: time(lap['@StartTime']), durationS, distanceM });
    if (durationS !== undefined) lapTime += durationS;
    if (distanceM !== undefined) lapDistance += distanceM;
    const cal = num(lap.Calories);
    if (cal !== undefined) {
      calories += cal;
      hasCalories = true;
    }
    const mhr = num((lap.MaximumHeartRateBpm as Node | undefined)?.Value);
    if (mhr !== undefined) maxHr = Math.max(maxHr ?? 0, mhr);
    for (const track of asArray(lap.Track as Node[] | undefined)) {
      for (const tp of asArray(track.Trackpoint as Node[] | undefined)) {
        const pt: TrackPoint = {};
        const pos = tp.Position as Node | undefined;
        const lat = num(pos?.LatitudeDegrees);
        const lon = num(pos?.LongitudeDegrees);
        if (lat !== undefined && lon !== undefined && validLatLon(lat, lon)) {
          pt.lat = lat;
          pt.lon = lon;
        }
        const t = time(tp.Time);
        if (t !== undefined) pt.time = t;
        const ele = num(tp.AltitudeMeters);
        if (ele !== undefined) pt.ele = ele;
        const d = num(tp.DistanceMeters);
        if (d !== undefined) pt.dist = d;
        const hr = num((tp.HeartRateBpm as Node | undefined)?.Value);
        if (hr !== undefined && hr > 0) pt.hr = hr;
        const ext = tp.Extensions as Node | undefined;
        const tpx = ext?.TPX as Node | undefined;
        const rc = num(tpx?.RunCadence);
        const cad = num(tp.Cadence);
        if (rc !== undefined) pt.cad = rc * 2;
        else if (cad !== undefined) pt.cad = running ? cad * 2 : cad;
        points.push(pt);
      }
    }
  }
  if (points.length === 0 && laps.length === 0)
    throw new ActivityImportError('The TCX file contains no track points or laps.', 'no_data');
  if (!points.some((p) => p.lat !== undefined)) warnings.push('No GPS positions were found, so no route can be drawn.');

  const startTime = points.find((p) => p.time !== undefined)?.time ?? laps[0]?.startTime;
  return {
    source: { format: 'tcx', fileName, importedAt: Date.now() },
    name: str((act as Node).Notes)?.trim() || stripExt(fileName),
    sport,
    startTime,
    points,
    laps,
    fileSummary: {
      distanceM: laps.length ? lapDistance : undefined,
      // TCX TotalTimeSeconds is the device's timer time (excludes auto-pause).
      movingS: laps.length ? lapTime : undefined,
      calories: hasCalories ? calories : undefined,
      maxHr,
    },
    overrides: {},
    warnings,
  };
}
