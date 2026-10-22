import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileUp, Layers, Download, ShieldCheck, Film, ImageDown } from 'lucide-react';
import { AppHeader } from '../components/AppHeader';
import { DocCanvas } from '../components/DocCanvas';
import { demoActivity } from '../../lib/activity/demo';
import { computeMetrics } from '../../lib/activity/metrics';
import { buildFromTemplate, chooseMetrics, getTemplate } from '../../lib/design/templates';
import { listProjects } from '../../lib/projects/service';
import type { ProjectSummary } from '../../lib/projects/types';
import { ProjectCard } from './Projects';

export function Landing() {
  const nav = useNavigate();
  const demo = useMemo(() => {
    const a = demoActivity();
    const m = computeMetrics(a);
    const docs = ['sporty', 'dark-performance', 'editorial'].map((id) => {
      const t = getTemplate(id)!;
      return buildFromTemplate(t, { width: 1080, height: 1920, metrics: chooseMetrics(null, t, m), units: 'metric' });
    });
    return { a, m, docs };
  }, []);
  const [recent, setRecent] = useState<ProjectSummary[]>([]);
  useEffect(() => {
    listProjects()
      .then((r) => setRecent(r.items.slice(0, 4)))
      .catch(() => undefined);
  }, []);

  return (
    <div className="min-h-full">
      <AppHeader />
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-14 pb-16 md:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="chip mb-5 border-brand/40 text-brand">GPX · TCX · FIT → PNG · MP4</p>
          <h1 className="font-display text-6xl leading-[0.95] tracking-wide md:text-8xl">
            Import your run.
            <br />
            Design your story.
            <br />
            <span className="text-brand">Share it.</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg text-ink-300">
            Turn workout files into Instagram-ready stories: accurate stats, your GPS route, your photos and videos — with a
            layer editor and real transparent PNG and MP4 export.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/new" className="btn btn-primary px-5 py-3 text-base">
              <FileUp size={18} /> Import an activity
            </Link>
            <button className="btn px-5 py-3 text-base" onClick={() => nav('/new?demo=1')}>
              Try with demo data
            </button>
          </div>
          <p className="mt-4 flex items-center gap-2 text-sm text-ink-400">
            <ShieldCheck size={16} /> Files are processed in your browser. Nothing is uploaded unless you turn on cloud sync.
          </p>
        </div>
        <div className="flex justify-center gap-3" aria-label="Animated template previews (demo data)">
          {demo.docs.map((d, i) => (
            <div key={i} className={`overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/10 ${i === 1 ? '-mt-8' : 'mt-8 hidden sm:block'}`}>
              <DocCanvas doc={d} activity={demo.a} metrics={demo.m} width={i === 1 ? 210 : 170} animate />
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-ink-800 bg-ink-900/50">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-12 md:grid-cols-4">
          {[
            { icon: FileUp, t: 'Import', d: 'GPX, TCX and FIT from Garmin, Strava, Coros, Apple Watch exports. Validated, parsed off the main thread.' },
            { icon: Layers, t: 'Design', d: 'Seven templates, then drag, resize, rotate and style every layer. Undo anything.' },
            { icon: ImageDown, t: 'Export images', d: '1080×1920 or square PNG/JPEG, plus transparent overlays with a verified alpha channel.' },
            { icon: Film, t: 'Export video', d: 'Animated route and stats over your clip, encoded to MP4 in the browser where supported.' },
          ].map(({ icon: I, t, d }) => (
            <div key={t}>
              <I className="text-brand" size={22} />
              <h3 className="mt-3 font-semibold">{t}</h3>
              <p className="mt-1 text-sm text-ink-400">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {recent.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-12">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Recent projects</h2>
            <Link to="/projects" className="text-sm text-ink-300 hover:text-white">
              All projects →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {recent.map((p) => (
              <ProjectCard key={p.id} p={p} />
            ))}
          </div>
        </section>
      )}
      <footer className="mx-auto flex max-w-6xl items-center justify-between px-4 py-10 text-xs text-ink-400">
        <span>Running Story Studio</span>
        <span className="flex items-center gap-1">
          <Download size={12} /> Exports stay on your device
        </span>
      </footer>
    </div>
  );
}
