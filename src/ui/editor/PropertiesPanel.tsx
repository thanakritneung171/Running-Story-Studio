import { useEffect, useRef } from 'react';
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronUp, Copy, Trash2, Lock, Unlock, Eye, EyeOff } from 'lucide-react';
import type { Background, Layer, LayerAnimation, LayerOf, TextStyle } from '../../../shared/design';
import { useDoc, useEditor } from './store';
import { cmd } from '../../lib/editor/commands';
import { FONT_FAMILIES } from '../../lib/render/fonts';
import { METRICS } from '../../lib/activity/format';
import { ICON_NAMES } from '../../lib/render/icons';
import { mediaRegistry } from '../../lib/media/registry';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="border-b border-ink-800 p-3">
    <h3 className="label mb-2">{title}</h3>
    <div className="space-y-2">{children}</div>
  </section>
);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0 text-ink-400">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </label>
  );
}

function Num({ value, onChange, step = 1, min, max, suffix }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  return (
    <div className="relative w-full">
      <input
        type="number"
        className="input pr-6 tabular-nums"
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(min !== undefined ? Math.max(min, max !== undefined ? Math.min(max, v) : v) : v);
        }}
      />
      {suffix && <span className="pointer-events-none absolute top-1.5 right-2 text-xs text-ink-400">{suffix}</span>}
    </div>
  );
}

function Slider({ value, onChange, min, max, step = 0.01 }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  return <input type="range" className="w-full" value={value} min={min} max={max} step={step} onChange={(e) => onChange(parseFloat(e.target.value))} />;
}

/** Colour picker + text field (accepts hex, rgba(), named colours). */
function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : /^#[0-9a-f]{3}$/i.test(value) ? `#${[...value.slice(1)].map((c) => c + c).join('')}` : '#000000';
  return (
    <div className="flex w-full items-center gap-2">
      <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} aria-label="Pick colour" />
      <input className="input font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
    </div>
  );
}

export function PropertiesPanel() {
  const doc = useDoc();
  const selection = useEditor((s) => s.selection);
  const selected = doc.layers.filter((l) => selection.includes(l.id));
  if (selected.length === 0) return <CanvasProps />;
  if (selected.length > 1) return <MultiProps ids={selection} />;
  return <LayerProps key={selected[0].id} l={selected[0]} />;
}

