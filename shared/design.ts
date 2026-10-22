/**
 * Versioned design document schema shared by the editor, renderer, exporters and the Worker API.
 * Bump DESIGN_SCHEMA_VERSION and add a migration in `migrateDesign` for any breaking change.
 */
import { z } from 'zod';

export const DESIGN_SCHEMA_VERSION = 1;

const color = z.string().max(64);
const finite = z.number().finite();

export const ShadowSchema = z.object({ color, blur: finite.min(0).max(200), x: finite, y: finite });

export const AnimationSchema = z.object({
  enter: z.enum(['none', 'fade', 'slide-up', 'slide-left', 'scale', 'draw', 'count-up']),
  delayS: finite.min(0).max(600),
  durationS: finite.min(0).max(600),
  exit: z.enum(['none', 'fade']).default('none'),
});
export type LayerAnimation = z.infer<typeof AnimationSchema>;

const base = {
  id: z.string().min(1).max(64),
  name: z.string().max(120),
  x: finite,
  y: finite,
  width: finite.min(1),
  height: finite.min(1),
  rotation: finite,
  opacity: finite.min(0).max(1),
  visible: z.boolean(),
  locked: z.boolean(),
  blendMode: z
    .enum(['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'soft-light', 'difference'])
    .default('source-over'),
  /** Background layers are omitted when exporting an overlay without background. */
  isBackground: z.boolean().default(false),
  animation: AnimationSchema.optional(),
};

export const TextStyleSchema = z.object({
  fontFamily: z.string().max(80),
  fontWeight: z.number().int().min(100).max(900),
  fontSize: finite.min(1).max(2000),
  color,
  align: z.enum(['left', 'center', 'right']),
  letterSpacing: finite.min(-50).max(200),
  lineHeight: finite.min(0.5).max(4),
  uppercase: z.boolean(),
  italic: z.boolean().default(false),
  shadow: ShadowSchema.optional(),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const MetricKeySchema = z.enum([
  'distance', 'movingTime', 'elapsedTime', 'avgPace', 'avgSpeed', 'maxSpeed', 'bestPace', 'elevGain', 'elevLoss',
  'minEle', 'maxEle', 'avgHr', 'maxHr', 'avgCadence', 'calories', 'date', 'startTime', 'name', 'location', 'fastestSplit',
]);

const fit = z.enum(['cover', 'contain', 'fill']);
const crop = {
  fit,
  /** Extra zoom applied after fitting (1 = none). Together with offsets this is the crop. */
  zoom: finite.min(0.1).max(10),
  /** Pan of the media inside the frame, -1..1 of the available overflow. */
  offsetX: finite.min(-1).max(1),
  offsetY: finite.min(-1).max(1),
  cornerRadius: finite.min(0).default(0),
};

export const LayerSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('text'), text: z.string().max(2000), style: TextStyleSchema }),
  z.object({
    ...base,
    type: z.literal('stat'),
    metric: MetricKeySchema,
    label: z.string().max(80),
    showLabel: z.boolean(),
    showUnit: z.boolean(),
    layout: z.enum(['stacked', 'inline', 'label-below']),
    valueStyle: TextStyleSchema,
    labelStyle: TextStyleSchema,
  }),
  z.object({
    ...base,
    type: z.literal('route'),
    strokeColor: color,
    strokeWidth: finite.min(0.5).max(200),
    colorMode: z.enum(['solid', 'gradient', 'pace', 'elevation']),
    gradientTo: color,
    glow: finite.min(0).max(100),
    padding: finite.min(0),
    showStartEnd: z.boolean(),
    startColor: color,
    endColor: color,
    privacyTrimM: finite.min(0).max(5000),
    shadow: ShadowSchema.optional(),
  }),
  z.object({
    ...base,
    type: z.literal('shape'),
    shape: z.enum(['rect', 'ellipse', 'line']),
    fill: color,
    stroke: color,
    strokeWidth: finite.min(0).max(200),
    radius: finite.min(0),
  }),
  z.object({ ...base, type: z.literal('image'), assetId: z.string().max(64), role: z.enum(['photo', 'logo']).default('photo'), ...crop }),
  z.object({
    ...base,
    type: z.literal('video'),
    assetId: z.string().max(64),
    ...crop,
    trimStartS: finite.min(0),
    trimEndS: finite.min(0).nullable(),
    muted: z.boolean(),
    volume: finite.min(0).max(1),
  }),
  z.object({ ...base, type: z.literal('icon'), icon: z.string().max(40), color, strokeWidth: finite.min(0.5).max(10) }),
  z.object({
    ...base,
    type: z.literal('chart'),
    series: z.enum(['elevation', 'pace', 'heartrate']),
    color,
    fillOpacity: finite.min(0).max(1),
    strokeWidth: finite.min(0).max(40),
  }),
]);
export type Layer = z.infer<typeof LayerSchema>;
export type LayerType = Layer['type'];
export type LayerOf<T extends LayerType> = Extract<Layer, { type: T }>;

export const BackgroundSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('transparent') }),
  z.object({ type: z.literal('solid'), color }),
  z.object({ type: z.literal('gradient'), from: color, to: color, angle: finite }),
]);
export type Background = z.infer<typeof BackgroundSchema>;

export const DesignDocumentSchema = z.object({
  schemaVersion: z.literal(DESIGN_SCHEMA_VERSION),
  canvas: z.object({
    width: z.number().int().min(16).max(8192),
    height: z.number().int().min(16).max(8192),
    background: BackgroundSchema,
  }),
  layers: z.array(LayerSchema).max(500),
  timeline: z.object({ durationS: finite.min(1).max(120), fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]) }),
  units: z.enum(['metric', 'imperial']),
  templateId: z.string().max(64).optional(),
});
export type DesignDocument = z.infer<typeof DesignDocumentSchema>;

/** Upgrade any stored document to the current schema version. Throws if invalid. */
export function migrateDesign(raw: unknown): DesignDocument {
  if (!raw || typeof raw !== 'object') throw new Error('Design document is not an object.');
  const doc = { ...(raw as Record<string, unknown>) };
  const v = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 0;
  if (v > DESIGN_SCHEMA_VERSION) throw new Error(`Design was created by a newer version (schema ${v}).`);
  if (v === 0) {
    // Pre-release documents had no version, units or timeline.
    doc.schemaVersion = 1;
    doc.units ??= 'metric';
    doc.timeline ??= { durationS: 8, fps: 30 };
  }
  return DesignDocumentSchema.parse(doc);
}
