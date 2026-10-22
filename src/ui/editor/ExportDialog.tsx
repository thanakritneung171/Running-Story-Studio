import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, Film, Image as ImageIcon, Loader2, X, AlertTriangle, CloudUpload } from 'lucide-react';
import { useDoc, useEditor } from './store';
import { exportImage, type ImageExportResult, type ImageFormat } from '../../lib/export/image';
import { exportVideo, ExportCancelled, MAX_VIDEO_SECONDS, type VideoExportResult } from '../../lib/export/video';
import { detectVideoCapabilities, type VideoCapabilities } from '../../lib/export/capabilities';
import { api, isCloudSyncEnabled } from '../../lib/cloud/client';
import { uid } from '../../lib/design/ids';

const fmtBytes = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'running-story';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'image' | 'video'>('image');
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label="Export">
      <div className="panel flex max-h-full w-full max-w-2xl flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center gap-2 border-b border-ink-800 px-4 py-3">
          <h2 className="font-semibold">Export</h2>
          <div className="ml-4 flex rounded-lg border border-ink-700 p-0.5 text-sm">
            <button className={`flex items-center gap-1 rounded-md px-3 py-1 ${tab === 'image' ? 'bg-ink-700' : 'text-ink-400'}`} onClick={() => setTab('image')} data-testid="export-tab-image">
              <ImageIcon size={14} /> Image
            </button>
            <button className={`flex items-center gap-1 rounded-md px-3 py-1 ${tab === 'video' ? 'bg-ink-700' : 'text-ink-400'}`} onClick={() => setTab('video')} data-testid="export-tab-video">
              <Film size={14} /> Video
            </button>
          </div>
          <button className="btn btn-ghost btn-icon ml-auto" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-4">{tab === 'image' ? <ImageExport /> : <VideoExport />}</div>
      </div>
    </div>
  );
}

