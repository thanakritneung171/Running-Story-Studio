import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';

enablePatches();

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  /** Consecutive commands with the same key (e.g. one drag, one slider) merge into one entry. */
  key?: string;
  at: number;
}

export interface History<T extends object> {
  present: T;
  past: HistoryEntry[];
  future: HistoryEntry[];
}

const MAX_HISTORY = 200;
const COALESCE_MS = 1000;

export function createHistory<T extends object>(present: T): History<T> {
  return { present, past: [], future: [] };
}

/** Apply a command. Returns the same history object when nothing changed. */
export function execute<T extends object>(h: History<T>, label: string, recipe: (d: Draft<T>) => void, key?: string, now = Date.now()): History<T> {
  const [next, patches, inverse] = produceWithPatches(h.present, recipe);
  if (patches.length === 0) return h;
  const last = h.past[h.past.length - 1];
  if (key && last && last.key === key && now - last.at < COALESCE_MS) {
    const merged: HistoryEntry = { label: last.label, key, at: now, patches: [...last.patches, ...patches], inverse: [...inverse, ...last.inverse] };
    return { present: next, past: [...h.past.slice(0, -1), merged], future: [] };
  }
  const past = [...h.past, { label, patches, inverse, key, at: now }];
  if (past.length > MAX_HISTORY) past.shift();
  return { present: next, past, future: [] };
}

export function undo<T extends object>(h: History<T>): History<T> {
  const e = h.past[h.past.length - 1];
  if (!e) return h;
  return { present: applyPatches(h.present, e.inverse) as T, past: h.past.slice(0, -1), future: [e, ...h.future] };
}

export function redo<T extends object>(h: History<T>): History<T> {
  const e = h.future[0];
  if (!e) return h;
  return { present: applyPatches(h.present, e.patches) as T, past: [...h.past, { ...e, at: 0 }], future: h.future.slice(1) };
}

/** End coalescing so the next command starts a new entry (e.g. on pointerup). */
export function seal<T extends object>(h: History<T>): History<T> {
  const last = h.past[h.past.length - 1];
  if (!last || !last.key) return h;
  return { ...h, past: [...h.past.slice(0, -1), { ...last, key: undefined }] };
}
