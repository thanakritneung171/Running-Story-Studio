import { describe, expect, it } from 'vitest';
import { createHistory, execute, redo, seal, undo } from '../src/lib/editor/history';
import { cmd } from '../src/lib/editor/commands';
import { buildFromTemplate, TEMPLATES } from '../src/lib/design/templates';
import { hitTest, layerContains, resizeBox, snapMove } from '../src/lib/editor/geometry';
import { makeShape } from '../src/lib/design/factory';
import { migrateDesign, DesignDocumentSchema } from '../shared/design';

const doc = () => buildFromTemplate(TEMPLATES[0], { width: 1080, height: 1920, metrics: ['distance', 'movingTime', 'avgPace'], units: 'metric' });

describe('history', () => {
  it('moves a layer and undoes / redoes', () => {
    let h = createHistory(doc());
    const id = h.present.layers[1].id;
    const x0 = h.present.layers[1].x;
    h = execute(h, 'Move', cmd.move([id], 50, -20));
    expect(h.present.layers[1].x).toBe(x0 + 50);
    h = undo(h);
    expect(h.present.layers[1].x).toBe(x0);
    h = redo(h);
    expect(h.present.layers[1].x).toBe(x0 + 50);
  });
  it('coalesces a drag gesture into one undo step', () => {
    let h = createHistory(doc());
    const id = h.present.layers[1].id;
    const x0 = h.present.layers[1].x;
    for (let i = 1; i <= 10; i++) h = execute(h, 'Move', cmd.patchLayer(id, { x: x0 + i * 5 }), 'drag1', 1000 + i);
    expect(h.past).toHaveLength(1);
    h = seal(h);
    h = execute(h, 'Move', cmd.patchLayer(id, { x: 0 }), 'drag1', 1012);
    expect(h.past).toHaveLength(2);
    h = undo(undo(h));
    expect(h.present.layers[1].x).toBe(x0);
  });
  it('a no-op command does not create history', () => {
    const h = createHistory(doc());
    expect(execute(h, 'nothing', () => undefined)).toBe(h);
  });
  it('redo stack is cleared by a new command', () => {
    let h = createHistory(doc());
    const id = h.present.layers[0].id;
    h = execute(h, 'a', cmd.patchLayer(id, { opacity: 0.5 }));
    h = undo(h);
    expect(h.future).toHaveLength(1);
    h = execute(h, 'b', cmd.patchLayer(id, { opacity: 0.2 }));
    expect(h.future).toHaveLength(0);
  });
});

describe('layer commands', () => {
  it('reorders and z-orders layers', () => {
    let h = createHistory(doc());
    const ids = h.present.layers.map((l) => l.id);
    h = execute(h, 'front', cmd.zOrder([ids[0]], 'front'));
    expect(h.present.layers.at(-1)!.id).toBe(ids[0]);
    h = execute(h, 'back', cmd.zOrder([ids[0]], 'back'));
    expect(h.present.layers[0].id).toBe(ids[0]);
    h = execute(h, 'fwd', cmd.zOrder([ids[0]], 'forward'));
    expect(h.present.layers[1].id).toBe(ids[0]);
    h = execute(h, 'reorder', cmd.reorder(ids[0], 3));
    expect(h.present.layers[3].id).toBe(ids[0]);
  });
  it('duplicates and deletes', () => {
    let h = createHistory(doc());
    const id = h.present.layers[1].id;
    const n = h.present.layers.length;
    h = execute(h, 'dup', cmd.duplicate([id], ['copy_layer_1']));
    expect(h.present.layers).toHaveLength(n + 1);
    expect(h.present.layers[2].id).toBe('copy_layer_1');
    h = execute(h, 'del', cmd.remove(['copy_layer_1', id]));
    expect(h.present.layers).toHaveLength(n - 1);
  });
  it('locked layers do not move', () => {
    let h = createHistory(doc());
    const id = h.present.layers[1].id;
    h = execute(h, 'lock', cmd.patchLayer(id, { locked: true }));
    const x = h.present.layers[1].x;
    h = execute(h, 'move', cmd.move([id], 10, 10));
    expect(h.present.layers[1].x).toBe(x);
  });
  it('aligns to canvas', () => {
    let h = createHistory(doc());
    const id = h.present.layers[1].id;
    h = execute(h, 'align', cmd.align([id], 'hcenter', true));
    const l = h.present.layers[1];
    expect(l.x + l.width / 2).toBeCloseTo(540);
  });
  it('resizing the canvas scales the composition', () => {
    let h = createHistory(doc());
    h = execute(h, 'size', cmd.resizeCanvas(1080, 1080, true));
    expect(h.present.canvas.height).toBe(1080);
    for (const l of h.present.layers) expect(l.y + l.height).toBeLessThanOrEqual(1080 + 1);
  });
});

describe('geometry', () => {
  const box = makeShape({ x: 100, y: 100, width: 200, height: 100 });
  it('hit-tests rotated layers', () => {
    expect(layerContains(box, 110, 110)).toBe(true);
    expect(layerContains({ ...box, rotation: 90 }, 110, 110)).toBe(false);
    expect(layerContains({ ...box, rotation: 90 }, 200, 60)).toBe(true);
    expect(hitTest([box, { ...box, id: 'top' }], 150, 150)!.id).toBe('top');
    expect(hitTest([{ ...box, locked: true }], 150, 150)).toBeNull();
  });
  it('resizes from a handle keeping the opposite edge', () => {
    const r = resizeBox({ ...box }, 'e', 50, 0, false);
    expect(r).toMatchObject({ x: 100, y: 100, width: 250, height: 100 });
    const l = resizeBox({ ...box }, 'nw', -20, -10, false);
    expect(l).toMatchObject({ x: 80, y: 90, width: 220, height: 110 });
    const k = resizeBox({ ...box }, 'se', 200, 0, true);
    expect(k.width / k.height).toBeCloseTo(2);
  });
  it('snaps to canvas centre', () => {
    const s = snapMove({ x0: 437, y0: 0, x1: 637, y1: 100 }, [], 1080, 1920, 6);
    expect(s.dx).toBe(3);
    expect(s.guides).toContainEqual({ axis: 'x', pos: 540 });
  });
});

describe('design schema', () => {
  it('every template validates against the schema', () => {
    for (const t of TEMPLATES) {
      for (const size of [{ width: 1080, height: 1920 }, { width: 1080, height: 1080 }]) {
        const d = buildFromTemplate(t, { ...size, metrics: t.defaultMetrics, units: 'metric' });
        expect(() => DesignDocumentSchema.parse(d)).not.toThrow();
      }
    }
  });
  it('migrates unversioned documents', () => {
    const d = doc() as Record<string, unknown>;
    const { schemaVersion: _v, units: _u, timeline: _t, ...old } = d;
    const m = migrateDesign(old);
    expect(m.schemaVersion).toBe(1);
    expect(m.units).toBe('metric');
  });
  it('rejects documents from a newer version', () => {
    expect(() => migrateDesign({ ...doc(), schemaVersion: 99 })).toThrow(/newer/);
  });
});
