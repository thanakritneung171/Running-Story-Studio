import { useEffect, useRef } from 'react';
import type { DesignDocument } from '../../../shared/design';
import type { Activity, ActivityMetrics } from '../../lib/activity/types';
import { renderDocument } from '../../lib/render/renderer';
import { mediaRegistry } from '../../lib/media/registry';

interface Props {
  doc: DesignDocument;
  activity: Activity | null;
  metrics: ActivityMetrics | null;
  /** Display width in CSS pixels. */
  width: number;
  /** Loop the animation timeline. */
  animate?: boolean;
  className?: string;
  checker?: boolean;
}

/** Read-only rendering of a design (template thumbnails, previews). Uses the same renderer as export. */
export function DocCanvas({ doc, activity, metrics, width, animate, className, checker }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const height = (width * doc.canvas.height) / doc.canvas.width;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const ctx = c.getContext('2d')!;
    let raf = 0;
    let t0 = performance.now();
    const draw = (time: number | null) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      const s = (width * dpr) / doc.canvas.width;
      ctx.setTransform(s, 0, 0, s, 0, 0);
      renderDocument(ctx, doc, { activity, metrics, media: mediaRegistry.frame, time });
    };
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (animate && !reduced) {
      const loop = () => {
        const total = doc.timeline.durationS + 1.5;
        const t = ((performance.now() - t0) / 1000) % total;
        if (t < 0.02) t0 = performance.now() - t * 1000;
        draw(Math.min(t, doc.timeline.durationS));
        raf = requestAnimationFrame(loop);
      };
      loop();
    } else draw(null);
    const off = mediaRegistry.onChange(() => !animate && draw(null));
    return () => {
      cancelAnimationFrame(raf);
      off();
    };
  }, [doc, activity, metrics, width, height, animate]);
  return (
    <canvas
      ref={ref}
      className={`${checker || doc.canvas.background.type === 'transparent' ? 'checker' : ''} ${className ?? ''}`}
      style={{ width, height, display: 'block' }}
    />
  );
}
