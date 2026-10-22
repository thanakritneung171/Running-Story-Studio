import type { DesignDocument } from '../../../shared/design';
import type { Activity, MetricKey } from '../activity/types';

export const PROJECT_FORMAT_VERSION = 1;

export interface ExportPrefs {
  format: 'png' | 'png-transparent' | 'jpeg' | 'webp' | 'mp4';
  scale: number;
  jpegQuality: number;
  fps: 24 | 30 | 60;
  includeAudio: boolean;
}

export interface Project {
  formatVersion: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  activity: Activity | null;
  design: DesignDocument;
  /** Metrics the user picked when creating the design (for re-applying templates). */
  selectedMetrics: MetricKey[];
  assetIds: string[];
  exportPrefs: ExportPrefs;
  /** Last successful cloud save (ms), if cloud sync is enabled. */
  cloudSyncedAt?: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  createdAt: number;
  templateId?: string;
  activityName?: string;
  distanceM?: number | null;
  thumbnail?: Blob;
  location: 'local' | 'cloud' | 'both';
}

export interface PersonalTemplate {
  id: string;
  name: string;
  design: DesignDocument;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_EXPORT_PREFS: ExportPrefs = { format: 'png', scale: 1, jpegQuality: 0.92, fps: 30, includeAudio: true };
