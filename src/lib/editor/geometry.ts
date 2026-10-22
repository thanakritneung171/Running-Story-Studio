import type { Layer } from '../../../shared/design';

const rad = (d: number) => (d * Math.PI) / 180;

/** Is doc-space point (px, py) inside the (rotated) layer box? */
export function layerContains(l: Pick<Layer, 'x' | 'y' | 'width' | 'height' | 'rotation'>, px: number, py: number, pad = 0): boolean {
  const cx = l.x + l.width / 2;
  const cy = l.y + l.height / 2;
  const a = -rad(l.rotation);
  const dx = px - cx;
  const dy = py - cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= l.width / 2 + pad && Math.abs(ly) <= l.height / 2 + pad;
}

/** Topmost selectable layer under the point. */
export function hitTest(layers: Layer[], px: number, py: number, includeLocked = false): Layer | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (!l.visible || (!includeLocked && l.locked)) continue;
    if (layerContains(l, px, py)) return l;
  }
  return null;
}

/** Axis-aligned bounds of a rotated layer. */
export function aabb(l: Pick<Layer, 'x' | 'y' | 'width' | 'height' | 'rotation'>) {
  if (!l.rotation) return { x0: l.x, y0: l.y, x1: l.x + l.width, y1: l.y + l.height };
  const cx = l.x + l.width / 2;
  const cy = l.y + l.height / 2;
  const a = rad(l.rotation);
  const hw = (Math.abs(l.width * Math.cos(a)) + Math.abs(l.height * Math.sin(a))) / 2;
  const hh = (Math.abs(l.width * Math.sin(a)) + Math.abs(l.height * Math.cos(a))) / 2;
  return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Resize a rotated box by dragging `handle` by doc-space delta (dx, dy), keeping the opposite edge fixed. */
export function resizeBox(o: Box & { rotation: number }, handle: Handle, dx: number, dy: number, keepAspect: boolean, minSize = 8): Box {
  const a = rad(o.rotation);
  const lx = dx * Math.cos(a) + dy * Math.sin(a);
  const ly = -dx * Math.sin(a) + dy * Math.cos(a);
  const sx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const sy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  let w = Math.max(minSize, o.width + sx * lx);
  let h = Math.max(minSize, o.height + sy * ly);
  if (keepAspect && sx && sy) {
    const s = Math.max(w / o.width, h / o.height);
    w = Math.max(minSize, o.width * s);
    h = Math.max(minSize, o.height * s);
  }
  if (!sx) w = o.width;
  if (!sy) h = o.height;
  // Shift of the centre in local space, then back to doc space.
  const cdxL = (sx * (w - o.width)) / 2;
  const cdyL = (sy * (h - o.height)) / 2;
  const cdx = cdxL * Math.cos(a) - cdyL * Math.sin(a);
  const cdy = cdxL * Math.sin(a) + cdyL * Math.cos(a);
  const cx = o.x + o.width / 2 + cdx;
  const cy = o.y + o.height / 2 + cdy;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

export interface Guide {
  axis: 'x' | 'y';
  pos: number;
}

/**
 * Snap a moving box to canvas edges/centre and other layers' edges/centres.
 * Returns the adjustment to apply and the guides to display.
 */
export function snapMove(box: { x0: number; y0: number; x1: number; y1: number }, others: Layer[], cw: number, ch: number, threshold: number) {
  const xs = [0, cw / 2, cw];
  const ys = [0, ch / 2, ch];
  for (const l of others) {
    if (!l.visible) continue;
    const b = aabb(l);
    xs.push(b.x0, (b.x0 + b.x1) / 2, b.x1);
    ys.push(b.y0, (b.y0 + b.y1) / 2, b.y1);
  }
  const best = (vals: number[], targets: number[]) => {
    let bd = threshold + 1;
    let adj = 0;
    let at: number | null = null;
    for (const v of vals)
      for (const t of targets) {
        const d = Math.abs(t - v);
        if (d < bd) {
          bd = d;
          adj = t - v;
          at = t;
        }
      }
    return bd <= threshold ? { adj, at } : { adj: 0, at: null };
  };
  const bx = best([box.x0, (box.x0 + box.x1) / 2, box.x1], xs);
  const by = best([box.y0, (box.y0 + box.y1) / 2, box.y1], ys);
  const guides: Guide[] = [];
  if (bx.at !== null) guides.push({ axis: 'x', pos: bx.at });
  if (by.at !== null) guides.push({ axis: 'y', pos: by.at });
  return { dx: bx.adj, dy: by.adj, guides };
}
