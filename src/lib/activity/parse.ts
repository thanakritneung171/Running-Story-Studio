import type { Activity } from './types';
import { detectFormat } from './detect';
import { ActivityImportError } from './errors';
import { parseGpx } from './gpx';
import { parseTcx } from './tcx';
import { parseFit } from './fit';

export const MAX_ACTIVITY_BYTES = 50 * 1024 * 1024;

/** Parse raw file bytes into a normalized Activity. Pure; safe to run in a Web Worker. */
export function parseActivity(bytes: Uint8Array, fileName: string, id: string): Activity {
  if (bytes.length === 0) throw new ActivityImportError('The file is empty.', 'empty');
  if (bytes.length > MAX_ACTIVITY_BYTES)
    throw new ActivityImportError('The file is larger than 50 MB and cannot be imported.', 'too_large');
  const format = detectFormat(bytes);
  if (!format) {
    throw new ActivityImportError(
      'Unsupported file. Please choose a GPX, TCX or FIT activity file (the format is detected from the contents, not the extension).',
      'unsupported_format',
    );
  }
  let parsed: Omit<Activity, 'id'>;
  if (format === 'fit') parsed = parseFit(bytes, fileName);
  else {
    const text = new TextDecoder('utf-8').decode(bytes);
    parsed = format === 'gpx' ? parseGpx(text, fileName) : parseTcx(text, fileName);
  }
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext && ext !== format && ['gpx', 'tcx', 'fit'].includes(ext))
    parsed.warnings.unshift(`The file is named .${ext} but its contents are ${format.toUpperCase()}; it was read as ${format.toUpperCase()}.`);
  sortByTime(parsed);
  return { id, ...parsed };
}

function sortByTime(a: Omit<Activity, 'id'>) {
  const pts = a.points;
  let sorted = true;
  for (let i = 1; i < pts.length; i++) {
    const t0 = pts[i - 1].time;
    const t1 = pts[i].time;
    if (t0 !== undefined && t1 !== undefined && t1 < t0) {
      sorted = false;
      break;
    }
  }
  if (!sorted && pts.every((p) => p.time !== undefined)) {
    pts.sort((x, y) => x.time! - y.time!);
    a.warnings.push('Track points were out of chronological order and have been sorted.');
  }
}
