import { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Eye, EyeOff, Lock, Unlock, GripVertical, ImagePlus, LayoutTemplate, BarChart3, Shapes, Layers, Upload, X, Type, Square, Circle, Minus, Route as RouteIcon, AreaChart, Loader2, Image as ImageIcon, Film } from 'lucide-react';
import type { Draft } from 'immer';
import type { DesignDocument, Layer, LayerOf } from '../../../shared/design';
import { useDoc, useEditor } from './store';
import { cmd } from '../../lib/editor/commands';
import { TEMPLATES, buildFromTemplate, chooseMetrics, getTemplate } from '../../lib/design/templates';
import { METRICS, metricLabel } from '../../lib/activity/format';
import type { MetricKey } from '../../lib/activity/types';
import { makeChart, makeIcon, makeImage, makeRoute, makeShape, makeStat, makeText, makeVideo } from '../../lib/design/factory';
import { ICON_NAMES, iconPath } from '../../lib/render/icons';
import { DocCanvas } from '../components/DocCanvas';
import { putAsset, getAsset } from '../../lib/media/store';
import type { MediaAsset } from '../../lib/media/types';
import { mediaRegistry } from '../../lib/media/registry';
import { listTemplates, saveTemplate } from '../../lib/projects/service';
import { uid } from '../../lib/design/ids';
import type { PersonalTemplate } from '../../lib/projects/types';

type Tab = 'templates' | 'stats' | 'elements' | 'uploads' | 'layers';
const TABS: { id: Tab; label: string; icon: typeof Layers }[] = [
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'stats', label: 'Stats', icon: BarChart3 },
  { id: 'elements', label: 'Elements', icon: Shapes },
  { id: 'uploads', label: 'Uploads', icon: ImagePlus },
  { id: 'layers', label: 'Layers', icon: Layers },
];

export function LeftPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('layers');
  return (
    <div className="flex h-full w-full">
      <nav className="flex w-[68px] shrink-0 flex-col items-stretch gap-1 border-r border-ink-800 py-2" aria-label="Editor sections">
        {TABS.map(({ id, label, icon: I }) => (
          <button key={id} onClick={() => setTab(id)} aria-pressed={tab === id} data-testid={`tab-${id}`} className={`mx-1.5 flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] ${tab === id ? 'bg-ink-800 text-white' : 'text-ink-400 hover:text-white'}`}>
            <I size={18} />
            {label}
          </button>
        ))}
        <button className="mx-1.5 mt-auto rounded-lg py-2 text-ink-400 lg:hidden" onClick={onClose} aria-label="Close panel">
          <X size={18} className="mx-auto" />
        </button>
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto p-3">
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'stats' && <StatsTab />}
        {tab === 'elements' && <ElementsTab />}
        {tab === 'uploads' && <UploadsTab />}
        {tab === 'layers' && <LayersTab />}
      </div>
    </div>
  );
}

const H = ({ children }: { children: React.ReactNode }) => <h3 className="label mt-1 mb-2">{children}</h3>;

/** Replace the design with a template, keeping the user's photo/video background layers. */
function applyDesign(next: DesignDocument, label: string) {
  const s = useEditor.getState();
  const keep = s.history.present.layers.filter((l) => (l.type === 'image' || l.type === 'video') && l.isBackground);
  s.run(label, (d) => {
    const bgDraft = keep.map((l) => structuredClone(l)) as Draft<Layer>[];
    d.canvas = next.canvas as Draft<DesignDocument['canvas']>;
    d.timeline = next.timeline;
    d.templateId = next.templateId;
    d.layers = [...bgDraft, ...(next.layers as Draft<Layer>[])];
  });
  s.select([]);
}

