import type { DesignDocument } from '../../../shared/design';
import { ensureFonts } from '../render/fonts';
import { getAsset, getAssetBlob } from '../media/store';
import type { MediaFrame, MediaLookup } from '../render/renderer';

export interface ExportMedia {
  lookup: MediaLookup;
  videos: Map<string, HTMLVideoElement>;
  warnings: string[];
  dispose: () => void;
}

/**
 * Load every asset the document needs into export-owned elements (independent of the editor
 * preview), and wait for fonts. Missing assets are reported instead of silently dropped.
 */
export async function prepareExportMedia(doc: DesignDocument, excludeBackground: boolean): Promise<ExportMedia> {
  const warnings: string[] = [];
  const failedFonts = await ensureFonts(doc);
  if (failedFonts.length) warnings.push(`Some fonts could not be loaded and fell back to system fonts: ${failedFonts.join(', ')}`);
  const frames = new Map<string, MediaFrame>();
  const videos = new Map<string, HTMLVideoElement>();
  const urls: string[] = [];
  const ids = new Set(
    doc.layers
      .filter((l) => l.visible && (l.type === 'image' || l.type === 'video') && !(excludeBackground && l.isBackground))
      .map((l) => (l as { assetId: string }).assetId),
  );
  for (const id of ids) {
    const [asset, blob] = await Promise.all([getAsset(id), getAssetBlob(id)]);
    if (!asset || !blob) {
      warnings.push(`A media file used in the design is missing (${id}) and was left out.`);
      continue;
    }
    const url = URL.createObjectURL(blob);
    urls.push(url);
    if (asset.kind === 'image') {
      try {
        const bmp = await createImageBitmap(blob);
        frames.set(id, { source: bmp, width: bmp.width, height: bmp.height });
      } catch {
        warnings.push(`“${asset.name}” could not be decoded and was left out.`);
      }
    } else {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.src = url;
      const ok = await new Promise<boolean>((res) => {
        v.onloadeddata = () => res(true);
        v.onerror = () => res(false);
        setTimeout(() => res(v.readyState >= 2), 20000);
      });
      if (!ok) {
        warnings.push(`Video “${asset.name}” could not be decoded and was left out.`);
        continue;
      }
      videos.set(id, v);
    }
  }
  return {
    warnings,
    videos,
    lookup: (id) => {
      const f = frames.get(id);
      if (f) return f;
      const v = videos.get(id);
      return v && v.readyState >= 2 ? { source: v, width: v.videoWidth, height: v.videoHeight } : null;
    },
    dispose: () => {
      frames.forEach((f) => (f.source as ImageBitmap).close?.());
      videos.forEach((v) => {
        v.pause();
        v.removeAttribute('src');
        v.load();
      });
      urls.forEach((u) => URL.revokeObjectURL(u));
    },
  };
}

/** Seek a video element and wait until the new frame is ready. */
export function seekVideo(v: HTMLVideoElement, t: number): Promise<void> {
  const target = Math.max(0, Math.min(t, (v.duration || 0) - 0.001));
  if (Math.abs(v.currentTime - target) < 0.0005 && v.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, 3000);
    function done() {
      clearTimeout(timer);
      v.removeEventListener('seeked', done);
      resolve();
    }
    v.addEventListener('seeked', done);
    v.currentTime = target;
  });
}
