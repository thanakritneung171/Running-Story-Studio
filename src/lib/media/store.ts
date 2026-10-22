import { sniffMedia } from '../../../shared/sniff';
import { uid } from '../design/ids';
import { db } from '../projects/db';
import type { MediaAsset } from './types';

export const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

export class MediaError extends Error {}

/** Validate (by magic bytes), probe and store an uploaded file in IndexedDB. */
export async function putAsset(file: File, id = uid('m'), cloud = false): Promise<MediaAsset> {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const sniffed = sniffMedia(head);
  if (!sniffed) throw new MediaError(`“${file.name}” is not a supported image (JPEG, PNG, WebP, AVIF) or video (MP4, MOV, WebM).`);
  const limit = sniffed.kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (file.size > limit) throw new MediaError(`“${file.name}” is too large (max ${limit / 1048576} MB for ${sniffed.kind}s).`);
  const blob = file.type === sniffed.mime ? file : new Blob([file], { type: sniffed.mime });
  const probe = sniffed.kind === 'image' ? await probeImage(blob) : await probeVideo(blob);
  const asset: MediaAsset = {
    id,
    kind: sniffed.kind,
    name: file.name.slice(0, 120),
    mime: sniffed.mime,
    size: file.size,
    createdAt: Date.now(),
    cloud,
    ...probe,
  };
  await (await db()).put('media', { ...asset, blob });
  return asset;
}

export async function getAsset(id: string): Promise<MediaAsset | undefined> {
  const a = await (await db()).get('media', id);
  if (!a) return undefined;
  const { blob: _b, ...meta } = a;
  return meta;
}
export async function getAssetBlob(id: string): Promise<Blob | undefined> {
  return (await (await db()).get('media', id))?.blob;
}

async function probeImage(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bmp = await createImageBitmap(blob);
    const r = { width: bmp.width, height: bmp.height };
    bmp.close();
    return r;
  } catch {
    throw new MediaError('The image could not be decoded by this browser.');
  }
}

function probeVideo(blob: Blob): Promise<{ width: number; height: number; durationS: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = () => {
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      v.load();
    };
    const t = setTimeout(() => {
      done();
      reject(new MediaError('Timed out reading the video. The codec may not be supported by this browser.'));
    }, 15000);
    v.onloadedmetadata = () => {
      clearTimeout(t);
      const r = { width: v.videoWidth, height: v.videoHeight, durationS: v.duration };
      done();
      if (!r.width || !Number.isFinite(r.durationS)) reject(new MediaError('The video has no decodable picture.'));
      else resolve(r);
    };
    v.onerror = () => {
      clearTimeout(t);
      done();
      reject(new MediaError('This browser cannot play the video (unsupported codec, e.g. HEVC on some systems).'));
    };
    v.src = url;
  });
}
