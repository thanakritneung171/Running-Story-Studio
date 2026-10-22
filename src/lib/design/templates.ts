import { DESIGN_SCHEMA_VERSION, type Background, type DesignDocument, type Layer, type TextStyle } from '../../../shared/design';
import type { ActivityMetrics, MetricKey } from '../activity/types';
import { makeChart, makeRoute, makeShape, makeStat, makeText } from './factory';

export interface TemplateContext {
  width: number;
  height: number;
  /** Metrics to show as stat tiles, in order. */
  metrics: MetricKey[];
  units: 'metric' | 'imperial';
}

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  /** Preferred canvas size. */
  defaultSize: { width: number; height: number };
  exportModes: ('png' | 'png-transparent' | 'jpeg' | 'mp4')[];
  /** Metrics used when the user has not chosen any. */
  defaultMetrics: MetricKey[];
  build: (ctx: TemplateContext) => Omit<DesignDocument, 'schemaVersion' | 'units' | 'templateId'>;
}

export const STORY = { width: 1080, height: 1920 };
export const SQUARE = { width: 1080, height: 1080 };

type StatOpts = {
  value: Partial<TextStyle>;
  label: Partial<TextStyle>;
  layout?: 'stacked' | 'inline' | 'label-below';
  stagger?: number;
  startDelay?: number;
  enter?: 'slide-up' | 'fade' | 'count-up' | 'scale';
};

/** Lay out stat tiles in a grid of up to `cols` columns inside the given box. */
function statGrid(keys: MetricKey[], x: number, y: number, w: number, rowH: number, cols: number, o: StatOpts): Layer[] {
  const out: Layer[] = [];
  const n = keys.length;
  const c = Math.min(cols, Math.max(1, n));
  const colW = w / c;
  keys.forEach((k, i) => {
    const row = Math.floor(i / c);
    const col = i % c;
    out.push(
      makeStat({
        metric: k,
        x: x + col * colW,
        y: y + row * rowH,
        width: colW - 10,
        height: rowH - 10,
        layout: o.layout ?? 'stacked',
        valueStyle: o.value,
        labelStyle: o.label,
        animation: {
          enter: o.enter ?? 'slide-up',
          delayS: (o.startDelay ?? 1.2) + i * (o.stagger ?? 0.15),
          durationS: 0.7,
          exit: 'none',
        },
      }),
    );
  });
  return out;
}

const draw = (delayS = 0.2, durationS = 2.6) => ({ enter: 'draw' as const, delayS, durationS, exit: 'none' as const });
const fade = (delayS = 0, durationS = 0.6) => ({ enter: 'fade' as const, delayS, durationS, exit: 'none' as const });

function size(ctx: TemplateContext) {
  const { width: W, height: H } = ctx;
  const u = W / 1080;
  const tall = H / W > 1.4;
  return { W, H, u, tall };
}

