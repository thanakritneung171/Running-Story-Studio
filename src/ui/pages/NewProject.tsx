import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Check, FileUp, Loader2, MapPin } from 'lucide-react';
import { AppHeader } from '../components/AppHeader';
import { DocCanvas } from '../components/DocCanvas';
import type { Activity, MetricKey } from '../../lib/activity/types';
import { importActivityFile } from '../../lib/activity/import';
import { demoActivity } from '../../lib/activity/demo';
import { computeMetrics } from '../../lib/activity/metrics';
import { METRICS, formatDuration, formatMetric, formatPace, type Units } from '../../lib/activity/format';
import { STORY, SQUARE, TEMPLATES, buildFromTemplate, chooseMetrics } from '../../lib/design/templates';
import { makeRoute } from '../../lib/design/factory';
import { DESIGN_SCHEMA_VERSION, type DesignDocument } from '../../../shared/design';
import { uid } from '../../lib/design/ids';
import { listTemplates, saveProject } from '../../lib/projects/service';
import { DEFAULT_EXPORT_PREFS, PROJECT_FORMAT_VERSION, type PersonalTemplate, type Project } from '../../lib/projects/types';

type Step = 'import' | 'review' | 'design';

export function NewProject() {
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>('import');
  const [activity, setActivity] = useState<Activity | null>(null);
  const [units, setUnits] = useState<Units>('metric');

  const useDemo = useCallback(() => {
    setActivity(demoActivity());
    setStep('review');
  }, []);
  useEffect(() => {
    if (params.get('demo') === '1') useDemo();
  }, [params, useDemo]);

  return (
    <div className="min-h-full">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <ol className="mb-8 flex items-center gap-3 text-sm" aria-label="Steps">
          {(['import', 'review', 'design'] as Step[]).map((s, i) => (
            <li key={s} className={`flex items-center gap-2 ${step === s ? 'text-white' : 'text-ink-400'}`}>
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${step === s ? 'bg-brand text-white' : 'bg-ink-800'}`}>{i + 1}</span>
              {s === 'import' ? 'Import' : s === 'review' ? 'Review activity' : 'Choose a template'}
              {i < 2 && <span className="mx-1 text-ink-700">—</span>}
            </li>
          ))}
        </ol>
        {step === 'import' && (
          <ImportStep
            onDone={(a) => {
              setActivity(a);
              setStep('review');
            }}
            onDemo={useDemo}
          />
        )}
        {step === 'review' && activity && (
          <ReviewStep activity={activity} setActivity={setActivity} units={units} setUnits={setUnits} onBack={() => setStep('import')} onNext={() => setStep('design')} />
        )}
        {step === 'design' && activity && <DesignStep activity={activity} units={units} onBack={() => setStep('review')} />}
      </main>
    </div>
  );
}

function ImportStep({ onDone, onDemo }: { onDone: (a: Activity) => void; onDemo: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const handle = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const a = await importActivityFile(file, setBusy);
      onDone(a);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-semibold">Import your activity</h1>
      <p className="mt-2 text-ink-400">Export a GPX, TCX or FIT file from Garmin Connect, Strava, Coros, Suunto, Polar or your watch app.</p>
      <div
        role="button"
        tabIndex={0}
        aria-label="Choose or drop an activity file"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void handle(e.dataTransfer.files[0]);
        }}
        className={`mt-6 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-16 text-center transition ${drag ? 'border-brand bg-brand/5' : 'border-ink-700 hover:border-ink-600'}`}
      >
        {busy ? <Loader2 className="animate-spin text-brand" size={36} /> : <FileUp className="text-brand" size={36} />}
        <p className="mt-4 text-lg font-medium">{busy ?? 'Drop a file here or click to browse'}</p>
        <p className="mt-1 text-sm text-ink-400">.gpx · .tcx · .fit — up to 50 MB. Processed locally in your browser.</p>
        <input ref={input} type="file" accept=".gpx,.tcx,.fit,application/gpx+xml,application/vnd.garmin.tcx+xml" className="hidden" data-testid="activity-input" onChange={(e) => void handle(e.target.files?.[0])} />
      </div>
      {error && (
        <div role="alert" className="mt-4 flex gap-2 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-red-200">
          <AlertTriangle size={18} className="shrink-0 text-bad" />
          <span>{error}</span>
        </div>
      )}
      <div className="mt-6 text-center text-sm text-ink-400">
        No file handy?{' '}
        <button className="text-brand underline-offset-2 hover:underline" onClick={onDemo}>
          Use demo data
        </button>
      </div>
    </div>
  );
}

function ReviewStep({ activity, setActivity, units, setUnits, onBack, onNext }: { activity: Activity; setActivity: (a: Activity) => void; units: Units; setUnits: (u: Units) => void; onBack: () => void; onNext: () => void }) {
  const m = useMemo(() => computeMetrics(activity, units === 'metric' ? 1000 : 1609.344), [activity, units]);
  const routeDoc = useMemo<DesignDocument>(
    () => ({
      schemaVersion: DESIGN_SCHEMA_VERSION,
      units,
      canvas: { width: 800, height: 800, background: { type: 'solid', color: '#111318' } },
      timeline: { durationS: 4, fps: 30 },
      layers: [makeRoute({ x: 0, y: 0, width: 800, height: 800, padding: 50, strokeWidth: 9, showStartEnd: true, startColor: '#22c55e', endColor: '#ef4444', colorMode: 'pace' })],
    }),
    [units],
  );
  const setOverride = (k: keyof Activity['overrides'], v: string | number | undefined) =>
    setActivity({ ...activity, overrides: { ...activity.overrides, [k]: v === '' || (typeof v === 'number' && !Number.isFinite(v)) ? undefined : v } });
  const shown: MetricKey[] = ['distance', 'movingTime', 'elapsedTime', 'avgPace', 'bestPace', 'avgSpeed', 'maxSpeed', 'elevGain', 'elevLoss', 'maxEle', 'avgHr', 'maxHr', 'avgCadence', 'calories'];
  const distUnit = units === 'metric' ? 1000 : 1609.344;
  return (
    <div className="grid gap-8 lg:grid-cols-[400px_1fr]">
      <div>
        <div className="mx-auto max-w-[400px] overflow-hidden rounded-2xl border border-ink-800">
          <DocCanvas doc={routeDoc} activity={activity} metrics={m} width={400} className="!h-auto !w-full" />
        </div>
        <p className="mt-2 text-xs text-ink-400">Route coloured by pace: green = faster, red = slower.</p>
        {activity.isDemo && <p className="mt-3 chip border-warn/40 text-warn">Demonstration data — not a real activity</p>}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold">{activity.overrides.name ?? activity.name}</h1>
            <p className="mt-1 text-sm text-ink-400">
              {activity.startTime ? new Date(activity.startTime).toLocaleString() : 'No start time'} · {activity.source.format.toUpperCase()} · {activity.points.length.toLocaleString()} points · {activity.sport}
            </p>
          </div>
          <div className="flex rounded-lg border border-ink-700 p-0.5 text-sm" role="group" aria-label="Units">
            {(['metric', 'imperial'] as Units[]).map((u) => (
              <button key={u} onClick={() => setUnits(u)} className={`rounded-md px-3 py-1 ${units === u ? 'bg-ink-700' : 'text-ink-400'}`}>
                {u === 'metric' ? 'km' : 'mi'}
              </button>
            ))}
          </div>
        </div>
        {activity.warnings.length > 0 && (
          <ul className="mt-4 space-y-1 rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm text-amber-200">
            {activity.warnings.map((w, i) => (
              <li key={i} className="flex gap-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" /> {w}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" data-testid="stats-grid">
          {shown.map((k) => {
            const f = formatMetric(k, activity, m, units);
            const d = METRICS.find((x) => x.key === k)!;
            return (
              <div key={k} className="panel p-3" title={f.available ? undefined : m.availability[k].reason}>
                <div className="label">{d.label}</div>
                {f.available ? (
                  <div className="text-xl font-semibold tabular-nums">
                    {f.value} <span className="text-sm font-normal text-ink-400">{f.unit}</span>
                  </div>
                ) : (
                  <div className="text-sm text-ink-400">Not available<div className="text-xs">{m.availability[k].reason}</div></div>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink-400">
          Distance source: {m.distanceSource === 'device' ? 'recorded by device' : m.distanceSource === 'gps' ? 'calculated from GPS' : m.distanceSource}. Moving time excludes stops slower than 1.8 km/h.
        </p>

        <h2 className="mt-8 mb-3 font-semibold">Details you can edit</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title">
            <input className="input" value={activity.overrides.name ?? activity.name} onChange={(e) => setOverride('name', e.target.value)} />
          </Field>
          <Field label="Location">
            <div className="relative">
              <MapPin size={14} className="absolute top-2.5 left-2 text-ink-400" />
              <input className="input pl-7" placeholder="e.g. Lumpini Park, Bangkok" value={activity.overrides.location ?? ''} onChange={(e) => setOverride('location', e.target.value)} />
            </div>
          </Field>
          <Field label={`Distance override (${units === 'metric' ? 'km' : 'mi'})`}>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              placeholder={m.distanceM ? (m.distanceM / distUnit).toFixed(2) : ''}
              value={activity.overrides.distanceM !== undefined ? +(activity.overrides.distanceM / distUnit).toFixed(3) : ''}
              onChange={(e) => setOverride('distanceM', e.target.value === '' ? undefined : parseFloat(e.target.value) * distUnit)}
            />
          </Field>
          <Field label="Calories (kcal)">
            <input className="input" type="number" min="0" placeholder={m.calories ? String(Math.round(m.calories)) : 'not in file'} value={activity.overrides.calories ?? ''} onChange={(e) => setOverride('calories', e.target.value === '' ? undefined : parseFloat(e.target.value))} />
          </Field>
        </div>

        {m.splits.length > 0 && (
          <>
            <h2 className="mt-8 mb-3 font-semibold">Splits</h2>
            <div className="panel overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="bg-ink-850 text-left text-xs text-ink-400">
                  <tr>
                    <th className="px-3 py-2">{units === 'metric' ? 'Km' : 'Mi'}</th>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Pace</th>
                    <th className="px-3 py-2">Elev</th>
                  </tr>
                </thead>
                <tbody>
                  {m.splits.map((s) => (
                    <tr key={s.index} className="border-t border-ink-800">
                      <td className="px-3 py-1.5">{s.distanceM < distUnit - 1 ? (s.distanceM / distUnit).toFixed(2) : s.index}</td>
                      <td className="px-3 py-1.5">{formatDuration(s.durationS)}</td>
                      <td className="px-3 py-1.5">{formatPace(s.paceSPerKm, units)}</td>
                      <td className="px-3 py-1.5">{s.elevDeltaM === null ? '–' : `${s.elevDeltaM > 0 ? '+' : ''}${Math.round(s.elevDeltaM)} m`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="mt-8 flex justify-between">
          <button className="btn" onClick={onBack}>
            Back
          </button>
          <button className="btn btn-primary px-5" onClick={onNext}>
            Choose a template →
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function DesignStep({ activity, units, onBack }: { activity: Activity; units: Units; onBack: () => void }) {
  const nav = useNavigate();
  const m = useMemo(() => computeMetrics(activity), [activity]);
  const [size, setSize] = useState<'story' | 'square'>('story');
  const [picked, setPicked] = useState<MetricKey[] | null>(null);
  const [personal, setPersonal] = useState<PersonalTemplate[]>([]);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    listTemplates().then(setPersonal).catch(() => undefined);
  }, []);
  const dims = size === 'story' ? STORY : SQUARE;
  const selectable: MetricKey[] = ['distance', 'movingTime', 'elapsedTime', 'avgPace', 'bestPace', 'avgSpeed', 'elevGain', 'maxEle', 'avgHr', 'maxHr', 'avgCadence', 'calories', 'location'];
  const effective = picked ?? chooseMetrics(null, TEMPLATES[0], m);
  const previews = useMemo(
    () => TEMPLATES.map((t) => ({ t, doc: buildFromTemplate(t, { ...dims, metrics: chooseMetrics(picked, t, m), units }) })),
    [dims, picked, m, units],
  );
  const create = async (design: DesignDocument, name: string) => {
    setCreating(true);
    const p: Project = {
      formatVersion: PROJECT_FORMAT_VERSION,
      id: uid('p'),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      activity,
      design,
      selectedMetrics: picked ?? [],
      assetIds: [],
      exportPrefs: DEFAULT_EXPORT_PREFS,
    };
    await saveProject(p);
    nav(`/editor/${p.id}`);
  };
  const toggle = (k: MetricKey) => {
    const cur = picked ?? effective;
    setPicked(cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]);
  };
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Choose a template</h1>
          <p className="mt-1 text-sm text-ink-400">Previews use your activity. Everything is editable afterwards.</p>
        </div>
        <div className="flex rounded-lg border border-ink-700 p-0.5 text-sm" role="group" aria-label="Canvas size">
          <button onClick={() => setSize('story')} className={`rounded-md px-3 py-1 ${size === 'story' ? 'bg-ink-700' : 'text-ink-400'}`}>
            Story 9:16
          </button>
          <button onClick={() => setSize('square')} className={`rounded-md px-3 py-1 ${size === 'square' ? 'bg-ink-700' : 'text-ink-400'}`}>
            Square 1:1
          </button>
        </div>
      </div>
      <div className="mt-5">
        <div className="label">Statistics to show</div>
        <div className="flex flex-wrap gap-2">
          {selectable.map((k) => {
            const av = m.availability[k];
            const on = effective.includes(k);
            return (
              <button
                key={k}
                disabled={!av.available}
                title={av.available ? undefined : av.reason}
                onClick={() => toggle(k)}
                aria-pressed={on}
                className={`chip ${on ? 'border-brand bg-brand/15 text-white' : 'text-ink-300'} disabled:opacity-35`}
              >
                {on && <Check size={12} />}
                {METRICS.find((x) => x.key === k)?.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
        {previews.map(({ t, doc }) => (
          <button key={t.id} disabled={creating} onClick={() => create(doc, activity.overrides.name ?? activity.name)} className="group text-left" data-testid={`template-${t.id}`}>
            <div className="overflow-hidden rounded-xl border border-ink-800 transition group-hover:border-brand group-hover:shadow-[0_0_0_3px_rgba(255,90,31,0.25)]">
              <DocCanvas doc={doc} activity={activity} metrics={m} width={240} className="!w-full !h-auto" />
            </div>
            <div className="mt-2 font-medium">{t.name}</div>
            <div className="text-xs text-ink-400">{t.description}</div>
          </button>
        ))}
        {personal.map((t) => (
          <button key={t.id} disabled={creating} onClick={() => create({ ...structuredClone(t.design), units }, activity.overrides.name ?? activity.name)} className="group text-left">
            <div className="overflow-hidden rounded-xl border border-ink-800 transition group-hover:border-brand">
              <DocCanvas doc={t.design} activity={activity} metrics={m} width={240} className="!w-full !h-auto" />
            </div>
            <div className="mt-2 font-medium">{t.name}</div>
            <div className="text-xs text-ink-400">My template</div>
          </button>
        ))}
      </div>
      <div className="mt-8">
        <button className="btn" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
