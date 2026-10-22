/**
 * Detect what this browser can actually produce. We test the full pipeline pieces
 * (VideoEncoder config support for the exact size/fps, AudioEncoder, MediaRecorder MIME types),
 * not just whether `VideoEncoder` exists.
 */
export type MuxVideoCodec = 'avc' | 'vp9' | 'av1';
export interface VideoCodecChoice {
  mux: MuxVideoCodec;
  codec: string;
  label: string;
  /** Broadly playable everywhere (iOS/Instagram/QuickTime). */
  universal: boolean;
}
export interface AudioCodecChoice {
  mux: 'aac' | 'opus';
  codec: string;
  label: string;
}
export interface VideoCapabilities {
  webcodecs: boolean;
  video: VideoCodecChoice | null;
  audio: AudioCodecChoice | null;
  /** MediaRecorder fallback MIME type (real-time capture), if any. */
  recorderMime: string | null;
  recorderIsMp4: boolean;
  /** Human-readable summary of what will happen. */
  summary: string;
}

const AVC_CANDIDATES = ['avc1.640033', 'avc1.64002A', 'avc1.640028', 'avc1.4D4033', 'avc1.4D0028', 'avc1.42E033', 'avc1.42E028'];

export async function detectVideoCapabilities(width: number, height: number, fps: number): Promise<VideoCapabilities> {
  const webcodecs = typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
  let video: VideoCodecChoice | null = null;
  if (webcodecs) {
    const bitrate = bitrateFor(width, height, fps);
    const tryCfg = async (codec: string, extra: Partial<VideoEncoderConfig> = {}) => {
      try {
        const r = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate: fps, ...extra });
        return !!r.supported;
      } catch {
        return false;
      }
    };
    for (const c of AVC_CANDIDATES) {
      if (await tryCfg(c, { avc: { format: 'avc' } })) {
        video = { mux: 'avc', codec: c, label: 'H.264 (MP4)', universal: true };
        break;
      }
    }
    if (!video && (await tryCfg('vp09.00.40.08'))) video = { mux: 'vp9', codec: 'vp09.00.40.08', label: 'VP9 in MP4', universal: false };
    if (!video && (await tryCfg('av01.0.08M.08'))) video = { mux: 'av1', codec: 'av01.0.08M.08', label: 'AV1 in MP4', universal: false };
  }
  let audio: AudioCodecChoice | null = null;
  if (typeof AudioEncoder !== 'undefined') {
    const tryA = async (codec: string) => {
      try {
        return !!(await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })).supported;
      } catch {
        return false;
      }
    };
    if (await tryA('mp4a.40.2')) audio = { mux: 'aac', codec: 'mp4a.40.2', label: 'AAC' };
    else if (await tryA('opus')) audio = { mux: 'opus', codec: 'opus', label: 'Opus' };
  }
  let recorderMime: string | null = null;
  if (typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype) {
    for (const m of ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
      if (MediaRecorder.isTypeSupported(m)) {
        recorderMime = m;
        break;
      }
    }
  }
  const recorderIsMp4 = !!recorderMime?.startsWith('video/mp4');
  let summary: string;
  if (video)
    summary = video.universal
      ? `MP4 (H.264) encoded in your browser${audio ? ` with ${audio.label} audio` : ', no audio encoder available'}.`
      : `This browser cannot encode H.264. The MP4 will use ${video.label}, which plays in Chrome/Firefox/Android but may not play on iPhone or in Instagram.`;
  else if (recorderMime)
    summary = recorderIsMp4
      ? 'WebCodecs is unavailable; the video will be recorded in real time as MP4.'
      : 'This browser cannot produce MP4. The video will be recorded in real time as WebM (clearly labelled), or use Chrome/Edge/Safari for MP4.';
  else summary = 'Video export is not supported in this browser. Use a recent Chrome, Edge or Safari.';
  return { webcodecs, video, audio, recorderMime, recorderIsMp4, summary };
}

export function bitrateFor(w: number, h: number, fps: number) {
  // ~0.12 bits per pixel per frame, clamped (≈ 7.5 Mbps for 1080×1920@30).
  return Math.round(Math.min(20e6, Math.max(2e6, w * h * fps * 0.12)));
}