function TemplatesTab() {
  const doc = useDoc();
  const project = useEditor((s) => s.project)!;
  const metrics = useEditor((s) => s.metrics);
  const [personal, setPersonal] = useState<PersonalTemplate[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    listTemplates().then(setPersonal).catch(() => undefined);
  }, []);
  const build = (id: string) => {
    const t = getTemplate(id)!;
    return buildFromTemplate(t, { width: doc.canvas.width, height: doc.canvas.height, metrics: chooseMetrics(project.selectedMetrics.length ? project.selectedMetrics : null, t, metrics), units: doc.units });
  };
  const previews = useMemo(() => TEMPLATES.map((t) => ({ t, d: build(t.id) })), [doc.canvas.width, doc.canvas.height, doc.units, metrics]);
  return (
    <div>
      <H>Current design</H>
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          className="btn text-xs"
          onClick={async () => {
            const name = prompt('Template name', `${project.name} style`);
            if (!name?.trim()) return;
            const t = await saveTemplate({ id: uid('t'), name: name.trim(), design: structuredClone(doc), createdAt: Date.now(), updatedAt: Date.now() });
            setPersonal((p) => [t, ...p]);
            setMsg(`Saved “${t.name}” to My templates.`);
          }}
        >
          Save as my template
        </button>
        {doc.templateId && getTemplate(doc.templateId) && (
          <button className="btn text-xs" onClick={() => confirm('Restore the template’s default layout? Your changes can be undone.') && applyDesign(build(doc.templateId!), 'Restore template')}>
            Restore template defaults
          </button>
        )}
      </div>
      {msg && <p className="mb-3 text-xs text-ok">{msg}</p>}
      {personal.length > 0 && (
        <>
          <H>My templates</H>
          <div className="mb-4 grid grid-cols-2 gap-2">
            {personal.map((t) => (
              <button key={t.id} className="text-left text-xs" onClick={() => applyDesign({ ...structuredClone(t.design), units: doc.units }, `Apply ${t.name}`)}>
                <div className="overflow-hidden rounded-md border border-ink-700 hover:border-brand">
                  <DocCanvas doc={t.design} activity={project.activity} metrics={metrics} width={110} className="!h-auto !w-full" />
                </div>
                <span className="mt-1 block truncate">{t.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <H>Templates</H>
      <div className="grid grid-cols-2 gap-2">
        {previews.map(({ t, d }) => (
          <button key={t.id} className="text-left text-xs" onClick={() => applyDesign(d, `Apply ${t.name}`)} title={t.description}>
            <div className={`overflow-hidden rounded-md border ${doc.templateId === t.id ? 'border-brand' : 'border-ink-700 hover:border-ink-500'}`}>
              <DocCanvas doc={d} activity={project.activity} metrics={metrics} width={110} className="!h-auto !w-full" />
            </div>
            <span className="mt-1 block truncate">{t.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function StatsTab() {
  const doc = useDoc();
  const project = useEditor((s) => s.project)!;
  const metrics = useEditor((s) => s.metrics);
  const st = useEditor.getState();
  const statLayers = doc.layers.filter((l): l is LayerOf<'stat'> => l.type === 'stat');
  const toggle = (k: MetricKey, on: boolean) => {
    if (!on) {
      st.run(`Hide ${metricLabel(k)}`, cmd.remove(statLayers.filter((l) => l.metric === k).map((l) => l.id)));
      st.updateProject({ selectedMetrics: (project.selectedMetrics.length ? project.selectedMetrics : statLayers.map((l) => l.metric)).filter((m) => m !== k) });
      return;
    }
    // Match the look of an existing stat tile, placed below the lowest one.
    const ref = [...statLayers].filter((l) => l.showLabel).sort((a, b) => b.y - a.y)[0] ?? statLayers[0];
    const u = doc.canvas.width / 1080;
    const l = ref
      ? { ...structuredClone(ref), id: uid('l'), metric: k, label: metricLabel(k), name: metricLabel(k), showLabel: true, y: Math.min(doc.canvas.height - ref.height, ref.y + ref.height + 10 * u) }
      : makeStat({ metric: k, x: 80 * u, y: doc.canvas.height * 0.7, width: 420 * u, height: 140 * u, valueStyle: { fontSize: 72 * u }, labelStyle: { fontSize: 24 * u } });
    st.addLayer(l);
    st.updateProject({ selectedMetrics: [...new Set([...(project.selectedMetrics.length ? project.selectedMetrics : statLayers.map((x) => x.metric)), k])] });
  };
  return (
    <div>
      <H>Statistics on the design</H>
      <p className="mb-3 text-xs text-ink-400">Toggle a metric to add or remove its tile. Values update automatically from the activity.</p>
      {!metrics && <p className="text-sm text-ink-400">This project has no activity.</p>}
      <ul className="space-y-1">
        {METRICS.map((d) => {
          const av = metrics?.availability[d.key];
          const on = statLayers.some((l) => l.metric === d.key);
          return (
            <li key={d.key}>
              <label className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${av?.available ? 'hover:bg-ink-800' : 'opacity-45'}`} title={av?.available ? undefined : av?.reason}>
                <input type="checkbox" checked={on} disabled={!av?.available && !on} onChange={(e) => toggle(d.key, e.target.checked)} data-testid={`stat-toggle-${d.key}`} />
                <span className="flex-1">{d.label}</span>
                {!av?.available && <span className="text-[10px] text-ink-400">n/a</span>}
              </label>
            </li>
          );
        })}
      </ul>
      <H>Units</H>
      <div className="flex rounded-lg border border-ink-700 p-0.5 text-sm">
        {(['metric', 'imperial'] as const).map((u) => (
          <button key={u} onClick={() => st.run('Units', (d) => void (d.units = u))} className={`flex-1 rounded-md px-3 py-1 ${doc.units === u ? 'bg-ink-700' : 'text-ink-400'}`}>
            {u === 'metric' ? 'Kilometres' : 'Miles'}
          </button>
        ))}
      </div>
    </div>
  );
}

function ElementsTab() {
  const doc = useDoc();
  const st = useEditor.getState();
  const u = doc.canvas.width / 1080;
  const cx = (w: number) => (doc.canvas.width - w) / 2;
  const cy = (h: number) => (doc.canvas.height - h) / 2;
  const add = (l: Layer) => st.addLayer(l);
  const Item = ({ icon: I, label, onClick }: { icon: typeof Type; label: string; onClick: () => void }) => (
    <button className="flex flex-col items-center gap-1 rounded-lg border border-ink-700 p-3 text-xs hover:border-ink-500 hover:bg-ink-800" onClick={onClick}>
      <I size={20} />
      {label}
    </button>
  );
  return (
    <div>
      <H>Text</H>
      <div className="mb-4 grid gap-2">
        <button className="rounded-lg border border-ink-700 px-3 py-2 text-left text-lg font-extrabold hover:bg-ink-800" onClick={() => add(makeText({ x: cx(800 * u), y: cy(120 * u), width: 800 * u, height: 120 * u, text: 'Add a heading', name: 'Heading', style: { fontSize: 96 * u, fontWeight: 900, align: 'center' } }))}>
          Add a heading
        </button>
        <button className="rounded-lg border border-ink-700 px-3 py-2 text-left text-sm hover:bg-ink-800" onClick={() => add(makeText({ x: cx(700 * u), y: cy(80 * u), width: 700 * u, height: 80 * u, text: 'Add some text', name: 'Text', style: { fontSize: 44 * u, fontWeight: 400, align: 'center' } }))}>
          Add body text
        </button>
      </div>
      <H>Graphics</H>
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Item icon={Square} label="Rectangle" onClick={() => add(makeShape({ x: cx(400 * u), y: cy(400 * u), width: 400 * u, height: 400 * u, fill: '#FF5A1F', radius: 24 * u }))} />
        <Item icon={Circle} label="Ellipse" onClick={() => add(makeShape({ shape: 'ellipse', x: cx(300 * u), y: cy(300 * u), width: 300 * u, height: 300 * u, fill: '#ffffff' }))} />
        <Item icon={Minus} label="Line" onClick={() => add(makeShape({ shape: 'line', x: cx(600 * u), y: cy(10 * u), width: 600 * u, height: 10 * u, fill: 'transparent', stroke: '#ffffff', strokeWidth: 4 * u }))} />
        <Item icon={RouteIcon} label="Route" onClick={() => add(makeRoute({ x: cx(700 * u), y: cy(700 * u), width: 700 * u, height: 700 * u, strokeWidth: 10 * u, animation: { enter: 'draw', delayS: 0.2, durationS: 2.5, exit: 'none' } }))} />
        <Item icon={AreaChart} label="Elevation" onClick={() => add(makeChart({ x: cx(900 * u), y: cy(200 * u), width: 900 * u, height: 200 * u, series: 'elevation', strokeWidth: 4 * u, animation: { enter: 'draw', delayS: 0.5, durationS: 2, exit: 'none' } }))} />
        <Item icon={AreaChart} label="Pace" onClick={() => add(makeChart({ x: cx(900 * u), y: cy(200 * u), width: 900 * u, height: 200 * u, series: 'pace', color: '#38bdf8', strokeWidth: 4 * u }))} />
      </div>
      <H>Icons</H>
      <div className="grid grid-cols-5 gap-1.5">
        {ICON_NAMES.map((n) => (
          <button key={n} title={n} className="flex aspect-square items-center justify-center rounded-md border border-ink-800 hover:border-ink-500" onClick={() => add(makeIcon({ icon: n, x: cx(120 * u), y: cy(120 * u), width: 120 * u, height: 120 * u, strokeWidth: 2 }))}>
            <IconPreview name={n} />
          </button>
        ))}
      </div>
    </div>
  );
}

function IconPreview({ name }: { name: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    c.width = c.height = 48;
    ctx.scale(2, 2);
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const p = iconPath(name);
    if (p) ctx.stroke(p);
  }, [name]);
  return <canvas ref={ref} style={{ width: 24, height: 24 }} />;
}

function UploadsTab() {
  const project = useEditor((s) => s.project)!;
  const doc = useDoc();
  const st = useEditor.getState();
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    Promise.all(project.assetIds.map(getAsset)).then((r) => setAssets(r.filter((x): x is MediaAsset => !!x)));
  }, [project.assetIds]);

  const addLayer = (a: MediaAsset, asBackground: boolean) => {
    const W = doc.canvas.width;
    const Hh = doc.canvas.height;
    let l: Layer;
    if (asBackground) {
      l = a.kind === 'image' ? makeImage({ assetId: a.id, x: 0, y: 0, width: W, height: Hh, isBackground: true, name: 'Background photo' }) : makeVideo({ assetId: a.id, x: 0, y: 0, width: W, height: Hh, isBackground: true, name: 'Background video' });
      // Replace any existing background media, insert at the bottom.
      const old = doc.layers.filter((x) => (x.type === 'image' || x.type === 'video') && x.isBackground).map((x) => x.id);
      st.run('Set background', (d) => {
        d.layers = d.layers.filter((x) => !old.includes(x.id));
        d.layers.unshift(l as Draft<Layer>);
        if (a.kind === 'video' && a.durationS) d.timeline.durationS = Math.max(1, Math.min(60, Math.round(a.durationS * 10) / 10));
      });
      st.select([l.id]);
    } else {
      const w = W * 0.6;
      const h = (w * a.height) / a.width;
      l = a.kind === 'image' ? makeImage({ assetId: a.id, x: (W - w) / 2, y: (Hh - h) / 2, width: w, height: h, fit: 'contain' }) : makeVideo({ assetId: a.id, x: (W - w) / 2, y: (Hh - h) / 2, width: w, height: h });
      st.addLayer(l);
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    const added: MediaAsset[] = [];
    for (const f of Array.from(files)) {
      try {
        const a = await putAsset(f);
        added.push(a);
        void mediaRegistry.ensure(a.id);
      } catch (e) {
        setError((e as Error).message);
      }
    }
    if (added.length) {
      st.updateProject({ assetIds: [...project.assetIds, ...added.map((a) => a.id)] });
      // First upload into an empty background slot becomes the background automatically.
      if (!doc.layers.some((l) => (l.type === 'image' || l.type === 'video') && l.isBackground)) addLayer(added[0], true);
    }
    setBusy(false);
  };

  return (
    <div>
      <H>Your photos & videos</H>
      <button className="btn btn-primary w-full" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Upload media
      </button>
      <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/quicktime,video/webm" className="hidden" data-testid="media-input" onChange={(e) => void onFiles(e.target.files).then(() => (e.target.value = ''))} />
      <p className="mt-2 text-xs text-ink-400">JPEG, PNG, WebP, AVIF, MP4, MOV, WebM. Stored in this browser{' '}(and your cloud if sync is on).</p>
      {error && <p className="mt-2 text-xs text-bad" role="alert">{error}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {assets.map((a) => (
          <AssetTile key={a.id} a={a} onAdd={() => addLayer(a, false)} onBackground={() => addLayer(a, true)} />
        ))}
      </div>
    </div>
  );
}

function AssetTile({ a, onAdd, onBackground }: { a: MediaAsset; onAdd: () => void; onBackground: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    void mediaRegistry.ensure(a.id).then((e) => e && setSrc(e.url));
  }, [a.id]);
  return (
    <div className="overflow-hidden rounded-lg border border-ink-700 text-xs">
      <div className="relative aspect-square bg-ink-850">
        {src && (a.kind === 'image' ? <img src={src} alt={a.name} className="h-full w-full object-cover" /> : <video src={src} muted className="h-full w-full object-cover" />)}
        <span className="absolute top-1 left-1 rounded bg-black/60 p-0.5">{a.kind === 'image' ? <ImageIcon size={12} /> : <Film size={12} />}</span>
      </div>
      <div className="flex">
        <button className="flex-1 py-1.5 hover:bg-ink-800" onClick={onAdd}>
          Add
        </button>
        <button className="flex-1 border-l border-ink-700 py-1.5 hover:bg-ink-800" onClick={onBackground}>
          Background
        </button>
      </div>
    </div>
  );
}

function LayersTab() {
  const doc = useDoc();
  const selection = useEditor((s) => s.selection);
  const st = useEditor.getState();
  const reversed = [...doc.layers].reverse(); // top of the list = front-most
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const toRev = reversed.findIndex((l) => l.id === e.over!.id);
    st.run('Reorder layers', cmd.reorder(String(e.active.id), doc.layers.length - 1 - toRev));
  };
  return (
    <div>
      <H>Layers (top = front)</H>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={reversed.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-0.5" data-testid="layer-list">
            {reversed.map((l) => (
              <LayerRow key={l.id} l={l} selected={selection.includes(l.id)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {doc.layers.length === 0 && <p className="text-sm text-ink-400">No layers yet. Add elements or stats.</p>}
    </div>
  );
}

function LayerRow({ l, selected }: { l: Layer; selected: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: l.id });
  const st = useEditor.getState();
  const [editing, setEditing] = useState(false);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      className={`group flex items-center gap-1 rounded-md px-1 py-1 text-sm ${selected ? 'bg-brand/15 ring-1 ring-brand/50' : 'hover:bg-ink-800'}`}
      data-testid="layer-row"
      data-layer-id={l.id}
    >
      <button className="cursor-grab p-0.5 text-ink-400" aria-label={`Drag to reorder ${l.name}`} {...attributes} {...listeners}>
        <GripVertical size={14} />
      </button>
      {editing ? (
        <input
          autoFocus
          className="input py-0.5"
          defaultValue={l.name}
          onBlur={(e) => {
            st.run('Rename layer', cmd.patchLayer(l.id, { name: e.target.value.slice(0, 120) || l.name }));
            setEditing(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <button
          className={`min-w-0 flex-1 truncate text-left ${l.visible ? '' : 'text-ink-400 line-through'}`}
          onClick={(e) => (e.shiftKey ? st.toggleSelect(l.id) : st.select([l.id]))}
          onDoubleClick={() => setEditing(true)}
          title="Click to select, double-click to rename"
        >
          {l.name}
          {l.isBackground && <span className="ml-1 text-[10px] text-ink-400">BG</span>}
        </button>
      )}
      <button className="p-0.5 text-ink-400 hover:text-white" aria-label={l.visible ? 'Hide layer' : 'Show layer'} onClick={() => st.run(l.visible ? 'Hide layer' : 'Show layer', cmd.patchLayer(l.id, { visible: !l.visible }))}>
        {l.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
      <button className="p-0.5 text-ink-400 hover:text-white" aria-label={l.locked ? 'Unlock layer' : 'Lock layer'} onClick={() => st.run(l.locked ? 'Unlock layer' : 'Lock layer', cmd.patchLayer(l.id, { locked: !l.locked }))}>
        {l.locked ? <Lock size={14} /> : <Unlock size={14} className="opacity-40 group-hover:opacity-100" />}
      </button>
    </li>
  );
}