function CanvasProps() {
  const doc = useDoc();
  const st = useEditor.getState();
  const bg = doc.canvas.background;
  const setBg = (b: Background) => st.run('Background', (d) => void (d.canvas.background = b), 'bg');
  return (
    <div>
      <Section title="Canvas">
        <Row label="Size">
          <span className="text-ink-300 tabular-nums">
            {doc.canvas.width} × {doc.canvas.height}px
          </span>
        </Row>
        <Row label="Width">
          <Num value={doc.canvas.width} min={64} max={4096} onChange={(v) => st.run('Canvas size', cmd.resizeCanvas(Math.round(v), doc.canvas.height, false), 'cw')} />
        </Row>
        <Row label="Height">
          <Num value={doc.canvas.height} min={64} max={4096} onChange={(v) => st.run('Canvas size', cmd.resizeCanvas(doc.canvas.width, Math.round(v), false), 'ch')} />
        </Row>
      </Section>
      <Section title="Background">
        <div className="flex rounded-lg border border-ink-700 p-0.5 text-xs">
          {(['solid', 'gradient', 'transparent'] as const).map((t) => (
            <button
              key={t}
              className={`flex-1 rounded-md py-1 capitalize ${bg.type === t ? 'bg-ink-700' : 'text-ink-400'}`}
              onClick={() => setBg(t === 'solid' ? { type: 'solid', color: bg.type === 'gradient' ? bg.from : '#111318' } : t === 'gradient' ? { type: 'gradient', from: bg.type === 'solid' ? bg.color : '#FF5F1F', to: '#1a1a1a', angle: 180 } : { type: 'transparent' })}
            >
              {t}
            </button>
          ))}
        </div>
        {bg.type === 'solid' && (
          <Row label="Colour">
            <ColorField value={bg.color} onChange={(c) => setBg({ ...bg, color: c })} />
          </Row>
        )}
        {bg.type === 'gradient' && (
          <>
            <Row label="From">
              <ColorField value={bg.from} onChange={(c) => setBg({ ...bg, from: c })} />
            </Row>
            <Row label="To">
              <ColorField value={bg.to} onChange={(c) => setBg({ ...bg, to: c })} />
            </Row>
            <Row label="Angle">
              <Slider value={bg.angle} min={0} max={360} step={1} onChange={(v) => setBg({ ...bg, angle: v })} />
            </Row>
          </>
        )}
        {bg.type === 'transparent' && <p className="text-xs text-ink-400">Exports as a PNG with real transparency. Videos use black behind transparent areas (MP4 has no alpha channel).</p>}
      </Section>
      <Section title="Animation timeline">
        <Row label="Duration">
          <Num value={doc.timeline.durationS} min={1} max={60} step={0.5} suffix="s" onChange={(v) => st.run('Duration', (d) => void (d.timeline.durationS = v), 'dur')} />
        </Row>
        <Row label="Frame rate">
          <select className="input" value={doc.timeline.fps} onChange={(e) => st.run('FPS', (d) => void (d.timeline.fps = Number(e.target.value) as 24 | 25 | 30 | 60))}>
            {[24, 25, 30, 60].map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
        </Row>
      </Section>
      <p className="p-3 text-xs text-ink-400">Select a layer on the canvas or in the Layers tab to edit it. Shortcuts: ⌘/Ctrl+Z undo, ⌘/Ctrl+D duplicate, Delete, arrows to nudge, [ ] to reorder, Space to play.</p>
    </div>
  );
}

function ArrangeButtons({ ids, single }: { ids: string[]; single?: Layer }) {
  const st = useEditor.getState();
  const btn = 'btn btn-ghost btn-icon h-7 w-7';
  return (
    <>
      <div className="flex flex-wrap gap-0.5">
        {(
          [
            ['left', AlignStartVertical, 'Align left'],
            ['hcenter', AlignCenterVertical, 'Align centre'],
            ['right', AlignEndVertical, 'Align right'],
            ['top', AlignStartHorizontal, 'Align top'],
            ['vmiddle', AlignCenterHorizontal, 'Align middle'],
            ['bottom', AlignEndHorizontal, 'Align bottom'],
          ] as const
        ).map(([how, I, label]) => (
          <button key={how} className={btn} title={`${label}${ids.length > 1 ? ' (selection)' : ' (canvas)'}`} aria-label={label} onClick={() => st.run(label, cmd.align(ids, how, ids.length === 1))}>
            <I size={15} />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-0.5">
        <button className={btn} title="Bring to front" aria-label="Bring to front" onClick={() => st.run('Bring to front', cmd.zOrder(ids, 'front'))}>
          <ArrowUpToLine size={15} />
        </button>
        <button className={btn} title="Bring forward" aria-label="Bring forward" onClick={() => st.run('Bring forward', cmd.zOrder(ids, 'forward'))}>
          <ChevronUp size={15} />
        </button>
        <button className={btn} title="Send backward" aria-label="Send backward" onClick={() => st.run('Send backward', cmd.zOrder(ids, 'backward'))}>
          <ChevronDown size={15} />
        </button>
        <button className={btn} title="Send to back" aria-label="Send to back" onClick={() => st.run('Send to back', cmd.zOrder(ids, 'back'))}>
          <ArrowDownToLine size={15} />
        </button>
        <span className="mx-1 w-px bg-ink-800" />
        {single && (
          <>
            <button className={btn} aria-label={single.visible ? 'Hide' : 'Show'} title={single.visible ? 'Hide' : 'Show'} onClick={() => st.run('Visibility', cmd.patchLayer(single.id, { visible: !single.visible }))}>
              {single.visible ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <button className={btn} aria-label={single.locked ? 'Unlock' : 'Lock'} title={single.locked ? 'Unlock' : 'Lock'} onClick={() => st.run('Lock', cmd.patchLayer(single.id, { locked: !single.locked }))}>
              {single.locked ? <Lock size={15} /> : <Unlock size={15} />}
            </button>
          </>
        )}
        <button className={btn} title="Duplicate (⌘/Ctrl+D)" aria-label="Duplicate" onClick={st.duplicateSelected}>
          <Copy size={15} />
        </button>
        <button className={`${btn} text-bad`} title="Delete" aria-label="Delete layer" onClick={st.deleteSelected}>
          <Trash2 size={15} />
        </button>
      </div>
    </>
  );
}

function MultiProps({ ids }: { ids: string[] }) {
  return (
    <Section title={`${ids.length} layers selected`}>
      <ArrangeButtons ids={ids} />
    </Section>
  );
}

function LayerProps({ l }: { l: Layer }) {
  const st = useEditor.getState();
  const set = (patch: Partial<Layer>, field: string) => st.run(`Edit ${field}`, cmd.patchLayer(l.id, patch), `${l.id}:${field}`);
  return (
    <div data-testid="layer-props">
      <Section title={l.type === 'stat' ? 'Statistic' : l.type.charAt(0).toUpperCase() + l.type.slice(1)}>
        <Row label="Name">
          <input className="input" value={l.name} onChange={(e) => set({ name: e.target.value }, 'name')} />
        </Row>
        <ArrangeButtons ids={[l.id]} single={l} />
      </Section>
      <Section title="Position & size">
        <div className="grid grid-cols-2 gap-2">
          <Row label="X">
            <Num value={l.x} onChange={(v) => set({ x: v }, 'x')} />
          </Row>
          <Row label="Y">
            <Num value={l.y} onChange={(v) => set({ y: v }, 'y')} />
          </Row>
          <Row label="W">
            <Num value={l.width} min={1} onChange={(v) => set({ width: v }, 'w')} />
          </Row>
          <Row label="H">
            <Num value={l.height} min={1} onChange={(v) => set({ height: v }, 'h')} />
          </Row>
        </div>
        <Row label="Rotation">
          <Num value={l.rotation} step={1} suffix="°" onChange={(v) => set({ rotation: v }, 'rot')} />
        </Row>
        <Row label="Opacity">
          <Slider value={l.opacity} min={0} max={1} onChange={(v) => set({ opacity: v }, 'opacity')} />
          <span className="w-9 text-right tabular-nums">{Math.round(l.opacity * 100)}%</span>
        </Row>
        <Row label="Blend">
          <select className="input" value={l.blendMode} onChange={(e) => set({ blendMode: e.target.value as Layer['blendMode'] }, 'blend')}>
            {['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'soft-light', 'difference'].map((b) => (
              <option key={b} value={b}>
                {b === 'source-over' ? 'normal' : b}
              </option>
            ))}
          </select>
        </Row>
        <label className="flex items-center gap-2 text-xs text-ink-300" title="Background layers are left out of transparent overlay exports">
          <input type="checkbox" checked={l.isBackground} onChange={(e) => set({ isBackground: e.target.checked }, 'bgflag')} /> Background layer (excluded from overlay exports)
        </label>
      </Section>
      {l.type === 'text' && <TextProps l={l} />}
      {l.type === 'stat' && <StatProps l={l} />}
      {l.type === 'route' && <RouteProps l={l} />}
      {l.type === 'shape' && <ShapeProps l={l} />}
      {(l.type === 'image' || l.type === 'video') && <MediaProps l={l} />}
      {l.type === 'icon' && <IconProps l={l} />}
      {l.type === 'chart' && <ChartProps l={l} />}
      <AnimationProps l={l} />
    </div>
  );
}

function TextStyleFields({ s, onChange }: { s: TextStyle; onChange: (p: Partial<TextStyle>) => void }) {
  return (
    <>
      <Row label="Font">
        <select className="input" value={s.fontFamily} onChange={(e) => onChange({ fontFamily: e.target.value })}>
          {FONT_FAMILIES.map((f) => (
            <option key={f} style={{ fontFamily: f }}>
              {f}
            </option>
          ))}
        </select>
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <Row label="Size">
          <Num value={s.fontSize} min={4} max={2000} onChange={(v) => onChange({ fontSize: v })} />
        </Row>
        <Row label="Weight">
          <select className="input" value={s.fontWeight} onChange={(e) => onChange({ fontWeight: Number(e.target.value) })}>
            {[400, 500, 600, 700, 800, 900].map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        </Row>
      </div>
      <Row label="Colour">
        <ColorField value={s.color} onChange={(c) => onChange({ color: c })} />
      </Row>
      <Row label="Align">
        <div className="flex w-full rounded-md border border-ink-700 p-0.5 text-xs">
          {(['left', 'center', 'right'] as const).map((a) => (
            <button key={a} className={`flex-1 rounded py-0.5 capitalize ${s.align === a ? 'bg-ink-700' : 'text-ink-400'}`} onClick={() => onChange({ align: a })}>
              {a}
            </button>
          ))}
        </div>
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <Row label="Spacing">
          <Num value={s.letterSpacing} step={0.5} onChange={(v) => onChange({ letterSpacing: v })} />
        </Row>
        <Row label="Line h.">
          <Num value={s.lineHeight} step={0.05} min={0.5} max={4} onChange={(v) => onChange({ lineHeight: v })} />
        </Row>
      </div>
      <div className="flex gap-4 text-xs text-ink-300">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={s.uppercase} onChange={(e) => onChange({ uppercase: e.target.checked })} /> UPPERCASE
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={s.italic} onChange={(e) => onChange({ italic: e.target.checked })} /> Italic
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={!!s.shadow} onChange={(e) => onChange({ shadow: e.target.checked ? { color: 'rgba(0,0,0,0.5)', blur: 12, x: 0, y: 3 } : undefined })} /> Shadow
        </label>
      </div>
      {s.shadow && (
        <Row label="Shadow">
          <ColorField value={s.shadow.color} onChange={(c) => onChange({ shadow: { ...s.shadow!, color: c } })} />
          <div className="w-16">
            <Num value={s.shadow.blur} min={0} max={200} onChange={(v) => onChange({ shadow: { ...s.shadow!, blur: v } })} />
          </div>
        </Row>
      )}
    </>
  );
}

function TextProps({ l }: { l: LayerOf<'text'> }) {
  const st = useEditor.getState();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const h = (e: Event) => (e as CustomEvent).detail === l.id && ref.current?.focus();
    window.addEventListener('rss:edit-text', h);
    return () => window.removeEventListener('rss:edit-text', h);
  }, [l.id]);
  return (
    <Section title="Text">
      <textarea ref={ref} className="input min-h-[72px]" value={l.text} onChange={(e) => st.run('Edit text', cmd.patchLayer(l.id, { text: e.target.value }), `${l.id}:text`)} data-testid="text-input" />
      <TextStyleFields s={l.style} onChange={(p) => st.run('Text style', cmd.patchLayerPath(l.id, 'style', p), `${l.id}:style:${Object.keys(p).join()}`)} />
    </Section>
  );
}

function StatProps({ l }: { l: LayerOf<'stat'> }) {
  const st = useEditor.getState();
  const metrics = useEditor((s) => s.metrics);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const h = (e: Event) => (e as CustomEvent).detail === l.id && ref.current?.focus();
    window.addEventListener('rss:edit-text', h);
    return () => window.removeEventListener('rss:edit-text', h);
  }, [l.id]);
  const set = (p: Partial<LayerOf<'stat'>>, f: string) => st.run('Edit stat', cmd.patchLayer(l.id, p as Partial<Layer>), `${l.id}:${f}`);
  const av = metrics?.availability[l.metric];
  return (
    <>
      <Section title="Metric">
        <Row label="Shows">
          <select className="input" value={l.metric} onChange={(e) => set({ metric: e.target.value as LayerOf<'stat'>['metric'], label: METRICS.find((m) => m.key === e.target.value)?.short ?? l.label }, 'metric')}>
            {METRICS.map((m) => (
              <option key={m.key} value={m.key} disabled={!metrics?.availability[m.key]?.available}>
                {m.label}
                {metrics?.availability[m.key]?.available ? '' : ' (n/a)'}
              </option>
            ))}
          </select>
        </Row>
        {av && !av.available && <p className="text-xs text-warn">Not available: {av.reason}</p>}
        <Row label="Label">
          <input ref={ref} className="input" value={l.label} onChange={(e) => set({ label: e.target.value }, 'label')} />
        </Row>
        <Row label="Layout">
          <select className="input" value={l.layout} onChange={(e) => set({ layout: e.target.value as LayerOf<'stat'>['layout'] }, 'layout')}>
            <option value="stacked">Label above</option>
            <option value="label-below">Label below</option>
            <option value="inline">Value + unit inline</option>
          </select>
        </Row>
        <div className="flex gap-4 text-xs text-ink-300">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={l.showLabel} onChange={(e) => set({ showLabel: e.target.checked }, 'showLabel')} /> Show label
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={l.showUnit} onChange={(e) => set({ showUnit: e.target.checked }, 'showUnit')} /> Show unit
          </label>
        </div>
      </Section>
      <Section title="Value style">
        <TextStyleFields s={l.valueStyle} onChange={(p) => st.run('Value style', cmd.patchLayerPath(l.id, 'valueStyle', p), `${l.id}:vs:${Object.keys(p).join()}`)} />
      </Section>
      {l.showLabel && (
        <Section title="Label style">
          <TextStyleFields s={l.labelStyle} onChange={(p) => st.run('Label style', cmd.patchLayerPath(l.id, 'labelStyle', p), `${l.id}:ls:${Object.keys(p).join()}`)} />
        </Section>
      )}
    </>
  );
}

function RouteProps({ l }: { l: LayerOf<'route'> }) {
  const st = useEditor.getState();
  const set = (p: Partial<LayerOf<'route'>>, f: string) => st.run('Route style', cmd.patchLayer(l.id, p as Partial<Layer>), `${l.id}:${f}`);
  return (
    <Section title="Route">
      <Row label="Colour by">
        <select className="input" value={l.colorMode} onChange={(e) => set({ colorMode: e.target.value as LayerOf<'route'>['colorMode'] }, 'mode')}>
          <option value="solid">Solid colour</option>
          <option value="gradient">Gradient (start → finish)</option>
          <option value="pace">Pace (green fast → red slow)</option>
          <option value="elevation">Elevation (green low → red high)</option>
        </select>
      </Row>
      {l.colorMode !== 'pace' && l.colorMode !== 'elevation' && (
        <Row label="Colour">
          <ColorField value={l.strokeColor} onChange={(c) => set({ strokeColor: c }, 'color')} />
        </Row>
      )}
      {l.colorMode === 'gradient' && (
        <Row label="To">
          <ColorField value={l.gradientTo} onChange={(c) => set({ gradientTo: c }, 'to')} />
        </Row>
      )}
      <Row label="Width">
        <Slider value={l.strokeWidth} min={1} max={60} step={0.5} onChange={(v) => set({ strokeWidth: v }, 'sw')} />
        <span className="w-8 text-right tabular-nums">{Math.round(l.strokeWidth)}</span>
      </Row>
      <Row label="Glow">
        <Slider value={l.glow} min={0} max={80} step={1} onChange={(v) => set({ glow: v }, 'glow')} />
      </Row>
      <Row label="Padding">
        <Slider value={l.padding} min={0} max={Math.min(l.width, l.height) / 2 - 1} step={1} onChange={(v) => set({ padding: v }, 'pad')} />
      </Row>
      <label className="flex items-center gap-2 text-xs text-ink-300">
        <input type="checkbox" checked={l.showStartEnd} onChange={(e) => set({ showStartEnd: e.target.checked }, 'se')} /> Start / finish markers
      </label>
      {l.showStartEnd && (
        <div className="grid grid-cols-2 gap-2">
          <Row label="Start">
            <input type="color" value={l.startColor} onChange={(e) => set({ startColor: e.target.value }, 'sc')} />
          </Row>
          <Row label="Finish">
            <input type="color" value={l.endColor} onChange={(e) => set({ endColor: e.target.value }, 'ec')} />
          </Row>
        </div>
      )}
      <Row label="Privacy">
        <select className="input" value={l.privacyTrimM} onChange={(e) => set({ privacyTrimM: Number(e.target.value) }, 'privacy')}>
          <option value={0}>Show full route</option>
          <option value={200}>Hide first/last 200 m</option>
          <option value={500}>Hide first/last 500 m</option>
          <option value={1000}>Hide first/last 1 km</option>
        </select>
      </Row>
      <p className="text-[11px] text-ink-400">Hiding the ends of the route keeps your home or work location private.</p>
    </Section>
  );
}

function ShapeProps({ l }: { l: LayerOf<'shape'> }) {
  const st = useEditor.getState();
  const set = (p: Partial<LayerOf<'shape'>>, f: string) => st.run('Shape style', cmd.patchLayer(l.id, p as Partial<Layer>), `${l.id}:${f}`);
  return (
    <Section title="Shape">
      {l.shape !== 'line' && (
        <Row label="Fill">
          <ColorField value={l.fill} onChange={(c) => set({ fill: c }, 'fill')} />
        </Row>
      )}
      <Row label="Stroke">
        <ColorField value={l.stroke} onChange={(c) => set({ stroke: c }, 'stroke')} />
      </Row>
      <Row label="Stroke w.">
        <Num value={l.strokeWidth} min={0} onChange={(v) => set({ strokeWidth: v }, 'sw')} />
      </Row>
      {l.shape === 'rect' && (
        <Row label="Radius">
          <Num value={l.radius} min={0} onChange={(v) => set({ radius: v }, 'r')} />
        </Row>
      )}
    </Section>
  );
}

function MediaProps({ l }: { l: LayerOf<'image'> | LayerOf<'video'> }) {
  const st = useEditor.getState();
  const set = (p: Record<string, unknown>, f: string) => st.run('Media', cmd.patchLayer(l.id, p as Partial<Layer>), `${l.id}:${f}`);
  const v = mediaRegistry.get(l.assetId)?.el;
  const duration = v instanceof HTMLVideoElement ? v.duration : undefined;
  return (
    <Section title={l.type === 'video' ? 'Video' : 'Image'}>
      <Row label="Fit">
        <div className="flex w-full rounded-md border border-ink-700 p-0.5 text-xs">
          {(['cover', 'contain', 'fill'] as const).map((f) => (
            <button key={f} className={`flex-1 rounded py-0.5 capitalize ${l.fit === f ? 'bg-ink-700' : 'text-ink-400'}`} onClick={() => set({ fit: f }, 'fit')}>
              {f === 'cover' ? 'Fill' : f === 'contain' ? 'Fit' : 'Stretch'}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Crop zoom">
        <Slider value={l.zoom} min={1} max={4} onChange={(z) => set({ zoom: z }, 'zoom')} />
      </Row>
      <Row label="Pan X">
        <Slider value={l.offsetX} min={-1} max={1} onChange={(x) => set({ offsetX: x }, 'ox')} />
      </Row>
      <Row label="Pan Y">
        <Slider value={l.offsetY} min={-1} max={1} onChange={(y) => set({ offsetY: y }, 'oy')} />
      </Row>
      <Row label="Corners">
        <Num value={l.cornerRadius} min={0} onChange={(r) => set({ cornerRadius: r }, 'cr')} />
      </Row>
      {l.type === 'video' && (
        <>
          <Row label="Trim in">
            <Num value={l.trimStartS} min={0} max={duration} step={0.1} suffix="s" onChange={(t) => set({ trimStartS: t }, 'tin')} />
          </Row>
          <Row label="Trim out">
            <Num value={l.trimEndS ?? duration ?? 0} min={0} max={duration} step={0.1} suffix="s" onChange={(t) => set({ trimEndS: t }, 'tout')} />
          </Row>
          {duration !== undefined && <p className="text-[11px] text-ink-400">Clip length {duration.toFixed(1)} s. Used length {((l.trimEndS ?? duration) - l.trimStartS).toFixed(1)} s.</p>}
          <label className="flex items-center gap-2 text-xs text-ink-300">
            <input type="checkbox" checked={!l.muted} onChange={(e) => set({ muted: !e.target.checked }, 'mute')} /> Keep audio
          </label>
          {!l.muted && (
            <Row label="Volume">
              <Slider value={l.volume} min={0} max={1} onChange={(v2) => set({ volume: v2 }, 'vol')} />
            </Row>
          )}
          <button
            className="btn w-full text-xs"
            onClick={() => {
              const len = (l.trimEndS ?? duration ?? 0) - l.trimStartS;
              if (len > 0) st.run('Match duration', (d) => void (d.timeline.durationS = Math.max(1, Math.min(60, Math.round(len * 10) / 10))));
            }}
          >
            Set timeline to clip length
          </button>
        </>
      )}
    </Section>
  );
}

function IconProps({ l }: { l: LayerOf<'icon'> }) {
  const st = useEditor.getState();
  const set = (p: Partial<LayerOf<'icon'>>, f: string) => st.run('Icon', cmd.patchLayer(l.id, p as Partial<Layer>), `${l.id}:${f}`);
  return (
    <Section title="Icon">
      <Row label="Icon">
        <select className="input" value={l.icon} onChange={(e) => set({ icon: e.target.value }, 'icon')}>
          {ICON_NAMES.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </Row>
      <Row label="Colour">
        <ColorField value={l.color} onChange={(c) => set({ color: c }, 'color')} />
      </Row>
      <Row label="Stroke">
        <Slider value={l.strokeWidth} min={0.5} max={6} step={0.25} onChange={(v) => set({ strokeWidth: v }, 'sw')} />
      </Row>
    </Section>
  );
}

function ChartProps({ l }: { l: LayerOf<'chart'> }) {
  const st = useEditor.getState();
  const set = (p: Partial<LayerOf<'chart'>>, f: string) => st.run('Chart', cmd.patchLayer(l.id, p as Partial<Layer>), `${l.id}:${f}`);
  return (
    <Section title="Chart">
      <Row label="Data">
        <select className="input" value={l.series} onChange={(e) => set({ series: e.target.value as LayerOf<'chart'>['series'] }, 'series')}>
          <option value="elevation">Elevation</option>
          <option value="pace">Pace</option>
          <option value="heartrate">Heart rate</option>
        </select>
      </Row>
      <Row label="Colour">
        <ColorField value={l.color} onChange={(c) => set({ color: c }, 'color')} />
      </Row>
      <Row label="Fill">
        <Slider value={l.fillOpacity} min={0} max={1} onChange={(v) => set({ fillOpacity: v }, 'fill')} />
      </Row>
      <Row label="Line">
        <Slider value={l.strokeWidth} min={0} max={20} step={0.5} onChange={(v) => set({ strokeWidth: v }, 'sw')} />
      </Row>
    </Section>
  );
}

function AnimationProps({ l }: { l: Layer }) {
  const st = useEditor.getState();
  const a: LayerAnimation = l.animation ?? { enter: 'none', delayS: 0, durationS: 0.6, exit: 'none' };
  const set = (p: Partial<LayerAnimation>, f: string) => st.run('Animation', cmd.patchLayer(l.id, { animation: { ...a, ...p } }), `${l.id}:anim:${f}`);
  const options: LayerAnimation['enter'][] = ['none', 'fade', 'slide-up', 'slide-left', 'scale'];
  if (l.type === 'route' || l.type === 'chart') options.push('draw');
  if (l.type === 'stat') options.push('count-up');
  return (
    <Section title="Animation (video export)">
      <Row label="Entrance">
        <select className="input" value={a.enter} onChange={(e) => set({ enter: e.target.value as LayerAnimation['enter'] }, 'enter')}>
          {options.map((o) => (
            <option key={o} value={o}>
              {o === 'draw' ? 'Draw along route' : o === 'count-up' ? 'Count up' : o}
            </option>
          ))}
        </select>
      </Row>
      {a.enter !== 'none' && (
        <div className="grid grid-cols-2 gap-2">
          <Row label="Delay">
            <Num value={a.delayS} min={0} max={60} step={0.1} suffix="s" onChange={(v) => set({ delayS: v }, 'delay')} />
          </Row>
          <Row label="Length">
            <Num value={a.durationS} min={0} max={60} step={0.1} suffix="s" onChange={(v) => set({ durationS: v }, 'dur')} />
          </Row>
        </div>
      )}
      <Row label="Exit">
        <select className="input" value={a.exit} onChange={(e) => set({ exit: e.target.value as LayerAnimation['exit'] }, 'exit')}>
          <option value="none">None</option>
          <option value="fade">Fade out at end</option>
        </select>
      </Row>
    </Section>
  );
}