const bg = (b: Background) => b;

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Quiet, airy layout with a fine-line route and one hero number.',
    defaultSize: STORY,
    exportModes: ['png', 'png-transparent', 'jpeg', 'mp4'],
    defaultMetrics: ['distance', 'movingTime', 'avgPace', 'elevGain'],
    build(ctx) {
      const { W, H, u, tall } = size(ctx);
      const [hero, ...rest] = ctx.metrics;
      const m = 90 * u;
      const ink = '#111111';
      const layers: Layer[] = [
        makeStat({ metric: 'date', x: m, y: m, width: W - 2 * m, height: 50 * u, showLabel: false, valueStyle: { fontSize: 30 * u, fontWeight: 600, color: '#6b6b6b', letterSpacing: 3 * u, uppercase: true }, labelStyle: {}, name: 'Date', animation: fade() }),
        makeRoute({ x: m, y: tall ? 260 * u : 150 * u, width: W - 2 * m, height: tall ? H * 0.42 : H * 0.42, strokeColor: ink, strokeWidth: 6 * u, padding: 10 * u, animation: draw() }),
      ];
      if (hero)
        layers.push(
          makeStat({ metric: hero, x: m, y: tall ? H * 0.6 : H * 0.6, width: W - 2 * m, height: 260 * u, layout: 'label-below', valueStyle: { fontSize: 190 * u, fontWeight: 900, color: ink, letterSpacing: -6 * u, lineHeight: 1 }, labelStyle: { fontSize: 28 * u, color: '#6b6b6b', letterSpacing: 4 * u }, animation: { enter: 'count-up', delayS: 0.8, durationS: 1.6, exit: 'none' } }),
        );
      layers.push(makeShape({ x: m, y: tall ? H * 0.6 + 290 * u : H * 0.83, width: W - 2 * m, height: 4 * u, shape: 'line', stroke: ink, strokeWidth: 2 * u, fill: 'transparent', name: 'Rule', animation: fade(1.4) }));
      layers.push(...statGrid(rest, m, tall ? H * 0.6 + 330 * u : H * 0.85, W - 2 * m, 150 * u, 3, { value: { fontSize: 58 * u, color: ink, fontWeight: 800 }, label: { fontSize: 22 * u, color: '#6b6b6b', letterSpacing: 3 * u }, startDelay: 1.6 }));
      return { canvas: { width: W, height: H, background: bg({ type: 'solid', color: '#F6F5F1' }) }, layers, timeline: { durationS: 6, fps: 30 } };
    },
  },
  {
    id: 'sporty',
    name: 'Sporty',
    description: 'Bold condensed type, energetic gradient and a glowing route.',
    defaultSize: STORY,
    exportModes: ['png', 'jpeg', 'mp4'],
    defaultMetrics: ['distance', 'avgPace', 'movingTime', 'avgHr'],
    build(ctx) {
      const { W, H, u, tall } = size(ctx);
      const m = 70 * u;
      const [hero, ...rest] = ctx.metrics;
      const layers: Layer[] = [
        makeShape({ x: -200 * u, y: H * 0.08, width: W + 400 * u, height: 220 * u, rotation: -8, fill: 'rgba(255,255,255,0.08)', name: 'Stripe', animation: fade() }),
        makeText({ x: m, y: m, width: W - 2 * m, height: 120 * u, text: 'RUN DAY', style: { fontFamily: 'Bebas Neue', fontWeight: 400, fontSize: 110 * u, color: '#ffffff', letterSpacing: 4 * u, lineHeight: 1 }, animation: { enter: 'slide-left', delayS: 0, durationS: 0.6, exit: 'none' } }),
        makeStat({ metric: 'date', x: m, y: m + 115 * u, width: W - 2 * m, height: 50 * u, showLabel: false, valueStyle: { fontFamily: 'Oswald', fontWeight: 500, fontSize: 34 * u, color: 'rgba(255,255,255,0.85)', uppercase: true, letterSpacing: 2 * u }, labelStyle: {}, name: 'Date', animation: fade(0.3) }),
        makeRoute({ x: m, y: tall ? 330 * u : 220 * u, width: W - 2 * m, height: tall ? H * 0.4 : H * 0.38, strokeColor: '#ffffff', strokeWidth: 12 * u, glow: 24 * u, showStartEnd: true, startColor: '#22c55e', endColor: '#111111', animation: draw(0.4) }),
      ];
      if (hero)
        layers.push(makeStat({ metric: hero, x: m, y: tall ? H * 0.6 : H * 0.6, width: W - 2 * m, height: 300 * u, layout: 'label-below', valueStyle: { fontFamily: 'Bebas Neue', fontWeight: 400, fontSize: 260 * u, color: '#ffffff', lineHeight: 0.95 }, labelStyle: { fontFamily: 'Oswald', fontWeight: 700, fontSize: 34 * u, color: '#111111', letterSpacing: 6 * u }, animation: { enter: 'count-up', delayS: 1, durationS: 1.5, exit: 'none' } }));
      layers.push(...statGrid(rest, m, tall ? H * 0.6 + 330 * u : H * 0.86, W - 2 * m, 160 * u, 3, { value: { fontFamily: 'Bebas Neue', fontWeight: 400, fontSize: 92 * u, color: '#ffffff' }, label: { fontFamily: 'Oswald', fontWeight: 700, fontSize: 24 * u, color: '#111111', letterSpacing: 4 * u }, startDelay: 1.6 }));
      return { canvas: { width: W, height: H, background: { type: 'gradient', from: '#FF5F1F', to: '#FF2E63', angle: 160 } }, layers, timeline: { durationS: 6, fps: 30 } };
    },
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'Magazine-style serif headline, fine rules and a statistics table.',
    defaultSize: STORY,
    exportModes: ['png', 'jpeg', 'mp4'],
    defaultMetrics: ['distance', 'movingTime', 'avgPace', 'elevGain'],
    build(ctx) {
      const { W, H, u, tall } = size(ctx);
      const m = 80 * u;
      const ink = '#1b1a17';
      const accent = '#9b2c1f';
      const layers: Layer[] = [
        makeText({ x: m, y: m, width: W - 2 * m, height: 40 * u, text: 'The Weekly Run — Issue Nº 1', style: { fontFamily: 'Inter', fontWeight: 600, fontSize: 22 * u, color: accent, letterSpacing: 4 * u, uppercase: true }, animation: fade() }),
        makeShape({ x: m, y: m + 50 * u, width: W - 2 * m, height: 4 * u, shape: 'line', stroke: ink, strokeWidth: 2 * u, fill: 'transparent', name: 'Rule' }),
        makeStat({ metric: 'name', x: m, y: m + 80 * u, width: W - 2 * m, height: tall ? 260 * u : 170 * u, showLabel: false, valueStyle: { fontFamily: 'Playfair Display', fontWeight: 400, italic: true, fontSize: tall ? 110 * u : 80 * u, color: ink, lineHeight: 1.05 }, labelStyle: {}, name: 'Title', animation: { enter: 'slide-up', delayS: 0.2, durationS: 0.8, exit: 'none' } }),
        makeStat({ metric: 'date', x: m, y: tall ? m + 300 * u : m + 230 * u, width: W - 2 * m, height: 44 * u, showLabel: false, valueStyle: { fontFamily: 'Playfair Display', fontWeight: 400, fontSize: 30 * u, color: '#5c574f' }, labelStyle: {}, name: 'Date', animation: fade(0.5) }),
        makeRoute({ x: m, y: tall ? 470 * u : 330 * u, width: W - 2 * m, height: tall ? H * 0.4 : H * 0.36, strokeColor: accent, strokeWidth: 7 * u, padding: 20 * u, showStartEnd: false, animation: draw(0.6) }),
      ];
      const tableY = tall ? H * 0.69 : H * 0.72;
      layers.push(makeShape({ x: m, y: tableY - 20 * u, width: W - 2 * m, height: 4 * u, shape: 'line', stroke: ink, strokeWidth: 2 * u, fill: 'transparent', name: 'Rule' }));
      layers.push(...statGrid(ctx.metrics, m, tableY, W - 2 * m, tall ? 190 * u : 150 * u, 2, { value: { fontFamily: 'Playfair Display', fontWeight: 700, fontSize: tall ? 84 * u : 64 * u, color: ink }, label: { fontFamily: 'Inter', fontWeight: 600, fontSize: 22 * u, color: '#5c574f', letterSpacing: 3 * u }, enter: 'fade', startDelay: 1.6 }));
      return { canvas: { width: W, height: H, background: { type: 'solid', color: '#F3EDE2' } }, layers, timeline: { durationS: 6, fps: 30 } };
    },
  },
  {
    id: 'dark-performance',
    name: 'Dark Performance',
    description: 'Data-dense, monospace stats, neon route and elevation profile.',
    defaultSize: STORY,
    exportModes: ['png', 'jpeg', 'mp4'],
    defaultMetrics: ['distance', 'movingTime', 'avgPace', 'elevGain', 'avgHr', 'avgCadence'],
    build(ctx) {
      const { W, H, u, tall } = size(ctx);
      const m = 70 * u;
      const neon = '#C6FF00';
      const layers: Layer[] = [
        makeStat({ metric: 'name', x: m, y: m, width: W - 2 * m, height: 70 * u, showLabel: false, valueStyle: { fontFamily: 'Inter', fontWeight: 800, fontSize: 52 * u, color: '#ffffff' }, labelStyle: {}, name: 'Title', animation: fade() }),
        makeStat({ metric: 'date', x: m, y: m + 70 * u, width: W - 2 * m, height: 40 * u, showLabel: false, valueStyle: { fontFamily: 'JetBrains Mono', fontWeight: 500, fontSize: 26 * u, color: neon, uppercase: true, letterSpacing: 2 * u }, labelStyle: {}, name: 'Date', animation: fade(0.2) }),
        makeRoute({ x: m, y: tall ? 230 * u : 170 * u, width: W - 2 * m, height: tall ? H * 0.38 : H * 0.34, strokeColor: neon, strokeWidth: 8 * u, glow: 30 * u, showStartEnd: true, startColor: '#ffffff', endColor: neon, animation: draw(0.3) }),
        makeChart({ x: m, y: tall ? H * 0.53 : H * 0.53, width: W - 2 * m, height: tall ? 170 * u : 110 * u, series: 'elevation', color: neon, fillOpacity: 0.18, strokeWidth: 3 * u, animation: draw(0.8, 2) }),
      ];
      layers.push(...statGrid(ctx.metrics, m, tall ? H * 0.66 : H * 0.7, W - 2 * m, tall ? 170 * u : 140 * u, 2, { value: { fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: tall ? 76 * u : 56 * u, color: '#ffffff', letterSpacing: -1 * u }, label: { fontFamily: 'JetBrains Mono', fontWeight: 500, fontSize: 22 * u, color: neon, letterSpacing: 2 * u }, enter: 'count-up', startDelay: 1.4, stagger: 0.12 }));
      return { canvas: { width: W, height: H, background: { type: 'gradient', from: '#0B0D10', to: '#16191F', angle: 180 } }, layers, timeline: { durationS: 6, fps: 30 } };
    },
  },
  {
    id: 'route-focus',
    name: 'Route Focus',
    description: 'The route takes centre stage, coloured by pace.',
    defaultSize: STORY,
    exportModes: ['png', 'png-transparent', 'jpeg', 'mp4'],
    defaultMetrics: ['distance', 'movingTime', 'avgPace'],
    build(ctx) {
      const { W, H, u, tall } = size(ctx);
      const m = 60 * u;
      const layers: Layer[] = [
        makeRoute({ x: m, y: tall ? 160 * u : 60 * u, width: W - 2 * m, height: tall ? H * 0.68 : H * 0.7, strokeColor: '#38bdf8', strokeWidth: 14 * u, colorMode: 'pace', padding: 30 * u, showStartEnd: true, startColor: '#ffffff', endColor: '#ffffff', shadow: { color: 'rgba(0,0,0,0.5)', blur: 20 * u, x: 0, y: 8 * u }, animation: draw(0.2, 3.2) }),
        ...statGrid(ctx.metrics, m, tall ? H * 0.8 : H * 0.8, W - 2 * m, 180 * u, 3, { value: { fontFamily: 'Inter', fontWeight: 800, fontSize: 64 * u, color: '#ffffff', align: 'center' }, label: { fontSize: 22 * u, color: '#94a3b8', letterSpacing: 3 * u, align: 'center' }, startDelay: 2.4, enter: 'fade' }),
      ];
      return { canvas: { width: W, height: H, background: { type: 'gradient', from: '#0f172a', to: '#1e293b', angle: 180 } }, layers, timeline: { durationS: 6, fps: 30 } };
    },
  },
  {
    id: 'photo-overlay',
    name: 'Photo Overlay',
    description: 'Your photo or video full-bleed, with a legible stats band on top.',
    defaultSize: STORY,
    exportModes: ['png', 'png-transparent', 'jpeg', 'mp4'],
    defaultMetrics: ['distance', 'movingTime', 'avgPace'],
    build(ctx) {
      const { W, H, u } = size(ctx);
      const m = 70 * u;
      const layers: Layer[] = [
        makeShape({ x: 0, y: H * 0.55, width: W, height: H * 0.45, fill: 'rgba(0,0,0,0.45)', name: 'Scrim', animation: fade() }),
        makeRoute({ x: W - m - 330 * u, y: H * 0.58, width: 330 * u, height: 330 * u, strokeColor: '#ffffff', strokeWidth: 7 * u, padding: 10 * u, animation: draw(0.4, 2) }),
        makeStat({ metric: 'name', x: m, y: H * 0.6, width: W - 2 * m - 360 * u, height: 200 * u, showLabel: false, valueStyle: { fontSize: 64 * u, fontWeight: 800, color: '#ffffff', lineHeight: 1.05 }, labelStyle: {}, name: 'Title', animation: { enter: 'slide-up', delayS: 0.3, durationS: 0.7, exit: 'none' } }),
        ...statGrid(ctx.metrics, m, H * 0.6 + 380 * u, W - 2 * m, 170 * u, 3, { value: { fontSize: 68 * u, fontWeight: 800, color: '#ffffff', shadow: { color: 'rgba(0,0,0,0.35)', blur: 12 * u, x: 0, y: 2 * u } }, label: { fontSize: 22 * u, color: 'rgba(255,255,255,0.8)', letterSpacing: 3 * u }, startDelay: 1 }),
      ];
      return { canvas: { width: W, height: H, background: { type: 'gradient', from: '#3a4a5a', to: '#1a222b', angle: 180 } }, layers, timeline: { durationS: 6, fps: 30 } };
    },
  },
  {
    id: 'transparent-overlay',
    name: 'Transparent Overlay',
    description: 'No background — route and stats only, ready to place on your own photo or video.',
    defaultSize: STORY,
    exportModes: ['png-transparent', 'mp4'],
    defaultMetrics: ['distance', 'avgPace', 'movingTime'],
    build(ctx) {
      const { W, H, u } = size(ctx);
      const shadow = { color: 'rgba(0,0,0,0.45)', blur: 10 * u, x: 0, y: 2 * u };
      const colW = 600 * u;
      const x = (W - colW) / 2;
      const top = H * 0.25;
      const layers: Layer[] = [];
      ctx.metrics.forEach((k, i) =>
        layers.push(
          makeStat({ metric: k, x, y: top + i * 165 * u, width: colW, height: 150 * u, valueStyle: { fontSize: 76 * u, fontWeight: 800, color: '#ffffff', align: 'center', shadow }, labelStyle: { fontSize: 26 * u, fontWeight: 600, color: '#ffffff', align: 'center', letterSpacing: 1 * u, uppercase: false, shadow }, animation: { enter: 'slide-up', delayS: 0.2 + i * 0.15, durationS: 0.6, exit: 'none' } }),
        ),
      );
      const ry = top + ctx.metrics.length * 165 * u + 40 * u;
      layers.push(makeRoute({ x: (W - 600 * u) / 2, y: ry, width: 600 * u, height: Math.min(600 * u, H - ry - 60 * u), strokeColor: '#FC4C02', strokeWidth: 12 * u, padding: 10 * u, animation: draw(0.6, 2.4) }));
      return { canvas: { width: W, height: H, background: { type: 'transparent' } }, layers, timeline: { durationS: 5, fps: 30 } };
    },
  },
];

export const getTemplate = (id: string) => TEMPLATES.find((t) => t.id === id);

/** Pick available metrics for a template: requested ones that exist, topped up with the template defaults. */
export function chooseMetrics(requested: MetricKey[] | null, def: TemplateDef, metrics: ActivityMetrics | null): MetricKey[] {
  const available = (k: MetricKey) => !metrics || metrics.availability[k]?.available;
  const base = (requested && requested.length ? requested : def.defaultMetrics).filter(available);
  if (requested && requested.length) return base;
  const fallbacks: MetricKey[] = ['distance', 'movingTime', 'avgPace', 'elevGain', 'elapsedTime', 'avgSpeed', 'avgHr', 'calories'];
  for (const k of fallbacks) {
    if (base.length >= def.defaultMetrics.length) break;
    if (!base.includes(k) && available(k)) base.push(k);
  }
  return base;
}

export function buildFromTemplate(def: TemplateDef, ctx: TemplateContext): DesignDocument {
  const built = def.build(ctx);
  return { schemaVersion: DESIGN_SCHEMA_VERSION, units: ctx.units, templateId: def.id, ...built };
}
