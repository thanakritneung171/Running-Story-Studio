import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import type { Layer } from '../../../shared/design';
import { renderDocument } from '../../lib/render/renderer';
import { mediaRegistry } from '../../lib/media/registry';
import { aabb, hitTest, resizeBox, snapMove, type Guide, type Handle } from '../../lib/editor/geometry';
import { useDoc, useEditor } from './store';
import { syncVideosToTime } from './playback';

type Gesture =
  | { kind: 'move'; key: string; sx: number; sy: number; orig: Map<string, { x: number; y: number }>; others: Layer[]; moved: boolean }
  | { kind: 'resize'; key: string; sx: number; sy: number; id: string; handle: Handle; orig: Layer }
  | { kind: 'rotate'; key: string; id: string; cx: number; cy: number };

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CURSORS: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
let gestureSeq = 0;

export function Stage() {
  const doc = useDoc();
  const activity = useEditor((s) => s.project?.activity ?? null);
  const metrics = useEditor((s) => s.metrics);
  const selection = useEditor((s) => s.selection);
  const zoomSetting = useEditor((s) => s.zoom);
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const { run, select, toggleSelect, seal } = useEditor.getState();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [fit, setFit] = useState(0.3);
  const [mediaTick, setMediaTick] = useState(0);
  const [lightGrid, setLightGrid] = useState(false);
  const W = doc.canvas.width;
  const H = doc.canvas.height;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const pad = window.innerWidth < 768 ? 24 : 64;
      setFit(Math.max(0.05, Math.min((el.clientWidth - pad) / W, (el.clientHeight - pad) / H)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);
  const z = zoomSetting === 'fit' ? fit : zoomSetting;

  useEffect(() => mediaRegistry.onChange(() => setMediaTick((t) => t + 1)), []);
  useEffect(() => {
    for (const l of doc.layers) if (l.type === 'image' || l.type === 'video') void mediaRegistry.ensure(l.assetId);
  }, [doc.layers]);

  // Keep background videos in sync with the timeline when not playing.
  useEffect(() => {
    if (!playing) syncVideosToTime(doc, time ?? 0, false);
  }, [doc, time, playing]);

  // Render (same renderer as export).
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const raf = requestAnimationFrame(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const bw = Math.max(1, Math.round(W * z * dpr));
      const bh = Math.max(1, Math.round(H * z * dpr));
      if (c.width !== bw || c.height !== bh) {
        c.width = bw;
        c.height = bh;
      }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, bw, bh);
      ctx.setTransform(bw / W, 0, 0, bh / H, 0, 0);
      renderDocument(ctx, doc, { activity, metrics, media: mediaRegistry.frame, time, placeholders: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [doc, activity, metrics, time, z, W, H, mediaTick]);

  const toDoc = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const r = stageRef.current!.getBoundingClientRect();
      return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z };
    },
    [z],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = toDoc(e);
    const target = (e.target as HTMLElement).dataset;
    const key = `g${++gestureSeq}`;
    if (target.handle && selection.length === 1) {
      const l = doc.layers.find((x) => x.id === selection[0]);
      if (!l || l.locked) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      if (target.handle === 'rotate') gesture.current = { kind: 'rotate', key, id: l.id, cx: l.x + l.width / 2, cy: l.y + l.height / 2 };
      else gesture.current = { kind: 'resize', key, sx: p.x, sy: p.y, id: l.id, handle: target.handle as Handle, orig: structuredClone(l) };
      return;
    }
    // Prefer an already-selected layer under the cursor so overlapping selections can be dragged.
    const selectedHit = doc.layers.filter((l) => selection.includes(l.id));
    const hit = hitTest(selectedHit, p.x, p.y) ?? hitTest(doc.layers, p.x, p.y);
    if (!hit) {
      if (!e.shiftKey) select([]);
      return;
    }
    let sel = selection;
    if (e.shiftKey) {
      toggleSelect(hit.id);
      return;
    }
    if (!selection.includes(hit.id)) {
      sel = [hit.id];
      select(sel);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const orig = new Map(doc.layers.filter((l) => sel.includes(l.id) && !l.locked).map((l) => [l.id, { x: l.x, y: l.y }]));
    gesture.current = { kind: 'move', key, sx: p.x, sy: p.y, orig, others: doc.layers.filter((l) => !sel.includes(l.id) && !l.isBackground), moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const p = toDoc(e);
    if (g.kind === 'move') {
      let dx = p.x - g.sx;
      let dy = p.y - g.sy;
      if (!g.moved && Math.hypot(dx, dy) * z < 3) return;
      g.moved = true;
      if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      const layers = doc.layers.filter((l) => g.orig.has(l.id));
      if (!layers.length) return;
      let box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (const l of layers) {
        const o = g.orig.get(l.id)!;
        const b = aabb({ ...l, x: o.x + dx, y: o.y + dy });
        box = { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) };
      }
      if (!e.altKey) {
        const s = snapMove(box, g.others, W, H, 6 / z);
        dx += s.dx;
        dy += s.dy;
        setGuides(s.guides);
      } else setGuides([]);
      run(
        'Move',
        (d) => {
          for (const l of d.layers) {
            const o = g.orig.get(l.id);
            if (o) {
              l.x = Math.round((o.x + dx) * 10) / 10;
              l.y = Math.round((o.y + dy) * 10) / 10;
            }
          }
        },
        g.key,
      );
    } else if (g.kind === 'resize') {
      const o = g.orig;
      const corner = g.handle.length === 2;
      const aspectByDefault = ['image', 'video', 'icon', 'text', 'stat'].includes(o.type);
      const keep = corner && (aspectByDefault ? !e.shiftKey : e.shiftKey);
      const b = resizeBox(o, g.handle, p.x - g.sx, p.y - g.sy, keep);
      const scale = b.width / o.width;
      run(
        'Resize',
        (d) => {
          const l = d.layers.find((x) => x.id === g.id);
          if (!l) return;
          Object.assign(l, { x: b.x, y: b.y, width: b.width, height: b.height });
          // Corner-resizing text scales the type, like design tools do.
          if (corner && keep && (l.type === 'text' || l.type === 'stat') && (o.type === 'text' || o.type === 'stat')) {
            if (l.type === 'text' && o.type === 'text') {
              l.style.fontSize = o.style.fontSize * scale;
              l.style.letterSpacing = o.style.letterSpacing * scale;
            }
            if (l.type === 'stat' && o.type === 'stat') {
              l.valueStyle.fontSize = o.valueStyle.fontSize * scale;
              l.labelStyle.fontSize = o.labelStyle.fontSize * scale;
              l.valueStyle.letterSpacing = o.valueStyle.letterSpacing * scale;
              l.labelStyle.letterSpacing = o.labelStyle.letterSpacing * scale;
            }
          }
        },
        g.key,
      );
    } else {
      let ang = (Math.atan2(p.y - g.cy, p.x - g.cx) * 180) / Math.PI + 90;
      if (e.shiftKey) ang = Math.round(ang / 15) * 15;
      else for (const s of [0, 90, 180, 270, 360, -90]) if (Math.abs(ang - s) < 3) ang = s;
      ang = ((((ang + 180) % 360) + 360) % 360) - 180;
      run('Rotate', (d) => {
        const l = d.layers.find((x) => x.id === g.id);
        if (l) l.rotation = Math.round(ang * 10) / 10;
      }, g.key);
    }
  };

  const onPointerUp = () => {
    if (gesture.current) seal();
    gesture.current = null;
    setGuides([]);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const p = toDoc(e);
    const hit = hitTest(doc.layers, p.x, p.y);
    if (hit && (hit.type === 'text' || hit.type === 'stat')) {
      select([hit.id]);
      window.dispatchEvent(new CustomEvent('rss:edit-text', { detail: hit.id }));
    }
  };

  const selected = doc.layers.filter((l) => selection.includes(l.id));
  const transparent = doc.canvas.background.type === 'transparent';
  return (
    <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-auto bg-[#08090b]" data-testid="stage-wrap">
      {transparent && (
        <button className="btn absolute top-2 right-2 z-10 py-1 text-xs" onClick={() => setLightGrid((v) => !v)} title="Check how the overlay reads on light and dark footage">
          Preview on {lightGrid ? 'dark' : 'light'}
        </button>
      )}
      <div className="flex min-h-full min-w-full items-center justify-center p-3 md:p-8" style={{ width: W * z + 64, height: H * z + 64 }}>
        <div
          ref={stageRef}
          data-testid="stage"
          className={`relative shrink-0 shadow-[0_20px_80px_rgba(0,0,0,0.6)] ring-1 ring-white/10 ${transparent ? (lightGrid ? 'checker-light' : 'checker') : ''}`}
          style={{ width: W * z, height: H * z, touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="Design canvas" />
          {selected.map((l) => (
            <div
              key={l.id}
              className={`pointer-events-none absolute border-2 ${l.locked ? 'border-dashed border-ink-400' : 'border-brand'}`}
              style={{ left: l.x * z, top: l.y * z, width: l.width * z, height: l.height * z, transform: `rotate(${l.rotation}deg)` }}
            >
              {l.locked && <Lock size={14} className="absolute -top-5 left-0 text-ink-300" />}
              {selected.length === 1 && !l.locked && (
                <>
                  {HANDLES.map((h) => (
                    <div
                      key={h}
                      data-handle={h}
                      className="pointer-events-auto absolute h-3 w-3 rounded-sm border-2 border-brand bg-white"
                      style={{
                        left: h.includes('w') ? -7 : h.includes('e') ? 'calc(100% - 5px)' : 'calc(50% - 6px)',
                        top: h.includes('n') ? -7 : h.includes('s') ? 'calc(100% - 5px)' : 'calc(50% - 6px)',
                        cursor: CURSORS[h],
                      }}
                    />
                  ))}
                  <div className="absolute left-1/2 h-5 w-px -translate-x-1/2 bg-brand" style={{ top: -22 }} />
                  <div data-handle="rotate" title="Rotate (Shift snaps 15°)" className="pointer-events-auto absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 cursor-grab rounded-full border-2 border-brand bg-white" style={{ top: -30 }} />
                </>
              )}
            </div>
          ))}
          {guides.map((g, i) => (
            <div key={i} className="pointer-events-none absolute bg-fuchsia-500" style={g.axis === 'x' ? { left: g.pos * z, top: 0, width: 1, height: '100%' } : { top: g.pos * z, left: 0, height: 1, width: '100%' }} />
          ))}
        </div>
      </div>
    </div>
  );
}
