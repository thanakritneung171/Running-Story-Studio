import type { MediaFrame } from '../render/renderer';
import { getAsset, getAssetBlob } from './store';
import type { MediaAsset } from './types';

interface Entry {
  asset: MediaAsset;
  url: string;
  el: HTMLImageElement | HTMLVideoElement;
  ready: boolean;
}

/**
 * Holds decoded media elements for preview rendering. Original blobs stay in IndexedDB;
 * the elements here are disposable and released with `release()` / `releaseAll()`.
 */
class MediaRegistry {
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Promise<Entry | null>>();
  private listeners = new Set<() => void>();

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((f) => f());
  }

  ensure(id: string): Promise<Entry | null> {
    const have = this.entries.get(id);
    if (have) return Promise.resolve(have);
    const p = this.pending.get(id);
    if (p) return p;
    const load = (async () => {
      const [asset, blob] = await Promise.all([getAsset(id), getAssetBlob(id)]);
      if (!asset || !blob) return null;
      const url = URL.createObjectURL(blob);
      let el: HTMLImageElement | HTMLVideoElement;
      if (asset.kind === 'image') {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        try {
          await img.decode();
        } catch {
          URL.revokeObjectURL(url);
          return null;
        }
        el = img;
      } else {
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.preload = 'auto';
        v.crossOrigin = 'anonymous';
        v.src = url;
        await new Promise<void>((res) => {
          v.onloadeddata = () => res();
          v.onerror = () => res();
        });
        el = v;
        v.addEventListener('seeked', () => this.emit());
      }
      const e: Entry = { asset, url, el, ready: true };
      this.entries.set(id, e);
      this.emit();
      return e;
    })().finally(() => this.pending.delete(id));
    this.pending.set(id, load);
    return load;
  }

  get(id: string) {
    return this.entries.get(id);
  }

  frame = (id: string): MediaFrame | null => {
    const e = this.entries.get(id);
    if (!e) {
      void this.ensure(id);
      return null;
    }
    if (e.el instanceof HTMLImageElement) return { source: e.el, width: e.el.naturalWidth, height: e.el.naturalHeight };
    if (e.el.readyState < 2) return null;
    return { source: e.el, width: e.el.videoWidth, height: e.el.videoHeight };
  };

  videos(): HTMLVideoElement[] {
    return [...this.entries.values()].map((e) => e.el).filter((e): e is HTMLVideoElement => e instanceof HTMLVideoElement);
  }

  release(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    if (e.el instanceof HTMLVideoElement) {
      e.el.pause();
      e.el.removeAttribute('src');
      e.el.load();
    }
    URL.revokeObjectURL(e.url);
    this.entries.delete(id);
  }

  releaseAll() {
    [...this.entries.keys()].forEach((id) => this.release(id));
  }
}

export const mediaRegistry = new MediaRegistry();
