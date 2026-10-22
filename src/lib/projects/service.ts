import { migrateDesign } from '../../../shared/design';
import type { Activity } from '../activity/types';
import { computeMetrics } from '../activity/metrics';
import { api, cloudAvailable, isCloudSyncEnabled } from '../cloud/client';
import { uid } from '../design/ids';
import { db } from './db';
import { getAssetBlob, putAsset } from '../media/store';
import { PROJECT_FORMAT_VERSION, type PersonalTemplate, type Project, type ProjectSummary } from './types';

export type SaveResult = { local: true; cloud: 'ok' | 'off' | 'error'; cloudError?: string; savedAt: number };

async function syncOn() {
  return isCloudSyncEnabled() && (await cloudAvailable());
}

/** Normalize anything loaded from storage (older versions, cloud payloads). */
function hydrate(p: Project): Project {
  return {
    ...p,
    formatVersion: PROJECT_FORMAT_VERSION,
    design: migrateDesign(p.design),
    selectedMetrics: p.selectedMetrics ?? [],
    assetIds: p.assetIds ?? [],
  };
}

export async function listProjects(): Promise<{ items: ProjectSummary[]; cloudError?: string }> {
  const d = await db();
  const local = await d.getAll('projects');
  const map = new Map<string, ProjectSummary>();
  for (const p of local) {
    map.set(p.id, {
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt,
      createdAt: p.createdAt,
      templateId: p.design.templateId,
      activityName: p.activity ? p.activity.overrides.name ?? p.activity.name : undefined,
      distanceM: p.activity ? computeMetrics(p.activity).distanceM : null,
      thumbnail: p.thumbnail,
      location: p.cloudSyncedAt ? 'both' : 'local',
    });
  }
  let cloudError: string | undefined;
  if (await syncOn()) {
    try {
      const r = await api<{ projects: { id: string; name: string; updatedAt: number; createdAt: number; templateId?: string; activityName?: string; activitySummary?: { distanceM?: number } }[] }>('/projects');
      for (const c of r.projects) {
        const have = map.get(c.id);
        if (have) have.location = 'both';
        else
          map.set(c.id, {
            id: c.id,
            name: c.name,
            updatedAt: c.updatedAt,
            createdAt: c.createdAt,
            templateId: c.templateId,
            activityName: c.activityName,
            distanceM: c.activitySummary?.distanceM ?? null,
            location: 'cloud',
          });
      }
    } catch (e) {
      cloudError = (e as Error).message;
    }
  }
  return { items: [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt), cloudError };
}

export async function loadProject(id: string): Promise<Project | null> {
  const d = await db();
  const local = await d.get('projects', id);
  if (local) {
    const { thumbnail: _t, ...rest } = local;
    return hydrate(rest);
  }
  if (!(await syncOn())) return null;
  const r = await api<{ id: string; name: string; createdAt: number; updatedAt: number; design: unknown; assetIds: string[]; activity: (Activity & { selectedMetrics?: string[] }) | null }>(`/projects/${id}`);
  // Pull missing media from the cloud into local storage.
  for (const aid of r.assetIds) {
    if (await getAssetBlob(aid)) continue;
    try {
      const blob = await api<Blob>(`/media/${aid}`);
      await putAsset(new File([blob], aid, { type: blob.type }), aid, true);
    } catch {
      /* missing media is shown as a placeholder */
    }
  }
  const p: Project = hydrate({
    formatVersion: PROJECT_FORMAT_VERSION,
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    design: r.design as Project['design'],
    activity: r.activity ? stripExtra(r.activity) : null,
    selectedMetrics: (r.activity?.selectedMetrics ?? []) as Project['selectedMetrics'],
    assetIds: r.assetIds,
    exportPrefs: { format: 'png', scale: 1, jpegQuality: 0.92, fps: 30, includeAudio: true },
    cloudSyncedAt: r.updatedAt,
  });
  await d.put('projects', p);
  return p;
}

function stripExtra(a: Activity & { selectedMetrics?: string[] }): Activity {
  const { selectedMetrics: _s, ...rest } = a;
  return rest;
}

