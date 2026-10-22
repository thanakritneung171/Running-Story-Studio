import type { Background, DesignDocument, Layer, LayerAnimation, LayerOf } from '../../../shared/design';
import type { Activity, ActivityMetrics } from '../activity/types';
import { buildSeries } from '../activity/metrics';
import { formatMetric } from '../activity/format';
import { fitRoute, partialRoute, projectRoute, type RoutePoint } from '../route/geometry';
import { applyCase, drawLine, wrapLines } from './text';
import { iconPath } from './icons';

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface MediaFrame {
  source: CanvasImageSource;
  width: number;
  height: number;
}
/** Resolve an asset to something drawable. For video layers the caller seeks the element first. */
export type MediaLookup = (assetId: string) => MediaFrame | null;

export interface RenderOptions {
  activity: Activity | null;
  metrics: ActivityMetrics | null;
  media: MediaLookup;
  /** Seconds since the start of the timeline. `null` renders the final, fully-revealed state. */
  time: number | null;
  /** Skip canvas background and layers flagged `isBackground` (transparent overlay export). */
  excludeBackground?: boolean;
  /** Layers to skip (e.g. the one being edited inline). */
  hiddenIds?: Set<string>;
  /** Draw placeholders for missing media (editor only). */
  placeholders?: boolean;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Animation progress 0..1 for a layer at time t (deterministic, timestamp-driven). */
export function animProgress(anim: LayerAnimation | undefined, t: number | null): number {
  if (t === null || !anim || anim.enter === 'none') return 1;
  if (anim.durationS <= 0) return t >= anim.delayS ? 1 : 0;
  return easeOut(clamp01((t - anim.delayS) / anim.durationS));
}

function exitFactor(anim: LayerAnimation | undefined, t: number | null, total: number): number {
  if (t === null || !anim || anim.exit !== 'fade') return 1;
  const d = Math.max(0.2, Math.min(anim.durationS || 0.5, 1));
  return clamp01((total - t) / d);
}

export function renderDocument(ctx: Ctx, doc: DesignDocument, opts: RenderOptions) {
  const { width, height } = doc.canvas;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  if (!opts.excludeBackground) paintBackground(ctx, doc.canvas.background, width, height);
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    if (opts.excludeBackground && layer.isBackground) continue;
    if (opts.hiddenIds?.has(layer.id)) continue;
    renderLayer(ctx, layer, doc, opts);
  }
  ctx.restore();
}

