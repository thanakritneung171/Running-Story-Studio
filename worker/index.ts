import { ZodError } from 'zod';
import { ProjectWriteSchema, TemplateWriteSchema, ID_RE } from '../shared/api';
import { DESIGN_SCHEMA_VERSION, migrateDesign } from '../shared/design';
import { sniffMedia } from '../shared/sniff';
import { ownerFromRequest } from './auth';

export interface Env {
  DB?: D1Database;
  MEDIA?: R2Bucket;
  ASSETS?: Fetcher;
  MAX_UPLOAD_BYTES?: string;
}

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS } });
const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status);

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_TRACK_BYTES = 20 * 1024 * 1024;

async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > MAX_JSON_BYTES + MAX_TRACK_BYTES) throw new HttpError(413, 'too_large', 'Request body is too large.');
  if (!(req.headers.get('content-type') ?? '').includes('application/json'))
    throw new HttpError(415, 'unsupported_media_type', 'Expected application/json.');
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON.');
  }
}

/** Read a request body, aborting as soon as it exceeds `max` bytes. */
async function readLimited(req: Request, max: number): Promise<Uint8Array> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new HttpError(413, 'too_large', `Uploads are limited to ${Math.floor(max / 1048576)} MB.`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function requireBindings(env: Env): { DB: D1Database; MEDIA: R2Bucket } {
  if (!env.DB || !env.MEDIA)
    throw new HttpError(503, 'storage_not_configured', 'Cloud storage (D1/R2) is not configured for this deployment.');
  return { DB: env.DB, MEDIA: env.MEDIA };
}

function checkId(id: string) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'invalid_id', 'Invalid identifier.');
  return id;
}

type Handler = (req: Request, env: Env, params: Record<string, string>, owner: string) => Promise<Response>;
const routes: { method: string; pattern: URLPattern; auth: boolean; handler: Handler }[] = [];
const route = (method: string, path: string, handler: Handler, auth = true) =>
  routes.push({ method, pattern: new URLPattern({ pathname: path }), auth, handler });

// ---------- health ----------
route(
  'GET',
  '/api/health',
  async (_req, env) => json({ ok: true, storage: { d1: !!env.DB, r2: !!env.MEDIA }, schemaVersion: DESIGN_SCHEMA_VERSION }),
  false,
);

// ---------- activity validation (format sniffing only; parsing happens in the browser) ----------
route(
  'POST',
  '/api/activities/validate',
  async (req) => {
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.length === 0) throw new HttpError(400, 'empty', 'Empty file.');
    if (buf.length > 50 * 1024 * 1024) throw new HttpError(413, 'too_large', 'Activity files are limited to 50 MB.');
    const head = new TextDecoder().decode(buf.subarray(0, 4096)).replace(/^﻿/, '').trimStart();
    let format: string | null = null;
    if (buf.length >= 12 && String.fromCharCode(...buf.subarray(8, 12)) === '.FIT') format = 'fit';
    else if (/<gpx[\s>]/i.test(head)) format = 'gpx';
    else if (/<TrainingCenterDatabase[\s>]/i.test(head)) format = 'tcx';
    return json({ valid: format !== null, format });
  },
  false,
);

// ---------- projects ----------
route('GET', '/api/projects', async (_req, env, _p, owner) => {
  const { DB } = requireBindings(env);
  const rows = await DB.prepare(
    `SELECT p.id, p.name, p.template_id, p.schema_version, p.created_at, p.updated_at, a.name AS activity_name, a.summary_json
       FROM projects p LEFT JOIN activities a ON a.id = p.activity_id AND a.owner_id = p.owner_id
      WHERE p.owner_id = ? ORDER BY p.updated_at DESC LIMIT 200`,
  )
    .bind(owner)
    .all();
  return json({
    projects: rows.results.map((r) => ({
      id: r.id,
      name: r.name,
      templateId: r.template_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      activityName: r.activity_name ?? null,
      activitySummary: r.summary_json ? JSON.parse(String(r.summary_json)) : null,
    })),
  });
});

route('GET', '/api/projects/:id', async (_req, env, p, owner) => {
  const { DB, MEDIA } = requireBindings(env);
  const id = checkId(p.id);
  const row = await DB.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?').bind(id, owner).first();
  if (!row) throw new HttpError(404, 'not_found', 'Project not found.');
  let activity: unknown = null;
  if (row.activity_id) {
    const a = await DB.prepare('SELECT track_key FROM activities WHERE id = ? AND owner_id = ?').bind(row.activity_id, owner).first();
    if (a?.track_key) {
      const obj = await MEDIA.get(String(a.track_key));
      if (obj) activity = await obj.json();
    }
  }
  return json({
    id: row.id,
    name: row.name,
    templateId: row.template_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    design: migrateDesign(JSON.parse(String(row.design_json))),
    assetIds: JSON.parse(String(row.asset_ids_json)),
    activity,
  });
});

