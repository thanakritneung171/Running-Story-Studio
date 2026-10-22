import type { Activity } from './types';
import { ActivityImportError } from './errors';
import { uid } from '../design/ids';

/** Parse a file off the main thread (falls back to the main thread if workers are unavailable). */
export async function importActivityFile(file: File, onProgress?: (stage: string) => void): Promise<Activity> {
  onProgress?.('Reading file…');
  const buf = await file.arrayBuffer();
  const id = uid('a');
  onProgress?.('Parsing activity…');
  if (typeof Worker === 'undefined') return (await import('./parse')).parseActivity(new Uint8Array(buf), file.name, id);
  const worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<Activity>((resolve, reject) => {
      worker.onmessage = (e) => {
        if (e.data.ok) resolve(e.data.activity);
        else reject(new ActivityImportError(e.data.message, e.data.code));
      };
      worker.onerror = (e) => reject(new Error(e.message || 'The import worker crashed.'));
      worker.postMessage({ bytes: buf, fileName: file.name, id }, [buf]);
    });
  } finally {
    worker.terminate();
  }
}
