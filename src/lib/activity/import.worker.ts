/// <reference lib="webworker" />
import { parseActivity } from './parse';
import { ActivityImportError } from './errors';

self.onmessage = (e: MessageEvent<{ bytes: ArrayBuffer; fileName: string; id: string }>) => {
  const { bytes, fileName, id } = e.data;
  try {
    const activity = parseActivity(new Uint8Array(bytes), fileName, id);
    (self as unknown as Worker).postMessage({ ok: true, activity });
  } catch (err) {
    const code = err instanceof ActivityImportError ? err.code : 'malformed';
    (self as unknown as Worker).postMessage({ ok: false, code, message: (err as Error).message });
  }
};