function SaveToCloud({ blob, name }: { blob: Blob; name: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | string>('idle');
  if (!isCloudSyncEnabled()) return null;
  return (
    <button
      className="btn"
      disabled={state === 'busy' || state === 'done'}
      onClick={async () => {
        setState('busy');
        try {
          await api(`/media/${uid('x')}`, { method: 'PUT', body: blob, headers: { 'x-media-kind': 'export', 'x-file-name': encodeURIComponent(name), 'content-type': blob.type } });
          setState('done');
        } catch (e) {
          setState((e as Error).message);
        }
      }}
    >
      <CloudUpload size={16} /> {state === 'done' ? 'Saved to cloud' : state === 'busy' ? 'Uploading…' : state === 'idle' ? 'Save copy to cloud' : `Failed: ${state}`}
    </button>
  );
}

function ImageExport() {
  const doc = useDoc();
  const project = useEditor((s) => s.project)!;
  const metrics = useEditor((s) => s.metrics);
  const [format, setFormat] = useState<ImageFormat>(doc.canvas.background.type === 'transparent' ? 'png-transparent' : 'png');
  const [preset, setPreset] = useState<'canvas' | 'x2' | 'story' | 'square' | 'custom'>('canvas');
  const [custom, setCustom] = useState({ w: doc.canvas.width, h: doc.canvas.height });
  const [quality, setQuality] = useState(0.92);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImageExportResult | null>(null);
  const preview = useMemo(() => (result ? URL.createObjectURL(result.blob) : null), [result]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const size =
    preset === 'canvas' ? { w: doc.canvas.width, h: doc.canvas.height } : preset === 'x2' ? { w: doc.canvas.width * 2, h: doc.canvas.height * 2 } : preset === 'story' ? { w: 1080, h: 1920 } : preset === 'square' ? { w: 1080, h: 1080 } : custom;
  const aspectMismatch = Math.abs(size.w / size.h - doc.canvas.width / doc.canvas.height) > 0.01;
  const ext = format === 'jpeg' ? 'jpg' : format === 'webp' ? 'webp' : 'png';
  const fileName = `${slug(project.name)}${format === 'png-transparent' ? '-overlay' : ''}-${size.w}x${size.h}.${ext}`;

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      await useEditor.getState().saveNow();
      const r = await exportImage(doc, { format, width: size.w, height: size.h, quality, activity: project.activity, metrics });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="label">Format</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ['png', 'PNG', 'With background'],
              ['png-transparent', 'Transparent PNG', 'Overlay, no background'],
              ['jpeg', 'JPEG', 'Smaller file'],
              ['webp', 'WebP', 'Modern, small'],
            ] as const
          ).map(([f, t, d]) => (
            <button key={f} onClick={() => setFormat(f)} data-testid={`format-${f}`} className={`rounded-lg border p-2 text-left ${format === f ? 'border-brand bg-brand/10' : 'border-ink-700 hover:border-ink-500'}`}>
              <div className="text-sm font-medium">{t}</div>
              <div className="text-xs text-ink-400">{d}</div>
            </button>
          ))}
        </div>
        {format === 'png-transparent' && <p className="mt-2 text-xs text-ink-400">The canvas background and layers marked “Background” are left out, so you get a true alpha channel to place over your own photo or video.</p>}
      </fieldset>
      <fieldset>
        <legend className="label">Size</legend>
        <select className="input" value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)} data-testid="size-preset">
          <option value="canvas">Canvas size ({doc.canvas.width}×{doc.canvas.height})</option>
          <option value="x2">2× ({doc.canvas.width * 2}×{doc.canvas.height * 2})</option>
          <option value="story">Instagram Story / Reel (1080×1920)</option>
          <option value="square">Square (1080×1080)</option>
          <option value="custom">Custom…</option>
        </select>
        {preset === 'custom' && (
          <div className="mt-2 flex items-center gap-2">
            <input className="input w-28" type="number" min={16} max={8192} value={custom.w} onChange={(e) => setCustom({ ...custom, w: Math.max(16, Math.min(8192, Number(e.target.value) || 16)) })} aria-label="Width" />
            ×
            <input className="input w-28" type="number" min={16} max={8192} value={custom.h} onChange={(e) => setCustom({ ...custom, h: Math.max(16, Math.min(8192, Number(e.target.value) || 16)) })} aria-label="Height" />
            px
          </div>
        )}
        {aspectMismatch && <p className="mt-2 text-xs text-warn">This size has a different shape than the canvas; the design is scaled to fit and centred. Change the canvas size in the toolbar to re-layout instead.</p>}
      </fieldset>
      {(format === 'jpeg' || format === 'webp') && (
        <label className="block">
          <span className="label">Quality {Math.round(quality * 100)}%</span>
          <input type="range" min={0.5} max={1} step={0.01} value={quality} onChange={(e) => setQuality(parseFloat(e.target.value))} className="w-full" />
        </label>
      )}
      <button className="btn btn-primary w-full py-2.5" disabled={busy} onClick={run} data-testid="run-image-export">
        {busy ? <Loader2 size={16} className="animate-spin" /> : <ImageIcon size={16} />} {busy ? 'Rendering…' : `Export ${size.w}×${size.h}`}
      </button>
      {error && (
        <p role="alert" className="flex gap-2 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-red-200">
          <AlertTriangle size={16} className="shrink-0 text-bad" /> {error}
        </p>
      )}
      {result && preview && (
        <div className="flex gap-4 rounded-xl border border-ink-700 p-3" data-testid="image-result">
          <img src={preview} alt="Export preview" className="checker h-48 w-auto rounded object-contain" />
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <div className="flex items-center gap-1 font-medium text-ok">
              <CheckCircle2 size={16} /> Ready
            </div>
            <div className="text-ink-300" data-testid="image-result-info">
              {result.width}×{result.height} · {result.mime} · {fmtBytes(result.blob.size)}
            </div>
            {result.alpha && (
              <div className="text-xs text-ink-400" data-testid="alpha-report">
                Alpha channel: {result.alpha.translucentPixels > 0 ? `${((result.alpha.transparentPixels / result.alpha.totalPixels) * 100).toFixed(1)}% fully transparent pixels` : 'fully opaque'}
              </div>
            )}
            {result.warnings.map((w, i) => (
              <p key={i} className="text-xs text-warn">
                {w}
              </p>
            ))}
            <div className="flex flex-wrap gap-2 pt-2">
              <button className="btn btn-primary" onClick={() => download(result.blob, fileName)} data-testid="download-image">
                <Download size={16} /> Download
              </button>
              <SaveToCloud blob={result.blob} name={fileName} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function VideoExport() {
  const doc = useDoc();
  const project = useEditor((s) => s.project)!;
  const metrics = useEditor((s) => s.metrics);
  const [res, setRes] = useState<'full' | '720'>('full');
  const [fps, setFps] = useState<number>(doc.timeline.fps);
  const [duration, setDuration] = useState(Math.min(doc.timeline.durationS, MAX_VIDEO_SECONDS));
  const [audio, setAudio] = useState(true);
  const [caps, setCaps] = useState<VideoCapabilities | null>(null);
  const [progress, setProgress] = useState<{ phase: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VideoExportResult | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scale = res === 'full' ? 1 : 720 / Math.min(doc.canvas.width, doc.canvas.height);
  const w = Math.round((doc.canvas.width * scale) / 2) * 2;
  const h = Math.round((doc.canvas.height * scale) / 2) * 2;
  const hasVideoAudio = doc.layers.some((l) => l.type === 'video' && l.visible && !l.muted);
  const preview = useMemo(() => (result ? URL.createObjectURL(result.blob) : null), [result]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  useEffect(() => {
    let live = true;
    setCaps(null);
    detectVideoCapabilities(w, h, fps).then((c) => live && setCaps(c));
    return () => {
      live = false;
    };
  }, [w, h, fps]);
  useEffect(() => () => abort.current?.abort(), []);

  const run = async () => {
    setError(null);
    setResult(null);
    abort.current = new AbortController();
    setProgress({ phase: 'preparing', done: 0, total: 1 });
    try {
      useEditor.getState().setPlaying(false);
      await useEditor.getState().saveNow();
      const r = await exportVideo(doc, { width: w, height: h, fps, durationS: duration, includeAudio: audio, activity: project.activity, metrics, onProgress: setProgress, signal: abort.current.signal });
      setResult(r);
    } catch (e) {
      if (!(e instanceof ExportCancelled)) setError((e as Error).message || 'Video export failed.');
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };
  const supported = caps && (caps.video || caps.recorderMime);
  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className={`rounded-lg border p-3 text-sm ${!caps ? 'border-ink-700' : caps.video?.universal ? 'border-ok/40 bg-ok/5' : supported ? 'border-warn/40 bg-warn/5' : 'border-bad/40 bg-bad/5'}`} data-testid="video-capabilities">
        <div className="label">This browser</div>
        {caps ? (
          <>
            <p>{caps.summary}</p>
            <p className="mt-1 text-xs text-ink-400">
              WebCodecs: {caps.webcodecs ? 'yes' : 'no'} · Video encoder: {caps.video ? `${caps.video.label} (${caps.video.codec})` : 'none'} · Audio encoder: {caps.audio?.label ?? 'none'} · Recorder fallback: {caps.recorderMime ?? 'none'}
            </p>
          </>
        ) : (
          <p className="text-ink-400">Checking encoder support…</p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label>
          <span className="label">Resolution</span>
          <select className="input" value={res} onChange={(e) => setRes(e.target.value as 'full' | '720')}>
            <option value="full">
              Full ({Math.round(doc.canvas.width / 2) * 2}×{Math.round(doc.canvas.height / 2) * 2})
            </option>
            <option value="720">720p ({w === doc.canvas.width ? '…' : `${Math.round((doc.canvas.width * (720 / Math.min(doc.canvas.width, doc.canvas.height))) / 2) * 2}×${Math.round((doc.canvas.height * (720 / Math.min(doc.canvas.width, doc.canvas.height))) / 2) * 2}`})</option>
          </select>
        </label>
        <label>
          <span className="label">Frame rate</span>
          <select className="input" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
            {[24, 25, 30, 60].map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Duration (s)</span>
          <input className="input" type="number" min={1} max={MAX_VIDEO_SECONDS} step={0.5} value={duration} onChange={(e) => setDuration(Math.max(1, Math.min(MAX_VIDEO_SECONDS, Number(e.target.value) || 1)))} data-testid="video-duration" />
        </label>
      </div>
      <p className="text-xs text-ink-400">
        Animation timeline: {doc.timeline.durationS}s (edit it under Canvas properties). Background video plays from its trim-in point and holds its last frame if shorter. Max {MAX_VIDEO_SECONDS}s.
        {doc.canvas.background.type === 'transparent' && ' MP4 has no transparency, so transparent areas become black.'}
      </p>
      {hasVideoAudio && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} /> Include the background video's audio
        </label>
      )}
      {progress ? (
        <div className="space-y-2" data-testid="video-progress">
          <div className="flex justify-between text-sm">
            <span className="capitalize">{progress.phase}…</span>
            <span className="tabular-nums">{progress.phase === 'rendering' ? `${progress.done}/${progress.total} frames · ${pct}%` : ''}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink-800">
            <div className="h-full bg-brand transition-[width]" style={{ width: `${progress.phase === 'rendering' ? pct : progress.phase === 'finalizing' ? 100 : 3}%` }} />
          </div>
          <button className="btn w-full" onClick={() => abort.current?.abort()}>
            Cancel
          </button>
        </div>
      ) : (
        <button className="btn btn-primary w-full py-2.5" disabled={!supported} onClick={run} data-testid="run-video-export">
          <Film size={16} /> {caps?.video ? `Render MP4 (${w}×${h}, ${fps} fps, ${duration}s)` : caps?.recorderMime ? `Record ${caps.recorderIsMp4 ? 'MP4' : 'WebM'} in real time` : 'Video export unavailable'}
        </button>
      )}
      {error && (
        <p role="alert" className="flex gap-2 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-red-200">
          <AlertTriangle size={16} className="shrink-0 text-bad" /> {error}
        </p>
      )}
      {result && preview && (
        <div className="flex flex-col gap-4 rounded-xl border border-ink-700 p-3 sm:flex-row" data-testid="video-result">
          <video src={preview} controls playsInline className="max-h-72 rounded bg-black" />
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <div className="flex items-center gap-1 font-medium text-ok">
              <CheckCircle2 size={16} /> {result.extension.toUpperCase()} ready
            </div>
            <div className="text-ink-300" data-testid="video-result-info">
              {result.width}×{result.height} · {result.fps} fps · {result.durationS.toFixed(2)}s · {fmtBytes(result.blob.size)}
            </div>
            <div className="text-xs text-ink-400">
              {result.mime} · codec {result.codec} · audio {result.audio} · {result.method === 'webcodecs' ? 'frame-accurate encode' : 'real-time recording'}
            </div>
            {result.warnings.map((w2, i) => (
              <p key={i} className="text-xs text-warn">
                {w2}
              </p>
            ))}
            <div className="flex flex-wrap gap-2 pt-2">
              <button className="btn btn-primary" onClick={() => download(result.blob, `${slug(project.name)}-${result.width}x${result.height}.${result.extension}`)} data-testid="download-video">
                <Download size={16} /> Download .{result.extension}
              </button>
              <SaveToCloud blob={result.blob} name={`${slug(project.name)}.${result.extension}`} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
