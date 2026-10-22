import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Cloud, Copy, HardDrive, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { AppHeader } from '../components/AppHeader';
import { deleteProject, deleteTemplate, duplicateProject, listProjects, listTemplates, renameProject, saveTemplate } from '../../lib/projects/service';
import type { PersonalTemplate, ProjectSummary } from '../../lib/projects/types';
import { CloudSettings } from '../components/CloudSettings';
import { DocCanvas } from '../components/DocCanvas';

export function ProjectCard({ p, onChanged }: { p: ProjectSummary; onChanged?: () => void }) {
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const thumb = useMemo(() => (p.thumbnail ? URL.createObjectURL(p.thumbnail) : null), [p.thumbnail]);
  useEffect(() => () => void (thumb && URL.revokeObjectURL(thumb)), [thumb]);
  const act = async (fn: () => Promise<unknown>) => {
    setMenu(false);
    try {
      await fn();
    } catch (e) {
      alert((e as Error).message);
    }
    onChanged?.();
  };
  return (
    <div className="group relative" data-testid="project-card">
      <Link to={`/editor/${p.id}`} className="block overflow-hidden rounded-xl border border-ink-800 bg-ink-900 transition hover:border-ink-600">
        <div className="checker aspect-[9/16] w-full">
          {thumb ? <img src={thumb} alt="" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center bg-ink-850 text-xs text-ink-400">No preview</div>}
        </div>
        <div className="p-3">
          <div className="truncate text-sm font-medium">{p.name}</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-ink-400">
            {p.location === 'local' ? <HardDrive size={12} aria-label="Stored in this browser" /> : <Cloud size={12} aria-label="Synced to cloud" />}
            {p.distanceM ? `${(p.distanceM / 1000).toFixed(2)} km · ` : ''}
            {new Date(p.updatedAt).toLocaleDateString()}
          </div>
        </div>
      </Link>
      {onChanged && (
        <div className="absolute top-2 right-2">
          <button className="btn btn-icon bg-ink-900/90" aria-label="Project actions" onClick={() => setMenu((m) => !m)}>
            <MoreHorizontal size={16} />
          </button>
          {menu && (
            <div className="panel absolute right-0 z-10 mt-1 w-40 overflow-hidden py-1 text-sm shadow-xl">
              <button className="flex w-full items-center gap-2 px-3 py-2 hover:bg-ink-800" onClick={() => nav(`/editor/${p.id}`)}>
                Open
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 hover:bg-ink-800"
                onClick={() => {
                  const name = prompt('Rename project', p.name);
                  if (name?.trim()) void act(() => renameProject(p.id, name.trim()));
                }}
              >
                <Pencil size={14} /> Rename
              </button>
              <button className="flex w-full items-center gap-2 px-3 py-2 hover:bg-ink-800" onClick={() => act(() => duplicateProject(p.id))}>
                <Copy size={14} /> Duplicate
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-bad hover:bg-ink-800"
                onClick={() => {
                  if (confirm(`Delete “${p.name}”? This removes it from this browser${p.location !== 'local' ? ' and from cloud storage' : ''}.`))
                    void act(async () => {
                      const r = await deleteProject(p.id);
                      if (r.cloudError) alert(`Deleted locally, but cloud deletion failed: ${r.cloudError}`);
                    });
                }}
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Projects() {
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [templates, setTemplates] = useState<PersonalTemplate[]>([]);
  const [cloudError, setCloudError] = useState<string>();
  const refresh = useCallback(() => {
    listProjects()
      .then((r) => {
        setItems(r.items);
        setCloudError(r.cloudError);
      })
      .catch((e) => setCloudError((e as Error).message));
    listTemplates().then(setTemplates).catch(() => undefined);
  }, []);
  useEffect(refresh, [refresh]);

  return (
    <div className="min-h-full">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Projects</h1>
            <p className="mt-1 text-sm text-ink-400">Projects are saved in this browser automatically. Turn on cloud sync below to keep them across devices.</p>
          </div>
          <Link to="/new" className="btn btn-primary">
            New story
          </Link>
        </div>
        {cloudError && <p className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">Cloud: {cloudError}</p>}
        {items === null ? (
          <p className="text-ink-400">Loading…</p>
        ) : items.length === 0 ? (
          <div className="panel p-10 text-center">
            <p className="text-ink-300">No projects yet.</p>
            <Link to="/new" className="btn btn-primary mt-4">
              Import your first run
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {items.map((p) => (
              <ProjectCard key={p.id} p={p} onChanged={refresh} />
            ))}
          </div>
        )}

        <h2 className="mt-14 mb-4 text-xl font-semibold">My templates</h2>
        {templates.length === 0 ? (
          <p className="text-sm text-ink-400">Save any design as a template from the editor (Templates → Save current as template).</p>
        ) : (
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-5 lg:grid-cols-7">
            {templates.map((t) => (
              <div key={t.id} className="text-sm">
                <div className="overflow-hidden rounded-lg border border-ink-800">
                  <DocCanvas doc={t.design} activity={null} metrics={null} width={140} />
                </div>
                <div className="mt-1 flex items-center justify-between gap-1">
                  <span className="truncate">{t.name}</span>
                  <span className="flex">
                    <button
                      className="btn btn-ghost btn-icon h-6 w-6"
                      aria-label="Rename template"
                      onClick={async () => {
                        const name = prompt('Rename template', t.name);
                        if (name?.trim()) {
                          await saveTemplate({ ...t, name: name.trim() });
                          refresh();
                        }
                      }}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      className="btn btn-ghost btn-icon h-6 w-6 text-bad"
                      aria-label="Delete template"
                      onClick={async () => {
                        if (confirm(`Delete template “${t.name}”?`)) {
                          await deleteTemplate(t.id);
                          refresh();
                        }
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <h2 className="mt-14 mb-4 text-xl font-semibold">Storage & privacy</h2>
        <CloudSettings onChange={refresh} />
      </main>
    </div>
  );
}