route('PUT', '/api/projects/:id', async (req, env, p, owner) => {
  const { DB, MEDIA } = requireBindings(env);
  const id = checkId(p.id);
  const body = ProjectWriteSchema.parse(await readJson(req));
  const designJson = JSON.stringify(body.design);
  if (designJson.length > MAX_JSON_BYTES) throw new HttpError(413, 'too_large', 'Design document is too large.');
  const existing = await DB.prepare('SELECT owner_id, created_at FROM projects WHERE id = ?').bind(id).first();
  if (existing && existing.owner_id !== owner) throw new HttpError(404, 'not_found', 'Project not found.');
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  let activityId: string | null = null;
  if (body.activity) {
    activityId = body.activity.id;
    const act = await DB.prepare('SELECT owner_id FROM activities WHERE id = ?').bind(activityId).first();
    if (act && act.owner_id !== owner) throw new HttpError(409, 'conflict', 'Activity id is already in use.');
    const trackKey = `${owner}/activities/${activityId}.json`;
    const trackJson = JSON.stringify(body.activity.data ?? null);
    if (trackJson.length > MAX_TRACK_BYTES) throw new HttpError(413, 'too_large', 'Activity data is too large.');
    await MEDIA.put(trackKey, trackJson, { httpMetadata: { contentType: 'application/json' } });
    stmts.push(
      DB.prepare(
        `INSERT INTO activities (id, owner_id, name, summary_json, track_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, summary_json = excluded.summary_json, updated_at = excluded.updated_at`,
      ).bind(activityId, owner, body.activity.name, JSON.stringify(body.activity.summary), trackKey, now, now),
    );
  }
  stmts.push(
    DB.prepare(
      `INSERT INTO projects (id, owner_id, name, schema_version, design_json, template_id, activity_id, asset_ids_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, schema_version = excluded.schema_version, design_json = excluded.design_json,
         template_id = excluded.template_id, activity_id = CASE WHEN ? THEN projects.activity_id ELSE excluded.activity_id END, asset_ids_json = excluded.asset_ids_json,
         updated_at = excluded.updated_at
       WHERE projects.owner_id = excluded.owner_id`,
    ).bind(id, owner, body.name, DESIGN_SCHEMA_VERSION, designJson, body.templateId ?? null, activityId, JSON.stringify(body.assetIds), now, now, body.activity === undefined ? 1 : 0),
  );
  await DB.batch(stmts);
  return json({ id, updatedAt: now, createdAt: existing?.created_at ?? now });
});

route('DELETE', '/api/projects/:id', async (_req, env, p, owner) => {
  const { DB, MEDIA } = requireBindings(env);
  const id = checkId(p.id);
  const row = await DB.prepare('SELECT activity_id FROM projects WHERE id = ? AND owner_id = ?').bind(id, owner).first();
  if (!row) throw new HttpError(404, 'not_found', 'Project not found.');
  await DB.prepare('DELETE FROM projects WHERE id = ? AND owner_id = ?').bind(id, owner).run();
  if (row.activity_id) {
    const still = await DB.prepare('SELECT 1 FROM projects WHERE activity_id = ? AND owner_id = ? LIMIT 1').bind(row.activity_id, owner).first();
    if (!still) {
      await MEDIA.delete(`${owner}/activities/${row.activity_id}.json`);
      await DB.prepare('DELETE FROM activities WHERE id = ? AND owner_id = ?').bind(row.activity_id, owner).run();
    }
  }
  return json({ deleted: true });
});

