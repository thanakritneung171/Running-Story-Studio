import type { Draft } from 'immer';
import type { DesignDocument, Layer } from '../../../shared/design';
import { uid } from '../design/ids';

type D = Draft<DesignDocument>;
const find = (d: D, id: string) => d.layers.find((l) => l.id === id);

export const cmd = {
  patchLayer: (id: string, patch: Partial<Layer>) => (d: D) => {
    const l = find(d, id);
    if (l) Object.assign(l, patch);
  },
  /** Deep-merge a nested style object (valueStyle/labelStyle/style). */
  patchLayerPath: (id: string, path: string, patch: Record<string, unknown>) => (d: D) => {
    const l = find(d, id) as unknown as Record<string, Record<string, unknown>> | undefined;
    if (!l) return;
    l[path] = { ...(l[path] ?? {}), ...patch };
  },
  move: (ids: string[], dx: number, dy: number) => (d: D) => {
    for (const id of ids) {
      const l = find(d, id);
      if (l && !l.locked) {
        l.x += dx;
        l.y += dy;
      }
    }
  },
  addLayer: (layer: Layer, index?: number) => (d: D) => {
    if (index === undefined) d.layers.push(layer as Draft<Layer>);
    else d.layers.splice(index, 0, layer as Draft<Layer>);
  },
  remove: (ids: string[]) => (d: D) => {
    d.layers = d.layers.filter((l) => !ids.includes(l.id));
  },
  /** `newIds[k]` becomes the id of the copy of `ids[k]`. */
  duplicate: (ids: string[], newIds: string[], offset = 30) => (d: D) => {
    ids.forEach((id, k) => {
      const i = d.layers.findIndex((l) => l.id === id);
      if (i < 0) return;
      const copy = JSON.parse(JSON.stringify(d.layers[i])) as Layer;
      copy.id = newIds[k] ?? uid('l');
      copy.name = `${copy.name} copy`;
      copy.x += offset;
      copy.y += offset;
      copy.locked = false;
      d.layers.splice(i + 1, 0, copy as Draft<Layer>);
    });
  },
  /** Move a layer to a new index in the (bottom→top) layer array. */
  reorder: (id: string, toIndex: number) => (d: D) => {
    const from = d.layers.findIndex((l) => l.id === id);
    if (from < 0) return;
    const [l] = d.layers.splice(from, 1);
    d.layers.splice(Math.max(0, Math.min(d.layers.length, toIndex)), 0, l);
  },
  zOrder: (ids: string[], where: 'forward' | 'backward' | 'front' | 'back') => (d: D) => {
    const sel = new Set(ids);
    if (where === 'front' || where === 'back') {
      const picked = d.layers.filter((l) => sel.has(l.id));
      const rest = d.layers.filter((l) => !sel.has(l.id));
      d.layers = (where === 'front' ? [...rest, ...picked] : [...picked, ...rest]) as Draft<Layer>[];
      return;
    }
    const arr = d.layers;
    if (where === 'forward') {
      for (let i = arr.length - 2; i >= 0; i--)
        if (sel.has(arr[i].id) && !sel.has(arr[i + 1].id)) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
    } else {
      for (let i = 1; i < arr.length; i++)
        if (sel.has(arr[i].id) && !sel.has(arr[i - 1].id)) [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
    }
  },
  align: (ids: string[], how: 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom', toCanvas: boolean) => (d: D) => {
    const ls = d.layers.filter((l) => ids.includes(l.id) && !l.locked);
    if (!ls.length) return;
    const box = toCanvas || ls.length === 1
      ? { x0: 0, y0: 0, x1: d.canvas.width, y1: d.canvas.height }
      : {
          x0: Math.min(...ls.map((l) => l.x)),
          y0: Math.min(...ls.map((l) => l.y)),
          x1: Math.max(...ls.map((l) => l.x + l.width)),
          y1: Math.max(...ls.map((l) => l.y + l.height)),
        };
    for (const l of ls) {
      if (how === 'left') l.x = box.x0;
      if (how === 'right') l.x = box.x1 - l.width;
      if (how === 'hcenter') l.x = (box.x0 + box.x1) / 2 - l.width / 2;
      if (how === 'top') l.y = box.y0;
      if (how === 'bottom') l.y = box.y1 - l.height;
      if (how === 'vmiddle') l.y = (box.y0 + box.y1) / 2 - l.height / 2;
    }
  },
  /** Change canvas size, scaling layer geometry to keep the composition. */
  resizeCanvas: (w: number, h: number, scaleContent: boolean) => (d: D) => {
    const sx = w / d.canvas.width;
    const sy = h / d.canvas.height;
    if (scaleContent) {
      const s = Math.min(sx, sy);
      const ox = (w - d.canvas.width * s) / 2;
      const oy = (h - d.canvas.height * s) / 2;
      for (const l of d.layers) {
        if (l.isBackground) {
          l.x = l.x * sx;
          l.y = l.y * sy;
          l.width = l.width * sx;
          l.height = l.height * sy;
          continue;
        }
        l.x = ox + l.x * s;
        l.y = oy + l.y * s;
        l.width *= s;
        l.height *= s;
        scaleStyles(l as Layer, s);
      }
    }
    d.canvas.width = w;
    d.canvas.height = h;
  },
};

function scaleStyles(l: Layer, s: number) {
  const st = (x: { fontSize: number; letterSpacing: number; shadow?: { blur: number; x: number; y: number } }) => {
    x.fontSize *= s;
    x.letterSpacing *= s;
    if (x.shadow) {
      x.shadow.blur *= s;
      x.shadow.x *= s;
      x.shadow.y *= s;
    }
  };
  if (l.type === 'text') st(l.style);
  if (l.type === 'stat') {
    st(l.valueStyle);
    st(l.labelStyle);
  }
  if (l.type === 'route') {
    l.strokeWidth *= s;
    l.glow *= s;
    l.padding *= s;
  }
  if (l.type === 'shape') {
    l.strokeWidth *= s;
    l.radius *= s;
  }
  if (l.type === 'chart') l.strokeWidth *= s;
}
