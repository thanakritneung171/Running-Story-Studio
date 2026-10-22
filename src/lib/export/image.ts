import type { DesignDocument } from '../../../shared/design';
import type { Activity, ActivityMetrics } from '../activity/types';
import { paintBackground, renderDocument } from '../render/renderer';
import { prepareExportMedia, seekVideo } from './assets';

export type ImageFormat = 'png' | 'png-transparent' | 'jpeg' | 'webp';

export interface ImageExportOptions {
  format: ImageFormat;
  /** Output size in pixels. Defaults to the canvas size × scale. */
  width?: number;
  height?: number;
  scale?: number;
  quality?: number;
  activity: Activity | null;
  metrics: ActivityMetrics | null;
}

export interface AlphaReport {
  /** Pixels with alpha < 255. */
  translucentPixels: number;
  /** Pixels with alpha === 0. */
  transparentPixels: number;
  totalPixels: number;
}

export interface ImageExportResult {
  blob: Blob;
  width: number;
  height: number;
  mime: string;
  alpha: AlphaReport | null;
  warnings: string[];
}

/** Browsers cap canvas area; Safari's limit (~16.7 MP) is the strictest. */
export const MAX_CANVAS_PIXELS = 16_777_216;

export function analyzeAlpha(data: Uint8ClampedArray): AlphaReport {
  let translucent = 0;
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    if (a < 255) {
      translucent++;
      if (a === 0) transparent++;
    }
  }
  return { translucentPixels: translucent, transparentPixels: transparent, totalPixels: data.length / 4 };
}

export async function exportImage(doc: DesignDocument, o: ImageExportOptions): Promise<ImageExportResult> {
  const scale = o.scale ?? 1;
  const W = Math.round(o.width ?? doc.canvas.width * scale);
  const H = Math.round(o.height ?? doc.canvas.height * scale);
  if (W < 1 || H < 1) throw new Error('Invalid export size.');
  if (W * H > MAX_CANVAS_PIXELS) throw new Error(`${W}×${H} is larger than browsers can render reliably (max ~16.7 megapixels).`);
  const transparent = o.format === 'png-transparent';
  const media = await prepareExportMedia(doc, transparent);
  try {
    // Show each video layer at its trim-in point for still exports.
    for (const l of doc.layers)
      if (l.type === 'video') {
        const v = media.videos.get(l.assetId);
        if (v) await seekVideo(v, l.trimStartS);
      }
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
    if (!ctx) throw new Error('Could not create a 2D canvas.');
    ctx.imageSmoothingQuality = 'high';
    // Fit the design into the output (uniform scale, centred); margins get the background.
    const s = Math.min(W / doc.canvas.width, H / doc.canvas.height);
    if (!transparent) paintBackground(ctx, doc.canvas.background, W, H);
    ctx.save();
    ctx.translate((W - doc.canvas.width * s) / 2, (H - doc.canvas.height * s) / 2);
    ctx.scale(s, s);
    renderDocument(ctx, doc, {
      activity: o.activity,
      metrics: o.metrics,
      media: media.lookup,
      time: null,
      excludeBackground: transparent,
    });
    ctx.restore();
    const alpha = o.format === 'png' || o.format === 'png-transparent' || o.format === 'webp' ? analyzeAlpha(ctx.getImageData(0, 0, W, H).data) : null;
    const mime = o.format === 'jpeg' ? 'image/jpeg' : o.format === 'webp' ? 'image/webp' : 'image/png';
    let out = canvas;
    if (o.format === 'jpeg') {
      // JPEG has no alpha channel: flatten onto white so transparent areas don't turn black.
      out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const o2 = out.getContext('2d')!;
      o2.fillStyle = '#ffffff';
      o2.fillRect(0, 0, W, H);
      o2.drawImage(canvas, 0, 0);
    }
    const blob = await new Promise<Blob | null>((res) => out.toBlob(res, mime, o.quality ?? 0.92));
    if (!blob) throw new Error('The browser failed to encode the image (it may be out of memory).');
    const warnings = [...media.warnings];
    if (blob.type !== mime) warnings.push(`This browser cannot encode ${mime}; the file was saved as ${blob.type} instead.`);
    if (transparent && alpha && alpha.translucentPixels === 0)
      warnings.push('The exported image has no transparent pixels — a layer covers the whole canvas. Mark full-bleed layers as background to exclude them.');
    canvas.width = canvas.height = out.width = out.height = 0; // release backing stores
    return { blob, width: W, height: H, mime: blob.type, alpha, warnings };
  } finally {
    media.dispose();
  }
}

/** Small thumbnail (JPEG/PNG) used in the projects list. */
export async function renderThumbnail(doc: DesignDocument, activity: Activity | null, metrics: ActivityMetrics | null, media: (id: string) => ReturnType<Parameters<typeof renderDocument>[2]['media']>, maxW = 270): Promise<Blob | undefined> {
  const s = maxW / doc.canvas.width;
  const c = document.createElement('canvas');
  c.width = Math.round(doc.canvas.width * s);
  c.height = Math.round(doc.canvas.height * s);
  const ctx = c.getContext('2d');
  if (!ctx) return undefined;
  ctx.scale(s, s);
  renderDocument(ctx, doc, { activity, metrics, media, time: null });
  return (await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))) ?? undefined;
}