// ---------- personal templates ----------
route('GET', '/api/templates', async (_req, env, _p, owner) => {
  const { DB } = requireBindings(env);
  const rows = await DB.prepare('SELECT id, name, design_json, created_at, updated_at FROM templates WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 200')
    .bind(owner)
    .all();
  return json({
    templates: rows.results.map((r) => ({
      id: r.id,
      name: r.name,
      design: migrateDesign(JSON.parse(String(r.design_json))),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
});
route('PUT', '/api/templates/:id', async (req, env, p, owner) => {
  const { DB } = requireBindings(env);
  const id = checkId(p.id);
  const body = TemplateWriteSchema.parse(await readJson(req));
  const existing = await DB.prepare('SELECT owner_id FROM templates WHERE id = ?').bind(id).first();
  if (existing && existing.owner_id !== owner) throw new HttpError(404, 'not_found', 'Template not found.');
  const now = Date.now();
  await DB.prepare(
    `INSERT INTO templates (id, owner_id, name, schema_version, design_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, design_json = excluded.design_json, schema_version = excluded.schema_version, updated_at = excluded.updated_at
     WHERE templates.owner_id = excluded.owner_id`,
  )
    .bind(id, owner, body.name, DESIGN_SCHEMA_VERSION, JSON.stringify(body.design), now, now)
    .run();
  return json({ id, updatedAt: now });
});
route('DELETE', '/api/templates/:id', async (_req, env, p, owner) => {
  const { DB } = requireBindings(env);
  const r = await DB.prepare('DELETE FROM templates WHERE id = ? AND owner_id = ?').bind(checkId(p.id), owner).run();
  if (!r.meta.changes) throw new HttpError(404, 'not_found', 'Template not found.');
  return json({ deleted: true });
});

// ---------- media (uploads are proxied through the Worker so content can be validated) ----------
route('PUT', '/api/media/:id', async (req, env, p, owner) => {
  const { DB, MEDIA } = requireBindings(env);
  const id = checkId(p.id);
  const max = Number(env.MAX_UPLOAD_BYTES ?? 94371840);
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > max) throw new HttpError(413, 'too_large', `Uploads are limited to ${Math.floor(max / 1048576)} MB.`);
  const existing = await DB.prepare('SELECT owner_id FROM media WHERE id = ?').bind(id).first();
  if (existing && existing.owner_id !== owner) throw new HttpError(409, 'conflict', 'Media id is already in use.');
  const buf = await readLimited(req, max);
  const sniffed = sniffMedia(buf);
  if (!sniffed) throw new HttpError(415, 'unsupported_media', 'Only JPEG, PNG, WebP, AVIF images and MP4, MOV, WebM videos are accepted.');
  const isExport = req.headers.get('x-media-kind') === 'export';
  const rawName = req.headers.get('x-file-name') ?? 'upload';
  const name = decodeURIComponent(rawName).replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'upload';
  const key = `${owner}/media/${id}`;
  await MEDIA.put(key, buf, { httpMetadata: { contentType: sniffed.mime } });
  await DB.prepare(
    `INSERT INTO media (id, owner_id, kind, mime, size, name, r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET mime = excluded.mime, size = excluded.size, name = excluded.name WHERE media.owner_id = excluded.owner_id`,
  )
    .bind(id, owner, isExport ? 'export' : sniffed.kind, sniffed.mime, buf.length, name, key, Date.now())
    .run();
  return json({ id, kind: isExport ? 'export' : sniffed.kind, mime: sniffed.mime, size: buf.length });
});

route('GET', '/api/media/:id', async (_req, env, p, owner) => {
  const { DB, MEDIA } = requireBindings(env);
  const row = await DB.prepare('SELECT r2_key, mime, name FROM media WHERE id = ? AND owner_id = ?').bind(checkId(p.id), owner).first();
  if (!row) throw new HttpError(404, 'not_found', 'Media not found.');
  const obj = await MEDIA.get(String(row.r2_key));
  if (!obj) throw new HttpError(404, 'not_found', 'Media content is missing.');
  return new Response(obj.body, {
    headers: {
      'content-type': String(row.mime),
      'content-disposition': `attachment; filename="${String(row.name).replace(/"/g, '')}"`,
      'content-security-policy': "default-src 'none'; sandbox",
      ...SECURITY_HEADERS,
      'cache-control': 'private, max-age=0',
    },
  });
});

route('DELETE', '/api/media/:id', async (_req, env, p, owner) => {
  const { DB, MEDIA } = requireBindings(env);
  const id = checkId(p.id);
  const row = await DB.prepare('SELECT r2_key FROM media WHERE id = ? AND owner_id = ?').bind(id, owner).first();
  if (!row) throw new HttpError(404, 'not_found', 'Media not found.');
  await MEDIA.delete(String(row.r2_key));
  await DB.prepare('DELETE FROM media WHERE id = ? AND owner_id = ?').bind(id, owner).run();
  return json({ deleted: true });
});

export async function handleApi(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  let methodMismatch = false;
  for (const r of routes) {
    const m = r.pattern.exec({ pathname: url.pathname });
    if (!m) continue;
    if (r.method !== req.method) {
      methodMismatch = true;
      continue;
    }
    try {
      let owner = '';
      if (r.auth) {
        const o = await ownerFromRequest(req);
        if (!o) return fail(401, 'unauthorized', 'A valid device key is required (Authorization: Bearer <key>).');
        owner = o;
      }
      return await r.handler(req, env, (m.pathname.groups ?? {}) as Record<string, string>, owner);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.code, e.message);
      if (e instanceof ZodError)
        return fail(400, 'validation_failed', e.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      console.error('api_error', req.method, url.pathname, (e as Error).message);
      return fail(500, 'internal_error', 'Unexpected server error.');
    }
  }
  return methodMismatch ? fail(405, 'method_not_allowed', 'Method not allowed.') : fail(404, 'not_found', 'Unknown API route.');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return handleApi(req, env);
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
