import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import { buildFromTemplate, TEMPLATES } from '../src/lib/design/templates';

let mf: Miniflare;
const base = 'http://localhost/api';
const keyA = 'A'.repeat(20) + '_ownerA_' + 'x'.repeat(20);
const keyB = 'B'.repeat(20) + '_ownerB_' + 'y'.repeat(20);
const design = buildFromTemplate(TEMPLATES[0], { width: 1080, height: 1920, metrics: ['distance'], units: 'metric' });

async function api(path: string, init: RequestInit & { key?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.key) headers.set('authorization', `Bearer ${init.key}`);
  const res = await mf.dispatchFetch(base + path, { ...init, headers } as never);
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* binary */
  }
  return { status: res.status, body, headers: res.headers };
}

beforeAll(async () => {
  const out = await build({ entryPoints: ['worker/index.ts'], bundle: true, format: 'esm', write: false, platform: 'neutral', target: 'es2022', mainFields: ['module', 'main'] });
  mf = new Miniflare({
    modules: true,
    script: out.outputFiles[0].text,
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    r2Buckets: ['MEDIA'],
    bindings: { MAX_UPLOAD_BYTES: '2000000' },
  });
  const db = await mf.getD1Database('DB');
  const sql = readFileSync('migrations/0001_init.sql', 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
}, 60_000);
afterAll(() => mf?.dispose());

describe('API', () => {
  it('health reports storage bindings', async () => {
    const r = await api('/health');
    expect(r.status).toBe(200);
    expect(r.body.storage).toEqual({ d1: true, r2: true });
  });

  it('requires a device key', async () => {
    expect((await api('/projects')).status).toBe(401);
    expect((await api('/projects', { key: 'short' })).status).toBe(401);
  });

  it('validates activity files by content', async () => {
    const gpx = readFileSync('tests/fixtures/straight-5k.gpx');
    const r = await api('/activities/validate', { method: 'POST', body: gpx });
    expect(r.body).toEqual({ valid: true, format: 'gpx' });
    const bad = await api('/activities/validate', { method: 'POST', body: 'hello' });
    expect(bad.body.valid).toBe(false);
  });

  it('creates, lists, reads, updates and deletes a project; activity track goes to R2', async () => {
    const id = 'proj_test_000001';
    const put = await api(`/projects/${id}`, {
      method: 'PUT',
      key: keyA,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'My run', design, templateId: 'minimal', activity: { id: 'act_test_000001', name: 'Run', summary: { distanceM: 5000 }, data: { points: [[1, 2]] } }, assetIds: [] }),
    });
    expect(put.status).toBe(200);
    const list = await api('/projects', { key: keyA });
    expect(list.body.projects).toHaveLength(1);
    expect(list.body.projects[0]).toMatchObject({ id, name: 'My run', activityName: 'Run', activitySummary: { distanceM: 5000 } });
    const got = await api(`/projects/${id}`, { key: keyA });
    expect(got.body.design).toEqual(design);
    expect(got.body.activity).toEqual({ points: [[1, 2]] });
    const r2 = await mf.getR2Bucket('MEDIA');
    expect((await r2.list()).objects.length).toBe(1);

    const renamed = await api(`/projects/${id}`, { method: 'PUT', key: keyA, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Renamed', design, assetIds: [] }) });
    expect(renamed.status).toBe(200);
    expect((await api(`/projects/${id}`, { key: keyA })).body.name).toBe('Renamed');
  });

  it('prevents access to another owner’s project', async () => {
    const id = 'proj_test_000001';
    expect((await api(`/projects/${id}`, { key: keyB })).status).toBe(404);
    expect((await api('/projects', { key: keyB })).body.projects).toHaveLength(0);
    const hijack = await api(`/projects/${id}`, { method: 'PUT', key: keyB, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'pwned', design, assetIds: [] }) });
    expect(hijack.status).toBe(404);
    expect((await api(`/projects/${id}`, { method: 'DELETE', key: keyB })).status).toBe(404);
    expect((await api(`/projects/${id}`, { key: keyA })).body.name).toBe('Renamed');
  });

  it('rejects invalid design documents', async () => {
    const r = await api('/projects/proj_test_000002', { method: 'PUT', key: keyA, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', design: { ...design, canvas: { width: -1 } } }) });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('validation_failed');
  });

  it('accepts real images, rejects disguised files, scopes media by owner', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 1, 2, 3]);
    const ok = await api('/media/media_test_0001', { method: 'PUT', key: keyA, headers: { 'x-file-name': 'photo.png', 'content-type': 'image/png' }, body: png });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ kind: 'image', mime: 'image/png' });
    const fake = await api('/media/media_test_0002', { method: 'PUT', key: keyA, headers: { 'content-type': 'image/png' }, body: '<script>alert(1)</script>' });
    expect(fake.status).toBe(415);
    const big = await api('/media/media_test_0003', { method: 'PUT', key: keyA, body: new Uint8Array(2_100_000) });
    expect(big.status).toBe(413);
    expect((await api('/media/media_test_0001', { key: keyB })).status).toBe(404);
    const dl = await api('/media/media_test_0001', { key: keyA });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('image/png');
    expect(dl.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await api('/media/media_test_0001', { method: 'DELETE', key: keyA })).status).toBe(200);
  });

  it('stores personal templates per owner', async () => {
    const put = await api('/templates/tmpl_test_0001', { method: 'PUT', key: keyA, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Mine', design }) });
    expect(put.status).toBe(200);
    expect((await api('/templates', { key: keyA })).body.templates).toHaveLength(1);
    expect((await api('/templates', { key: keyB })).body.templates).toHaveLength(0);
    expect((await api('/templates/tmpl_test_0001', { method: 'DELETE', key: keyB })).status).toBe(404);
  });

  it('deleting a project removes its orphaned activity track', async () => {
    expect((await api('/projects/proj_test_000001', { method: 'DELETE', key: keyA })).status).toBe(200);
    const r2 = await mf.getR2Bucket('MEDIA');
    expect((await r2.list({ prefix: '' })).objects.filter((o) => o.key.includes('/activities/'))).toHaveLength(0);
    expect((await api('/projects/proj_test_000001', { key: keyA })).status).toBe(404);
  });

  it('unknown routes and wrong methods', async () => {
    expect((await api('/nope')).status).toBe(404);
    expect((await api('/health', { method: 'POST' })).status).toBe(405);
  });
});
