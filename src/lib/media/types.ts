export interface MediaAsset {
  id: string;
  kind: 'image' | 'video';
  name: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  durationS?: number;
  hasAudio?: boolean;
  createdAt: number;
  /** Uploaded to cloud storage (R2). */
  cloud?: boolean;
}
