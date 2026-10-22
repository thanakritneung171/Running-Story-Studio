import type { Activity, TrackPoint } from './types';
import { ActivityImportError } from './errors';
import { asArray, num, parseXml, str, time } from './xml';
import { isRunningSport, validLatLon } from './util';

type Node = Record<string, unknown>;

export function parseGpx(text: string, fileName: string): Omit<Activity, 'id'> {
  const doc = parseXml(text, ['trk', 'trkseg', 'trkpt', 'rte', 'rtept', 'wpt']);
  const gpx = doc.gpx as Node | undefined;
  if (!gpx || typeof gpx !== 'object') throw new ActivityImportError('No <gpx> root element found.', 'malformed');

  const warnings: string[] = [];
  const tracks = asArray(gpx.trk as Node[] | undefined);
  const trk = tracks[0];
  if (tracks.length > 1) warnings.push(`The file has ${tracks.length} tracks; only the first one was imported.`);

  const rawPoints: Node[] = [];
  let sport = 'running';
  let name = str((gpx.metadata as Node | undefined)?.name);
  if (trk) {
    name = str(trk.name) ?? name;
    const type = str(trk.type);
    if (type) sport = type.toLowerCase();
    for (const seg of asArray(trk.trkseg as Node[] | undefined)) rawPoints.push(...asArray(seg.trkpt as Node[] | undefined));
  } else {
    // Some tools export a planned route instead of a recorded track.
    const rte = asArray(gpx.rte as Node[] | undefined)[0];
    if (rte) {
      name = str(rte.name) ?? name;
      rawPoints.push(...asArray(rte.rtept as Node[] | undefined));
      warnings.push('This file contains a planned route (no recorded track); times are usually missing.');
    }
  }
  if (rawPoints.length === 0) throw new ActivityImportError('The GPX file contains no track points.', 'no_data');

  const running = isRunningSport(sport);
  let invalid = 0;
  const points: TrackPoint[] = [];
  for (const p of rawPoints) {
    const lat = num(p['@lat']);
    const lon = num(p['@lon']);
    const pt: TrackPoint = {};
    if (lat !== undefined && lon !== undefined && validLatLon(lat, lon)) {
      pt.lat = lat;
      pt.lon = lon;
    } else invalid++;
    const ele = num(p.ele);
    if (ele !== undefined) pt.ele = ele;
    const t = time(p.time);
    if (t !== undefined) pt.time = t;
    const ext = p.extensions as Node | undefined;
    const tpe = (ext?.TrackPointExtension as Node | undefined) ?? ext;
    const hr = num(tpe?.hr) ?? num(tpe?.heartrate);
    if (hr !== undefined && hr > 0) pt.hr = hr;
    const cad = num(tpe?.cad) ?? num(tpe?.cadence);
    if (cad !== undefined) pt.cad = running ? cad * 2 : cad;
    points.push(pt);
  }
  if (invalid > 0) warnings.push(`${invalid} point(s) had missing or invalid coordinates and were excluded from the route.`);

  const timed = points.filter((p) => p.time !== undefined);
  if (timed.length === 0) warnings.push('The file has no timestamps, so time and pace cannot be calculated.');

  return {
    source: { format: 'gpx', fileName, importedAt: Date.now() },
    name: name?.trim() || stripExt(fileName),
    sport,
    startTime: timed[0]?.time,
    points,
    laps: [],
    fileSummary: {},
    overrides: {},
    warnings,
  };
}

export function stripExt(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || 'Activity';
}
