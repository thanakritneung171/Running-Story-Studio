import type { Layer, LayerOf, TextStyle } from '../../../shared/design';
import type { MetricKey } from '../activity/types';
import { metricLabel } from '../activity/format';
import { uid } from './ids';

type Base = Pick<Layer, 'x' | 'y' | 'width' | 'height'> & Partial<Omit<Layer, 'type'>>;

const common = (b: Base, name: string) => ({
  id: b.id ?? uid('l'),
  name: b.name ?? name,
  x: b.x,
  y: b.y,
  width: b.width,
  height: b.height,
  rotation: b.rotation ?? 0,
  opacity: b.opacity ?? 1,
  visible: b.visible ?? true,
  locked: b.locked ?? false,
  blendMode: b.blendMode ?? ('source-over' as const),
  isBackground: b.isBackground ?? false,
  animation: b.animation,
});

export const textStyle = (s: Partial<TextStyle> = {}): TextStyle => ({
  fontFamily: 'Inter',
  fontWeight: 700,
  fontSize: 48,
  color: '#ffffff',
  align: 'left',
  letterSpacing: 0,
  lineHeight: 1.15,
  uppercase: false,
  italic: false,
  ...s,
});

export function makeText(b: Base & { text: string; style?: Partial<TextStyle> }): LayerOf<'text'> {
  return { ...common(b, 'Text'), type: 'text', text: b.text, style: textStyle(b.style) };
}

export function makeStat(
  b: Base & {
    metric: MetricKey;
    label?: string;
    showLabel?: boolean;
    showUnit?: boolean;
    layout?: LayerOf<'stat'>['layout'];
    valueStyle?: Partial<TextStyle>;
    labelStyle?: Partial<TextStyle>;
  },
): LayerOf<'stat'> {
  return {
    ...common(b, metricLabel(b.metric)),
    type: 'stat',
    metric: b.metric,
    label: b.label ?? metricLabel(b.metric),
    showLabel: b.showLabel ?? true,
    showUnit: b.showUnit ?? true,
    layout: b.layout ?? 'stacked',
    valueStyle: textStyle({ fontSize: 72, fontWeight: 800, lineHeight: 1.05, ...b.valueStyle }),
    labelStyle: textStyle({ fontSize: 26, fontWeight: 600, letterSpacing: 2, uppercase: true, lineHeight: 1.4, ...b.labelStyle }),
  };
}

export function makeRoute(b: Base & Partial<Omit<LayerOf<'route'>, 'type'>>): LayerOf<'route'> {
  return {
    ...common(b, 'GPS route'),
    type: 'route',
    strokeColor: b.strokeColor ?? '#FC4C02',
    strokeWidth: b.strokeWidth ?? 10,
    colorMode: b.colorMode ?? 'solid',
    gradientTo: b.gradientTo ?? '#FFD600',
    glow: b.glow ?? 0,
    padding: b.padding ?? 20,
    showStartEnd: b.showStartEnd ?? false,
    startColor: b.startColor ?? '#22c55e',
    endColor: b.endColor ?? '#ef4444',
    privacyTrimM: b.privacyTrimM ?? 0,
    shadow: b.shadow,
  };
}

export function makeShape(b: Base & Partial<Omit<LayerOf<'shape'>, 'type'>>): LayerOf<'shape'> {
  return {
    ...common(b, b.shape === 'ellipse' ? 'Ellipse' : b.shape === 'line' ? 'Line' : 'Rectangle'),
    type: 'shape',
    shape: b.shape ?? 'rect',
    fill: b.fill ?? '#ffffff',
    stroke: b.stroke ?? 'transparent',
    strokeWidth: b.strokeWidth ?? 0,
    radius: b.radius ?? 0,
  };
}

export function makeImage(b: Base & { assetId: string; role?: 'photo' | 'logo' } & Partial<LayerOf<'image'>>): LayerOf<'image'> {
  return {
    ...common(b, b.role === 'logo' ? 'Logo' : 'Photo'),
    type: 'image',
    assetId: b.assetId,
    role: b.role ?? 'photo',
    fit: b.fit ?? 'cover',
    zoom: b.zoom ?? 1,
    offsetX: b.offsetX ?? 0,
    offsetY: b.offsetY ?? 0,
    cornerRadius: b.cornerRadius ?? 0,
  };
}

export function makeVideo(b: Base & { assetId: string } & Partial<LayerOf<'video'>>): LayerOf<'video'> {
  return {
    ...common(b, 'Video'),
    type: 'video',
    assetId: b.assetId,
    fit: b.fit ?? 'cover',
    zoom: b.zoom ?? 1,
    offsetX: b.offsetX ?? 0,
    offsetY: b.offsetY ?? 0,
    cornerRadius: b.cornerRadius ?? 0,
    trimStartS: b.trimStartS ?? 0,
    trimEndS: b.trimEndS ?? null,
    muted: b.muted ?? false,
    volume: b.volume ?? 1,
  };
}

export function makeIcon(b: Base & { icon: string; color?: string; strokeWidth?: number }): LayerOf<'icon'> {
  return { ...common(b, `Icon: ${b.icon}`), type: 'icon', icon: b.icon, color: b.color ?? '#ffffff', strokeWidth: b.strokeWidth ?? 2 };
}

export function makeChart(b: Base & Partial<Omit<LayerOf<'chart'>, 'type'>>): LayerOf<'chart'> {
  const series = b.series ?? 'elevation';
  return {
    ...common(b, series === 'pace' ? 'Pace chart' : series === 'heartrate' ? 'Heart-rate chart' : 'Elevation chart'),
    type: 'chart',
    series,
    color: b.color ?? '#ffffff',
    fillOpacity: b.fillOpacity ?? 0.25,
    strokeWidth: b.strokeWidth ?? 4,
  };
}
