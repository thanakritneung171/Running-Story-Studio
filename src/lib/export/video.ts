import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { DesignDocument, LayerOf } from '../../../shared/design';
import type { Activity, ActivityMetrics } from '../activity/types';
import { paintBackground, renderDocument } from '../render/renderer';
import { getAssetBlob } from '../media/store';
import { prepareExportMedia, seekVideo } from './assets';
import { bitrateFor, detectVideoCapabilities, type VideoCapabilities } from './capabilities';

export interface VideoExportOptions {
  width: number;
  height: number;
  fps: number;
  durationS: number;
  includeAudio: boolean;
  activity: Activity | null;
  metrics: ActivityMetrics | null;
  onProgress?: (p: { phase: 'preparing' | 'rendering' | 'audio' | 'finalizing'; done: number; total: number }) => void;
  signal?: AbortSignal;
}

export interface VideoExportResult {
  blob: Blob;
  mime: string;
  extension: 'mp4' | 'webm';
  codec: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
  durationS: number;
  audio: 'none' | 'aac' | 'opus' | 'skipped';
  warnings: string[];
  method: 'webcodecs' | 'mediarecorder';
}

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled.');
  }
}

export const MAX_VIDEO_SECONDS = 60;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export async function exportVideo(doc: DesignDocument, o: VideoExportOptions): Promise<VideoExportResult> {
  const width = even(o.width);
  const height = even(o.height);
  const durationS = Math.min(MAX_VIDEO_SECONDS, Math.max(0.5, o.durationS));
  const caps = await detectVideoCapabilities(width, height, o.fps);
  if (caps.video) return encodeWithWebCodecs(doc, { ...o, width, height, durationS }, caps);
  if (caps.recorderMime) return recordRealtime(doc, { ...o, width, height, durationS }, caps);
  throw new Error(caps.summary);
}

function frameRenderer(doc: DesignDocument, width: number, height: number, o: VideoExportOptions, lookup: Parameters<typeof renderDocument>[2]['media']) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const s = Math.min(width / doc.canvas.width, height / doc.canvas.height);
  const ox = (width - doc.canvas.width * s) / 2;
  const oy = (height - doc.canvas.height * s) / 2;
  const draw = (t: number) => {
    // Video has no alpha: transparent designs are rendered over black.
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    paintBackground(ctx, doc.canvas.background, width, height);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    // On an opaque canvas, renderDocument's clear produces black, so transparent designs sit on black.
    renderDocument(ctx, doc, { activity: o.activity, metrics: o.metrics, media: lookup, time: t });
    ctx.restore();
  };
  return { canvas, draw };
}

function videoLayers(doc: DesignDocument) {
  return doc.layers.filter((l): l is LayerOf<'video'> => l.type === 'video' && l.visible);
}

/** Source time for a video layer at timeline time t (holds the last frame after the trim-out). */
function sourceTime(l: LayerOf<'video'>, v: HTMLVideoElement, t: number) {
  const end = l.trimEndS ?? v.duration;
  return Math.min(l.trimStartS + t, Math.max(l.trimStartS, end - 0.001));
}

async function encodeWithWebCodecs(doc: DesignDocument, o: VideoExportOptions, caps: VideoCapabilities): Promise<VideoExportResult> {
  const { width, height, fps, durationS } = o;
  const warnings: string[] = [];
  o.onProgress?.({ phase: 'preparing', done: 0, total: 1 });
  const media = await prepareExportMedia(doc, false);
  warnings.push(...media.warnings);
  const vc = caps.video!;
  if (!vc.universal) warnings.push(`Encoded as ${vc.label}: H.264 is not available in this browser, so the file may not play on iPhone/Instagram.`);

  // Audio is mixed first so the muxer knows whether to create an audio track.
  let audioBuffer: AudioBuffer | null = null;
  let audioState: VideoExportResult['audio'] = 'none';
  const vLayers = videoLayers(doc).filter((l) => !l.muted && l.volume > 0);
  if (o.includeAudio && vLayers.length) {
    if (!caps.audio) {
      audioState = 'skipped';
      warnings.push('This browser has no audio encoder; the video was exported without sound.');
    } else {
      o.onProgress?.({ phase: 'audio', done: 0, total: 1 });
      try {
        audioBuffer = await mixAudio(vLayers, durationS, 48000);
        if (!audioBuffer) audioState = 'none';
      } catch (e) {
        audioState = 'skipped';
        warnings.push(`The background video's audio could not be decoded (${(e as Error).message}); exported without sound.`);
      }
    }
  }
  if (audioBuffer && caps.audio?.mux === 'opus') warnings.push('Audio is Opus (AAC encoder unavailable); some players may not play the sound.');

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: vc.mux, width, height, frameRate: fps },
    audio: audioBuffer && caps.audio ? { codec: caps.audio.mux, numberOfChannels: 2, sampleRate: 48000 } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encoderError = e as Error),
  });
  encoder.configure({
    codec: vc.codec,
    width,
    height,
    bitrate: bitrateFor(width, height, fps),
    framerate: fps,
    latencyMode: 'quality',
    ...(vc.mux === 'avc' ? { avc: { format: 'avc' as const } } : {}),
  });

  const { canvas, draw } = frameRenderer(doc, width, height, o, media.lookup);
  const total = Math.round(durationS * fps);
  const vls = videoLayers(doc);
  try {
    for (let f = 0; f < total; f++) {
      if (o.signal?.aborted) throw new ExportCancelled();
      if (encoderError) throw encoderError;
      const t = f / fps;
      for (const l of vls) {
        const v = media.videos.get(l.assetId);
        if (v) await seekVideo(v, sourceTime(l, v, t));
      }
      draw(t);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((f * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: f % (fps * 2) === 0 });
      frame.close();
      // Back-pressure: never let encoded-but-unflushed frames pile up in memory.
      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2));
      if (f % 5 === 0) {
        o.onProgress?.({ phase: 'rendering', done: f, total });
        await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
      }
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
    if (audioBuffer && caps.audio) {
      o.onProgress?.({ phase: 'audio', done: 0, total: 1 });
      await encodeAudio(audioBuffer, caps.audio.codec, muxer, o.signal);
      audioState = caps.audio.mux;
    }
    o.onProgress?.({ phase: 'finalizing', done: total, total });
    muxer.finalize();
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    return { blob, mime: 'video/mp4', extension: 'mp4', codec: vc.codec, width, height, fps, frames: total, durationS: total / fps, audio: audioState, warnings, method: 'webcodecs' };
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    canvas.width = canvas.height = 0;
    media.dispose();
  }
}