export function paintBackground(ctx: Ctx, bg: Background, w: number, h: number) {
  if (bg.type === 'solid') {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, w, h);
  } else if (bg.type === 'gradient') {
    const a = (bg.angle * Math.PI) / 180;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.abs(w * Math.sin(a)) / 2 + Math.abs(h * Math.cos(a)) / 2;
    const g = ctx.createLinearGradient(cx - Math.sin(a) * r, cy + Math.cos(a) * r, cx + Math.sin(a) * r, cy - Math.cos(a) * r);
    g.addColorStop(0, bg.from);
    g.addColorStop(1, bg.to);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

function renderLayer(ctx: Ctx, layer: Layer, doc: DesignDocument, opts: RenderOptions) {
  const p = animProgress(layer.animation, opts.time);
  const exit = exitFactor(layer.animation, opts.time, doc.timeline.durationS);
  const enter = layer.animation?.enter ?? 'none';
  let alpha = layer.opacity * exit;
  let dx = 0;
  let dy = 0;
  let scale = 1;
  if (enter === 'fade' || enter === 'count-up') alpha *= p;
  if (enter === 'slide-up') {
    alpha *= p;
    dy = (1 - p) * Math.min(120, layer.height * 0.6 + 40);
  }
  if (enter === 'slide-left') {
    alpha *= p;
    dx = (1 - p) * 120;
  }
  if (enter === 'scale') {
    alpha *= p;
    scale = 0.7 + 0.3 * p;
  }
  if (enter === 'draw' && layer.type !== 'route' && layer.type !== 'chart') alpha *= p;
  if (alpha <= 0.001) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;
  const cx = layer.x + layer.width / 2 + dx;
  const cy = layer.y + layer.height / 2 + dy;
  ctx.translate(cx, cy);
  if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
  if (scale !== 1) ctx.scale(scale, scale);
  ctx.translate(-layer.width / 2, -layer.height / 2);
  const drawP = enter === 'draw' ? p : 1;
  switch (layer.type) {
    case 'text':
      drawText(ctx, layer);
      break;
    case 'stat':
      drawStat(ctx, layer, doc, opts, enter === 'count-up' ? p : 1);
      break;
    case 'route':
      drawRoute(ctx, layer, opts, drawP);
      break;
    case 'shape':
      drawShape(ctx, layer);
      break;
    case 'image':
    case 'video':
      drawMedia(ctx, layer, opts);
      break;
    case 'icon':
      drawIcon(ctx, layer);
      break;
    case 'chart':
      drawChart(ctx, layer, opts, drawP);
      break;
  }
  ctx.restore();
}

function drawText(ctx: Ctx, l: LayerOf<'text'>) {
  const lines = wrapLines(ctx, applyCase(l.text, l.style), l.style, l.width);
  let top = 0;
  for (const line of lines) {
    const { lineH } = drawLine(ctx, line, l.style, 0, top, l.width);
    top += lineH;
  }
}

function drawStat(ctx: Ctx, l: LayerOf<'stat'>, doc: DesignDocument, opts: RenderOptions, countP: number) {
  const f = opts.activity && opts.metrics ? formatMetric(l.metric, opts.activity, opts.metrics, doc.units) : null;
  let value = f?.value ?? '–';
  if (f?.numeric !== undefined && countP < 1) {
    const v = f.numeric * countP;
    if (l.metric === 'movingTime' || l.metric === 'elapsedTime') {
      const t = Math.round(v);
      const h = Math.floor(t / 3600);
      const m = Math.floor((t % 3600) / 60);
      const s = t % 60;
      value = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
    } else value = v.toFixed(f.decimals ?? 0);
  }
  const valueText = applyCase(l.showUnit && f?.unit && l.layout === 'inline' ? `${value} ${f.unit}` : value, l.valueStyle);
  const unitText = l.showUnit && f?.unit && l.layout !== 'inline' ? f.unit : '';
  const label = applyCase(l.label, l.labelStyle);
  const ls = l.labelStyle;
  const labelH = l.showLabel ? ls.fontSize * ls.lineHeight : 0;
  const isText = l.metric === 'name' || l.metric === 'location';
  // Free-text values wrap; numeric values shrink to fit so they never overflow the tile.
  let vs = l.valueStyle;
  let valueLines = [valueText];
  if (isText) valueLines = wrapLines(ctx, valueText, vs, l.width);
  else {
    const unitStyle0 = { ...vs, fontSize: vs.fontSize * 0.42, letterSpacing: 0 };
    const w = unitText ? measureCombined(ctx, valueText, unitText, vs, unitStyle0).width : measureCombined(ctx, valueText, '', vs, unitStyle0).width - vs.fontSize * 0.12;
    if (w > l.width && w > 0) {
      const k = Math.max(0.3, l.width / w);
      vs = { ...vs, fontSize: vs.fontSize * k, letterSpacing: vs.letterSpacing * k };
    }
  }
  const valueH = vs.fontSize * vs.lineHeight;
  let y = 0;
  if (l.showLabel && l.layout !== 'label-below') {
    drawLine(ctx, label, ls, 0, y, l.width);
    y += labelH;
  }
  if (unitText && !isText) {
    // Value with a smaller unit suffix sharing the same baseline.
    const unitStyle = { ...vs, fontSize: vs.fontSize * 0.42, letterSpacing: 0 };
    const { width: vw } = measureCombined(ctx, valueText, unitText, vs, unitStyle);
    const startX = vs.align === 'left' ? 0 : vs.align === 'center' ? (l.width - vw) / 2 : l.width - vw;
    const v = drawLine(ctx, valueText, { ...vs, align: 'left' }, startX, y, l.width - startX);
    const unitTop = y + (valueH - vs.fontSize) / 2 + vs.fontSize * 0.8 - unitStyle.fontSize * 0.8 - (unitStyle.fontSize * (vs.lineHeight - 1)) / 2;
    drawLine(ctx, unitText, { ...unitStyle, align: 'left', lineHeight: vs.lineHeight }, startX + v.width + vs.fontSize * 0.12, unitTop, l.width);
    y += valueH;
  } else {
    for (const line of valueLines) {
      drawLine(ctx, line, vs, 0, y, l.width);
      y += valueH;
    }
  }
  if (l.showLabel && l.layout === 'label-below') drawLine(ctx, label, ls, 0, y, l.width);
}

function measureCombined(ctx: Ctx, value: string, unit: string, vs: LayerOf<'stat'>['valueStyle'], us: LayerOf<'stat'>['valueStyle']) {
  ctx.save();
  const a = drawWidth(ctx, value, vs);
  const b = drawWidth(ctx, unit, us);
  ctx.restore();
  return { width: a + vs.fontSize * 0.12 + b };
}
function drawWidth(ctx: Ctx, text: string, s: LayerOf<'stat'>['valueStyle']) {
  ctx.font = `${s.italic ? 'italic ' : ''}${s.fontWeight} ${s.fontSize}px "${s.fontFamily}", system-ui, sans-serif`;
  const c = ctx as CanvasRenderingContext2D;
  const supported: boolean = 'letterSpacing' in ctx;
  if (supported) {
    c.letterSpacing = `${s.letterSpacing}px`;
    return c.measureText(text).width - s.letterSpacing;
  }
  return c.measureText(text).width + s.letterSpacing * Math.max(0, text.length - 1);
}

// ---------- Route ----------
const routeCache = new WeakMap<ActivityMetrics, Map<string, RoutePoint[] | null>>();

export function getFittedRoute(opts: RenderOptions, w: number, h: number, padding: number, trim: number): RoutePoint[] | null {
  if (!opts.activity || !opts.metrics) return null;
  let m = routeCache.get(opts.metrics);
  if (!m) routeCache.set(opts.metrics, (m = new Map()));
  const key = `${Math.round(w)}x${Math.round(h)}:${padding}:${trim}`;
  if (m.has(key)) return m.get(key)!;
  const proj = projectRoute(opts.activity, opts.metrics, trim);
  const fitted = proj ? fitRoute(proj, w, h, padding) : null;
  if (m.size > 50) m.clear();
  m.set(key, fitted);
  return fitted;
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return t < 0.5 ? a : b;
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgba(${c[0]},${c[1]},${c[2]},${(pa[3] + (pb[3] - pa[3]) * t) / 255})`;
}
export function parseHex(c: string): [number, number, number, number] | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) : 255];
}

const PACE_FAST = '#22c55e';
const PACE_MID = '#facc15';
const PACE_SLOW = '#ef4444';

function segmentValues(opts: RenderOptions, pts: RoutePoint[], mode: 'pace' | 'elevation'): number[] | null {
  const a = opts.activity!;
  const m = opts.metrics!;
  if (mode === 'elevation') {
    const v = pts.map((p) => a.points[p.i]?.ele);
    if (v.some((x) => x === undefined)) return null;
    return v as number[];
  }
  // pace per segment from a ±100 m window, using device time
  const out: number[] = [];
  for (let k = 0; k < pts.length; k++) {
    let lo = k;
    let hi = k;
    while (lo > 0 && pts[k].d - pts[lo].d < 100) lo--;
    while (hi < pts.length - 1 && pts[hi].d - pts[k].d < 100) hi++;
    const t0 = a.points[pts[lo].i]?.time;
    const t1 = a.points[pts[hi].i]?.time;
    const dd = m.cumDist[pts[hi].i] - m.cumDist[pts[lo].i];
    if (t0 === undefined || t1 === undefined || dd <= 0) return null;
    out.push((t1 - t0) / 1000 / (dd / 1000));
  }
  return out;
}

function drawRoute(ctx: Ctx, l: LayerOf<'route'>, opts: RenderOptions, progress: number) {
  const full = getFittedRoute(opts, l.width, l.height, l.padding, l.privacyTrimM);
  if (!full) {
    if (opts.placeholders) placeholder(ctx, l.width, l.height, opts.activity ? 'No GPS route in this activity' : 'Route');
    return;
  }
  const pts = partialRoute(full, progress);
  if (pts.length < 2) return;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = l.strokeWidth;
  const glow = () => {
    if (l.glow > 0) {
      ctx.shadowColor = l.strokeColor;
      ctx.shadowBlur = l.glow;
    } else if (l.shadow) {
      ctx.shadowColor = l.shadow.color;
      ctx.shadowBlur = l.shadow.blur;
      ctx.shadowOffsetX = l.shadow.x;
      ctx.shadowOffsetY = l.shadow.y;
    }
  };
  glow();
  if (l.colorMode === 'solid') {
    ctx.strokeStyle = l.strokeColor;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  } else {
    let colors: string[];
    if (l.colorMode === 'gradient') {
      const d0 = full[0].d;
      const span = Math.max(full[full.length - 1].d - d0, 1);
      colors = pts.map((p) => lerpColor(l.strokeColor, l.gradientTo, (p.d - d0) / span));
    } else {
      const vals = segmentValues(opts, pts, l.colorMode);
      const allVals = segmentValues(opts, full, l.colorMode);
      if (!vals || !allVals) colors = pts.map(() => l.strokeColor);
      else {
        const sorted = [...allVals].sort((x, y) => x - y);
        const lo = sorted[Math.floor(sorted.length * 0.05)];
        const hi = sorted[Math.floor(sorted.length * 0.95)];
        colors = vals.map((v) => {
          const t = clamp01((v - lo) / Math.max(hi - lo, 1e-6));
          // pace: low value = fast (green); elevation: low = green
          return t < 0.5 ? lerpColor(PACE_FAST, PACE_MID, t * 2) : lerpColor(PACE_MID, PACE_SLOW, (t - 0.5) * 2);
        });
      }
    }
    for (let i = 1; i < pts.length; i++) {
      ctx.strokeStyle = colors[i];
      ctx.beginPath();
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
  }
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  if (l.showStartEnd) {
    const r = Math.max(l.strokeWidth * 0.9, 4);
    const dot = (p: RoutePoint, c: string) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
      ctx.lineWidth = Math.max(2, r * 0.45);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    };
    dot(pts[0], l.startColor);
    if (progress >= 1) dot(pts[pts.length - 1], l.endColor);
    else dot(pts[pts.length - 1], l.strokeColor);
  }
}

function drawShape(ctx: Ctx, l: LayerOf<'shape'>) {
  ctx.beginPath();
  if (l.shape === 'rect') ctx.roundRect(0, 0, l.width, l.height, Math.min(l.radius, l.width / 2, l.height / 2));
  else if (l.shape === 'ellipse') ctx.ellipse(l.width / 2, l.height / 2, l.width / 2, l.height / 2, 0, 0, Math.PI * 2);
  else {
    ctx.moveTo(0, l.height / 2);
    ctx.lineTo(l.width, l.height / 2);
  }
  if (l.shape !== 'line' && l.fill && l.fill !== 'transparent') {
    ctx.fillStyle = l.fill;
    ctx.fill();
  }
  if (l.strokeWidth > 0 && l.stroke && l.stroke !== 'transparent') {
    ctx.lineWidth = l.shape === 'line' ? Math.max(l.strokeWidth, 1) : l.strokeWidth;
    ctx.strokeStyle = l.stroke;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

/** Compute where media is drawn inside a w×h frame given fit / zoom / offsets. */
export function mediaRect(mw: number, mh: number, w: number, h: number, fit: 'cover' | 'contain' | 'fill', zoom: number, ox: number, oy: number) {
  let dw: number;
  let dh: number;
  if (fit === 'fill') {
    dw = w * zoom;
    dh = h * zoom;
  } else {
    const s = (fit === 'cover' ? Math.max(w / mw, h / mh) : Math.min(w / mw, h / mh)) * zoom;
    dw = mw * s;
    dh = mh * s;
  }
  const x = (w - dw) / 2 + (ox * Math.abs(dw - w)) / 2;
  const y = (h - dh) / 2 + (oy * Math.abs(dh - h)) / 2;
  return { x, y, w: dw, h: dh };
}

function drawMedia(ctx: Ctx, l: LayerOf<'image'> | LayerOf<'video'>, opts: RenderOptions) {
  const m = opts.media(l.assetId);
  if (!m || !m.width) {
    if (opts.placeholders) placeholder(ctx, l.width, l.height, l.type === 'video' ? 'Video loading…' : 'Image missing');
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, l.width, l.height, Math.min(l.cornerRadius, l.width / 2, l.height / 2));
  ctx.clip();
  const r = mediaRect(m.width, m.height, l.width, l.height, l.fit, l.zoom, l.offsetX, l.offsetY);
  ctx.drawImage(m.source, r.x, r.y, r.w, r.h);
  ctx.restore();
}

function drawIcon(ctx: Ctx, l: LayerOf<'icon'>) {
  const path = iconPath(l.icon);
  if (!path) return;
  const s = Math.min(l.width, l.height) / 24;
  ctx.translate((l.width - 24 * s) / 2, (l.height - 24 * s) / 2);
  ctx.scale(s, s);
  ctx.strokeStyle = l.color;
  ctx.lineWidth = l.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(path);
}

const seriesCache = new WeakMap<ActivityMetrics, Map<string, { d: number; v: number }[]>>();
function drawChart(ctx: Ctx, l: LayerOf<'chart'>, opts: RenderOptions, progress: number) {
  if (!opts.activity || !opts.metrics) {
    if (opts.placeholders) placeholder(ctx, l.width, l.height, 'Chart');
    return;
  }
  let c = seriesCache.get(opts.metrics);
  if (!c) seriesCache.set(opts.metrics, (c = new Map()));
  let s = c.get(l.series);
  if (!s) c.set(l.series, (s = buildSeries(opts.activity, opts.metrics, l.series)));
  if (s.length < 2) {
    if (opts.placeholders) placeholder(ctx, l.width, l.height, `No ${l.series} data`);
    return;
  }
  const vals = s.map((p) => p.v);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (l.series === 'pace') {
    const sorted = [...vals].sort((a, b) => a - b);
    lo = sorted[Math.floor(sorted.length * 0.03)];
    hi = sorted[Math.floor(sorted.length * 0.97)];
  }
  const range = Math.max(hi - lo, 1e-6);
  const maxD = s[s.length - 1].d;
  const pad = l.strokeWidth;
  const toX = (d: number) => (d / maxD) * l.width;
  // pace: faster (lower) is drawn higher
  const toY = (v: number) => {
    const t = clamp01((v - lo) / range);
    return pad + (l.series === 'pace' ? t : 1 - t) * (l.height - pad * 2);
  };
  const shown = s.filter((p) => p.d <= maxD * progress + 1e-6);
  if (shown.length < 2) return;
  ctx.beginPath();
  shown.forEach((p, i) => (i ? ctx.lineTo(toX(p.d), toY(p.v)) : ctx.moveTo(toX(p.d), toY(p.v))));
  if (l.fillOpacity > 0) {
    ctx.save();
    ctx.lineTo(toX(shown[shown.length - 1].d), l.height);
    ctx.lineTo(0, l.height);
    ctx.closePath();
    ctx.globalAlpha *= l.fillOpacity;
    ctx.fillStyle = l.color;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    shown.forEach((p, i) => (i ? ctx.lineTo(toX(p.d), toY(p.v)) : ctx.moveTo(toX(p.d), toY(p.v))));
  }
  if (l.strokeWidth > 0) {
    ctx.strokeStyle = l.color;
    ctx.lineWidth = l.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

function placeholder(ctx: Ctx, w: number, h: number, label: string) {
  ctx.save();
  ctx.fillStyle = 'rgba(128,128,128,0.15)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(128,128,128,0.6)';
  ctx.setLineDash([12, 8]);
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(128,128,128,0.9)';
  ctx.font = `600 ${Math.max(14, Math.min(36, w / 12))}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, h / 2);
  ctx.restore();
}
