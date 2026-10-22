import { Link } from 'react-router-dom';
import { ArrowLeft, Cloud, CloudOff, Download, Loader2, Minus, Plus, Redo2, Undo2, AlertCircle, Check } from 'lucide-react';
import { useEditor, useDoc } from './store';
import { cmd } from '../../lib/editor/commands';

const SIZES = [
  { label: 'Story 1080×1920', w: 1080, h: 1920 },
  { label: 'Square 1080×1080', w: 1080, h: 1080 },
  { label: 'Portrait 1080×1350', w: 1080, h: 1350 },
  { label: 'Landscape 1920×1080', w: 1920, h: 1080 },
];

export function Toolbar({ onExport }: { onExport: () => void }) {
  const project = useEditor((s) => s.project)!;
  const doc = useDoc();
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const undoLabel = useEditor((s) => s.history.past.at(-1)?.label);
  const zoom = useEditor((s) => s.zoom);
  const save = useEditor((s) => s.save);
  const st = useEditor.getState();
  const sizeValue = SIZES.find((s) => s.w === doc.canvas.width && s.h === doc.canvas.height)?.label ?? 'custom';

  const setZoom = (dir: 1 | -1) => {
    const stage = document.querySelector('[data-testid="stage"]') as HTMLElement | null;
    const cur = zoom === 'fit' ? (stage ? stage.clientWidth / doc.canvas.width : 0.3) : zoom;
    const steps = [0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2];
    const next = dir > 0 ? steps.find((s) => s > cur + 0.001) ?? 2 : [...steps].reverse().find((s) => s < cur - 0.001) ?? 0.1;
    st.setZoom(next);
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-ink-800 bg-ink-900 px-2 md:px-3">
      <Link to="/projects" className="btn btn-ghost btn-icon" aria-label="Back to projects">
        <ArrowLeft size={18} />
      </Link>
      <input
        aria-label="Project name"
        className="w-28 truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium hover:border-ink-700 focus:border-brand focus:outline-none md:w-56"
        value={project.name}
        onChange={(e) => st.updateProject({ name: e.target.value })}
      />
      <SaveBadge save={save} />
      <div className="mx-1 h-6 w-px bg-ink-800 md:mx-2" />
      <button className="btn btn-ghost btn-icon" onClick={st.undo} disabled={!canUndo} aria-label="Undo" title={`Undo ${undoLabel ?? ''} (Ctrl/⌘+Z)`}>
        <Undo2 size={17} />
      </button>
      <button className="btn btn-ghost btn-icon" onClick={st.redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl/⌘+Shift+Z)">
        <Redo2 size={17} />
      </button>
      <div className="flex-1" />
      <select
        aria-label="Canvas size"
        className="input hidden w-auto md:block"
        value={sizeValue}
        onChange={(e) => {
          const s = SIZES.find((x) => x.label === e.target.value);
          if (s) st.run('Canvas size', cmd.resizeCanvas(s.w, s.h, true));
        }}
      >
        {SIZES.map((s) => (
          <option key={s.label}>{s.label}</option>
        ))}
        {sizeValue === 'custom' && <option value="custom">{`Custom ${doc.canvas.width}×${doc.canvas.height}`}</option>}
      </select>
      <div className="hidden items-center rounded-lg border border-ink-700 md:flex">
        <button className="btn btn-ghost btn-icon" onClick={() => setZoom(-1)} aria-label="Zoom out">
          <Minus size={15} />
        </button>
        <button className="w-14 text-xs text-ink-300 tabular-nums" onClick={() => st.setZoom('fit')} title="Fit to screen">
          {zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}
        </button>
        <button className="btn btn-ghost btn-icon" onClick={() => setZoom(1)} aria-label="Zoom in">
          <Plus size={15} />
        </button>
      </div>
      <button className="btn btn-primary" onClick={onExport} data-testid="open-export">
        <Download size={16} /> <span className="hidden sm:inline">Export</span>
      </button>
    </header>
  );
}

function SaveBadge({ save }: { save: ReturnType<typeof useEditor.getState>['save'] }) {
  const base = 'hidden items-center gap-1 text-xs sm:flex';
  if (save.status === 'saving')
    return (
      <span className={`${base} text-ink-400`}>
        <Loader2 size={13} className="animate-spin" /> Saving…
      </span>
    );
  if (save.status === 'dirty') return <span className={`${base} text-ink-400`}>Unsaved changes</span>;
  if (save.status === 'error')
    return (
      <span className={`${base} text-bad`} title={save.message}>
        <AlertCircle size={13} /> Save failed
      </span>
    );
  return (
    <span className={`${base} text-ink-400`} data-testid="save-status" title={save.message}>
      {save.cloud === 'ok' ? <Cloud size={13} className="text-ok" /> : save.cloud === 'error' ? <CloudOff size={13} className="text-warn" /> : <Check size={13} className="text-ok" />}
      {save.cloud === 'ok' ? 'Saved to cloud' : save.cloud === 'error' ? 'Saved locally (cloud failed)' : 'Saved in this browser'}
    </span>
  );
}