export async function saveProject(p: Project, thumbnail?: Blob): Promise<SaveResult> {
  const d = await db();
  const savedAt = Date.now();
  const next = { ...p, updatedAt: savedAt };
  const prev = await d.get('projects', p.id);
  await d.put('projects', { ...next, thumbnail: thumbnail ?? prev?.thumbnail });
  if (!(await syncOn())) return { local: true, cloud: 'off', savedAt };
  try {
    await uploadMissingAssets(p.assetIds);
    const m = p.activity ? computeMetrics(p.activity) : null;
    await api(`/projects/${p.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: p.name,
        design: p.design,
        templateId: p.design.templateId ?? null,
        assetIds: p.assetIds,
        activity: p.activity
          ? {
              id: p.activity.id,
              name: p.activity.overrides.name ?? p.activity.name,
              summary: { distanceM: m?.distanceM ?? null, movingS: m?.movingS ?? null, startTime: p.activity.startTime ?? null },
              data: { ...p.activity, selectedMetrics: p.selectedMetrics },
            }
          : null,
      }),
    });
    await d.put('projects', { ...next, cloudSyncedAt: savedAt, thumbnail: thumbnail ?? prev?.thumbnail });
    return { local: true, cloud: 'ok', savedAt };
  } catch (e) {
    return { local: true, cloud: 'error', cloudError: (e as Error).message, savedAt };
  }
}

async function uploadMissingAssets(ids: string[]) {
  const d = await db();
  for (const id of ids) {
    const a = await d.get('media', id);
    if (!a || a.cloud) continue;
    await api(`/media/${id}`, { method: 'PUT', body: a.blob, headers: { 'x-file-name': encodeURIComponent(a.name), 'content-type': a.mime } });
    await d.put('media', { ...a, cloud: true });
  }
}

export async function deleteProject(id: string): Promise<{ cloudError?: string }> {
  const d = await db();
  const p = await d.get('projects', id);
  await d.delete('projects', id);
  // Remove media no other local project uses.
  if (p) {
    const others = await d.getAll('projects');
    const used = new Set(others.flatMap((o) => o.assetIds ?? []));
    for (const a of p.assetIds ?? []) if (!used.has(a)) await d.delete('media', a);
  }
  if (await syncOn()) {
    try {
      await api(`/projects/${id}`, { method: 'DELETE' });
      for (const a of p?.assetIds ?? []) await api(`/media/${a}`, { method: 'DELETE' }).catch(() => undefined);
    } catch (e) {
      if (!(e instanceof Error && 'status' in e && (e as { status: number }).status === 404)) return { cloudError: (e as Error).message };
    }
  }
  return {};
}

export async function duplicateProject(id: string): Promise<Project | null> {
  const p = await loadProject(id);
  if (!p) return null;
  const copy: Project = { ...structuredClone(p), id: uid('p'), name: `${p.name} (copy)`, createdAt: Date.now(), cloudSyncedAt: undefined };
  if (copy.activity) copy.activity.id = uid('a');
  await saveProject(copy);
  return copy;
}

export async function renameProject(id: string, name: string) {
  const p = await loadProject(id);
  if (!p) return;
  await saveProject({ ...p, name });
}

// ---------- personal templates ----------
export async function listTemplates(): Promise<PersonalTemplate[]> {
  const d = await db();
  const local = await d.getAll('templates');
  const map = new Map(local.map((t) => [t.id, { ...t, design: migrateDesign(t.design) }]));
  if (await syncOn()) {
    try {
      const r = await api<{ templates: PersonalTemplate[] }>('/templates');
      for (const t of r.templates) if (!map.has(t.id)) map.set(t.id, t);
    } catch {
      /* offline: local only */
    }
  }
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveTemplate(t: PersonalTemplate) {
  const d = await db();
  const next = { ...t, updatedAt: Date.now() };
  await d.put('templates', next);
  if (await syncOn()) await api(`/templates/${t.id}`, { method: 'PUT', body: JSON.stringify({ name: t.name, design: t.design }) }).catch(() => undefined);
  return next;
}

export async function deleteTemplate(id: string) {
  const d = await db();
  await d.delete('templates', id);
  if (await syncOn()) await api(`/templates/${id}`, { method: 'DELETE' }).catch(() => undefined);
}
