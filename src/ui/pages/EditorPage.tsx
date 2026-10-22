import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { loadProject } from '../../lib/projects/service';
import { useEditor } from '../editor/store';
import { Toolbar } from '../editor/Toolbar';
import { Stage } from '../editor/Stage';
import { LeftPanel } from '../editor/LeftPanel';
import { PropertiesPanel } from '../editor/PropertiesPanel';
import { Timeline } from '../editor/Timeline';
import { ExportDialog } from '../editor/ExportDialog';
import { useShortcuts } from '../editor/shortcuts';

export function EditorPage() {
  const { id } = useParams();
  const project = useEditor((s) => s.project);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'left' | 'props' | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadProject(id!)
      .then((p) => {
        if (cancelled) return;
        if (!p) setError('Project not found in this browser' + (localStorage.getItem('rss.cloudSync') ? ' or in cloud storage.' : '. If it was created on another device, enable cloud sync on the Projects page.'));
        else useEditor.getState().load(p);
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
      const s = useEditor.getState();
      if (s.save.status === 'dirty') void s.saveNow();
      s.unload();
    };
  }, [id]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      const st = useEditor.getState().save.status;
      if (st === 'dirty' || st === 'saving') {
        void useEditor.getState().saveNow();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  useShortcuts();

  if (error)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-ink-300">{error}</p>
        <Link to="/projects" className="btn">
          Back to projects
        </Link>
      </div>
    );
  if (!project || project.id !== id)
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="animate-spin text-brand" />
      </div>
    );

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="editor">
      <Toolbar onExport={() => setExportOpen(true)} />
      <div className="relative flex min-h-0 flex-1">
        <aside className={`${mobilePanel === 'left' ? 'absolute inset-y-0 left-0 z-30 flex shadow-2xl' : 'hidden'} w-[300px] shrink-0 border-r border-ink-800 bg-ink-900 lg:static lg:flex`}>
          <LeftPanel onClose={() => setMobilePanel(null)} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <Stage />
          <Timeline />
        </div>
        <aside className={`${mobilePanel === 'props' ? 'absolute inset-y-0 right-0 z-30 block shadow-2xl' : 'hidden'} w-[300px] shrink-0 overflow-y-auto border-l border-ink-800 bg-ink-900 lg:static lg:block`}>
          <PropertiesPanel />
        </aside>
      </div>
      <nav className="flex border-t border-ink-800 bg-ink-900 lg:hidden">
        <button className={`flex-1 py-3 text-sm ${mobilePanel === 'left' ? 'text-brand' : ''}`} onClick={() => setMobilePanel(mobilePanel === 'left' ? null : 'left')}>
          Design
        </button>
        <button className={`flex-1 py-3 text-sm ${mobilePanel === 'props' ? 'text-brand' : ''}`} onClick={() => setMobilePanel(mobilePanel === 'props' ? null : 'props')}>
          Edit
        </button>
        <button className="flex-1 py-3 text-sm text-brand" onClick={() => setExportOpen(true)}>
          Export
        </button>
      </nav>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </div>
  );
}
