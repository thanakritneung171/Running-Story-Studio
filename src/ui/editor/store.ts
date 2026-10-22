import { create } from 'zustand';
import type { Draft } from 'immer';
import type { DesignDocument, Layer } from '../../../shared/design';
import type { ActivityMetrics } from '../../lib/activity/types';
import { computeMetrics } from '../../lib/activity/metrics';
import { createHistory, execute, redo, seal, undo, type History } from '../../lib/editor/history';
import { cmd } from '../../lib/editor/commands';
import { uid } from '../../lib/design/ids';
import type { Project } from '../../lib/projects/types';
import { saveProject } from '../../lib/projects/service';
import { renderThumbnail } from '../../lib/export/image';
import { mediaRegistry } from '../../lib/media/registry';

export type SaveStatus =
  | { status: 'saved'; at: number; cloud: 'ok' | 'off' | 'error'; message?: string }
  | { status: 'dirty' }
  | { status: 'saving' }
  | { status: 'error'; message: string };

interface EditorState {
  project: Project | null;
  history: History<DesignDocument>;
  metrics: ActivityMetrics | null;
  selection: string[];
  zoom: number | 'fit';
  /** Timeline position in seconds; null = static (fully revealed) view. */
  time: number | null;
  playing: boolean;
  save: SaveStatus;
  clipboard: Layer[];
  load: (p: Project) => void;
  unload: () => void;
  run: (label: string, recipe: (d: Draft<DesignDocument>) => void, key?: string) => void;
  seal: () => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  setZoom: (z: number | 'fit') => void;
  setTime: (t: number | null) => void;
  setPlaying: (p: boolean) => void;
  updateProject: (patch: Partial<Project>) => void;
  addLayer: (l: Layer) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  copy: () => void;
  paste: () => void;
  saveNow: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
const AUTOSAVE_MS = 1200;

export const useEditor = create<EditorState>((set, get) => {
  const markDirty = () => {
    set({ save: { status: 'dirty' } });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().saveNow(), AUTOSAVE_MS);
  };
  return {
    project: null,
    history: createHistory({} as DesignDocument),
    metrics: null,
    selection: [],
    zoom: 'fit',
    time: null,
    playing: false,
    save: { status: 'saved', at: 0, cloud: 'off' },
    clipboard: [],

    load: (p) => {
      clearTimeout(saveTimer);
      set({
        project: p,
        history: createHistory(p.design),
        metrics: p.activity ? computeMetrics(p.activity) : null,
        selection: [],
        time: null,
        playing: false,
        zoom: 'fit',
        save: { status: 'saved', at: p.updatedAt, cloud: p.cloudSyncedAt ? 'ok' : 'off' },
      });
    },
    unload: () => {
      clearTimeout(saveTimer);
      mediaRegistry.releaseAll();
      set({ project: null, selection: [], playing: false });
    },
    run: (label, recipe, key) => {
      const h = execute(get().history, label, recipe, key);
      if (h === get().history) return;
      const ids = new Set(h.present.layers.map((l) => l.id));
      set({ history: h, selection: get().selection.filter((id) => ids.has(id)) });
      markDirty();
    },
    seal: () => set({ history: seal(get().history) }),
    undo: () => {
      const h = undo(get().history);
      if (h === get().history) return;
      const ids = new Set(h.present.layers.map((l) => l.id));
      set({ history: h, selection: get().selection.filter((id) => ids.has(id)) });
      markDirty();
    },
    redo: () => {
      const h = redo(get().history);
      if (h === get().history) return;
      set({ history: h });
      markDirty();
    },
    select: (ids) => set({ selection: ids }),
    toggleSelect: (id) => {
      const s = get().selection;
      set({ selection: s.includes(id) ? s.filter((x) => x !== id) : [...s, id] });
    },
    setZoom: (zoom) => set({ zoom }),
    setTime: (time) => set({ time }),
    setPlaying: (playing) => set({ playing }),
    updateProject: (patch) => {
      const p = get().project;
      if (!p) return;
      const next = { ...p, ...patch };
      set({ project: next, metrics: patch.activity !== undefined && next.activity ? computeMetrics(next.activity) : get().metrics });
      markDirty();
    },
    addLayer: (l) => {
      get().run(`Add ${l.name}`, cmd.addLayer(l));
      set({ selection: [l.id] });
    },
    deleteSelected: () => {
      const sel = get().selection;
      if (!sel.length) return;
      get().run('Delete', cmd.remove(sel));
      set({ selection: [] });
    },
    duplicateSelected: () => {
      const sel = get().selection;
      if (!sel.length) return;
      const newIds = sel.map(() => uid('l'));
      get().run('Duplicate', cmd.duplicate(sel, newIds));
      set({ selection: newIds });
    },
    copy: () => {
      const { selection, history } = get();
      set({ clipboard: history.present.layers.filter((l) => selection.includes(l.id)).map((l) => structuredClone(l)) });
    },
    paste: () => {
      const clip = get().clipboard;
      if (!clip.length) return;
      const copies = clip.map((l) => ({ ...structuredClone(l), id: uid('l'), x: l.x + 30, y: l.y + 30, locked: false }));
      get().run('Paste', (d) => {
        for (const c of copies) d.layers.push(c as Draft<Layer>);
      });
      set({ selection: copies.map((c) => c.id), clipboard: copies });
    },
    saveNow: async () => {
      clearTimeout(saveTimer);
      const { project, history, metrics } = get();
      if (!project) return;
      set({ save: { status: 'saving' } });
      const next: Project = { ...project, design: history.present };
      try {
        const thumb = await renderThumbnail(next.design, next.activity, metrics, mediaRegistry.frame).catch(() => undefined);
        const r = await saveProject(next, thumb);
        // Only mark saved if nothing changed while saving.
        if (get().history.present === next.design && get().project === project) {
          set({ project: { ...next, updatedAt: r.savedAt, cloudSyncedAt: r.cloud === 'ok' ? r.savedAt : next.cloudSyncedAt }, save: { status: 'saved', at: r.savedAt, cloud: r.cloud, message: r.cloudError } });
        } else {
          set({ project: { ...get().project!, updatedAt: r.savedAt } });
          if (get().save.status === 'saving') set({ save: { status: 'dirty' } });
        }
      } catch (e) {
        set({ save: { status: 'error', message: (e as Error).message } });
      }
    },
  };
});

export const useDoc = () => useEditor((s) => s.history.present);
