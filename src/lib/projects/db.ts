import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { PersonalTemplate, Project } from './types';
import type { MediaAsset } from '../media/types';

interface StudioDB extends DBSchema {
  projects: { key: string; value: Project & { thumbnail?: Blob } };
  media: { key: string; value: MediaAsset & { blob: Blob } };
  templates: { key: string; value: PersonalTemplate };
}

let dbp: Promise<IDBPDatabase<StudioDB>> | null = null;

/** Browser-local storage (IndexedDB). This is a convenience cache, not durable cloud storage. */
export function db() {
  dbp ??= openDB<StudioDB>('running-story-studio', 1, {
    upgrade(d) {
      d.createObjectStore('projects', { keyPath: 'id' });
      d.createObjectStore('media', { keyPath: 'id' });
      d.createObjectStore('templates', { keyPath: 'id' });
    },
  });
  return dbp;
}