/** Mix the audio of the (unmuted) video layers for [0, durationS]. Returns null if no layer has audio. */
async function mixAudio(layers: LayerOf<'video'>[], durationS: number, sampleRate: number): Promise<AudioBuffer | null> {
  const ctx = new OfflineAudioContext(2, Math.ceil(durationS * sampleRate), sampleRate);
  let any = false;
  for (const l of layers) {
    const blob = await getAssetBlob(l.assetId);
    if (!blob) continue;
    let buf: AudioBuffer;
    try {
      buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    } catch {
      continue; // no audio track
    }
    any = true;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = l.volume;
    src.connect(gain).connect(ctx.destination);
    const end = l.trimEndS ?? buf.duration;
    src.start(0, l.trimStartS, Math.max(0, Math.min(end - l.trimStartS, durationS)));
  }
  if (!any) return null;
  return ctx.startRendering();
}

async function encodeAudio(buf: AudioBuffer, codec: string, muxer: Muxer<ArrayBufferTarget>, signal?: AbortSignal) {
  let err: Error | null = null;
  const enc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (err = e as Error) });
  enc.configure({ codec, sampleRate: buf.sampleRate, numberOfChannels: 2, bitrate: 128000 });
  const CH = 2;
  const chunk = 4096;
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  try {
    for (let i = 0; i < buf.length; i += chunk) {
      if (signal?.aborted) throw new ExportCancelled();
      if (err) throw err;
      const n = Math.min(chunk, buf.length - i);
      const data = new Float32Array(n * CH);
      data.set(L.subarray(i, i + n), 0);
      data.set(R.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: buf.sampleRate, numberOfFrames: n, numberOfChannels: CH, timestamp: Math.round((i / buf.sampleRate) * 1e6), data });
      enc.encode(ad);
      ad.close();
      while (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1));
    }
    await enc.flush();
    if (err) throw err;
  } finally {
    if (enc.state !== 'closed') enc.close();
  }
}

/**
 * Fallback for browsers without WebCodecs: real-time capture with MediaRecorder.
 * Output format is whatever the browser supports (MP4 on Safari / recent Chrome, else WebM)
 * and is reported truthfully — a WebM file is never renamed to .mp4.
 */
async function recordRealtime(doc: DesignDocument, o: VideoExportOptions, caps: VideoCapabilities): Promise<VideoExportResult> {
  const { width, height, fps, durationS } = o;
  const warnings: string[] = ['Recorded in real time (this browser lacks WebCodecs); keep this tab visible until it finishes.'];
  if (!caps.recorderIsMp4) warnings.push('This browser cannot create MP4 files, so the video was saved as WebM.');
  const media = await prepareExportMedia(doc, false);
  warnings.push(...media.warnings);
  const { canvas, draw } = frameRenderer(doc, width, height, o, media.lookup);
  const stream = canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: caps.recorderMime!, videoBitsPerSecond: bitrateFor(width, height, fps) });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const vls = videoLayers(doc);
  try {
    for (const l of vls) {
      const v = media.videos.get(l.assetId);
      if (v) {
        await seekVideo(v, l.trimStartS);
        void v.play().catch(() => undefined);
      }
    }
    const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.start(250);
    const t0 = performance.now();
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (o.signal?.aborted) return reject(new ExportCancelled());
        const t = (performance.now() - t0) / 1000;
        if (t >= durationS) return resolve();
        draw(t);
        o.onProgress?.({ phase: 'rendering', done: Math.floor(t * fps), total: Math.round(durationS * fps) });
        requestAnimationFrame(tick);
      };
      tick();
    }).finally(() => rec.state !== 'inactive' && rec.stop());
    await stopped;
    const mime = caps.recorderMime!.split(';')[0];
    const blob = new Blob(chunks, { type: mime });
    return {
      blob, mime, extension: caps.recorderIsMp4 ? 'mp4' : 'webm', codec: caps.recorderMime!, width, height, fps,
      frames: Math.round(durationS * fps), durationS, audio: 'none', warnings, method: 'mediarecorder',
    };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    canvas.width = canvas.height = 0;
    media.dispose();
  }
}
