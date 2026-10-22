import type { DesignDocument } from '../../../shared/design';
import { mediaRegistry } from '../../lib/media/registry';

/** Align preview video elements with timeline time t. While playing, only correct drift. */
export function syncVideosToTime(doc: DesignDocument, t: number, playing: boolean) {
  for (const l of doc.layers) {
    if (l.type !== 'video') continue;
    const e = mediaRegistry.get(l.assetId);
    if (!e || !(e.el instanceof HTMLVideoElement)) continue;
    const v = e.el;
    const end = l.trimEndS ?? v.duration;
    const target = Math.min(l.trimStartS + t, Math.max(l.trimStartS, (end || 0) - 0.001));
    if (playing) {
      v.muted = l.muted;
      v.volume = l.volume;
      if (l.trimStartS + t >= end) {
        if (!v.paused) v.pause();
        continue;
      }
      if (v.paused) void v.play().catch(() => undefined);
      if (Math.abs(v.currentTime - target) > 0.25) v.currentTime = target;
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - target) > 0.01) v.currentTime = target;
    }
  }
}

export function pauseAllVideos() {
  for (const v of mediaRegistry.videos()) v.pause();
}
