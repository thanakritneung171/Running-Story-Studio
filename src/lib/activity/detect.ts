import type { ActivityFormat } from './types';

/**
 * Detect the real format from file contents. The file extension is only a hint and
 * is never trusted on its own.
 */
export function detectFormat(bytes: Uint8Array): ActivityFormat | null {
  // FIT: header size (12 or 14) at byte 0, ".FIT" signature at bytes 8..11.
  if (bytes.length >= 12) {
    const sig = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (sig === '.FIT' && (bytes[0] === 12 || bytes[0] === 14)) return 'fit';
  }
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, Math.min(bytes.length, 4096)))
    .replace(/^﻿/, '')
    .trimStart();
  if (!head.startsWith('<')) return null;
  if (/<gpx[\s>]/i.test(head)) return 'gpx';
  if (/<TrainingCenterDatabase[\s>]/i.test(head)) return 'tcx';
  return null;
}
