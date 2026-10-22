/**
 * Cloud sync client. Cloud sync is OFF by default — activity data (which contains precise
 * location) never leaves the browser unless the user turns it on.
 */
const KEY_STORAGE = 'rss.deviceKey';
const SYNC_STORAGE = 'rss.cloudSync';

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage blocked */
  }
}

export function getDeviceKey(): string {
  let k = safeGet(KEY_STORAGE);
  if (!k || !/^[A-Za-z0-9_-]{43,128}$/.test(k)) {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    k = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    safeSet(KEY_STORAGE, k);
  }
  return k;
}

/** Use a sync key copied from another device. */
export function setDeviceKey(k: string): boolean {
  const v = k.trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(v)) return false;
  safeSet(KEY_STORAGE, v);
  return true;
}

export const isCloudSyncEnabled = () => safeGet(SYNC_STORAGE) === '1';
export const setCloudSyncEnabled = (on: boolean) => safeSet(SYNC_STORAGE, on ? '1' : null);

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${getDeviceKey()}`);
  if (init.body && typeof init.body === 'string') headers.set('content-type', 'application/json');
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server.');
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    let code = 'http_error';
    try {
      const j = (await res.json()) as { error?: { code: string; message: string } };
      if (j.error) {
        msg = j.error.message;
        code = j.error.code;
      }
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, code, msg);
  }
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? res.json() : res.blob()) as Promise<T>;
}

export interface Health {
  ok: boolean;
  storage: { d1: boolean; r2: boolean };
}
let healthCache: Promise<Health | null> | null = null;
export function cloudHealth(force = false): Promise<Health | null> {
  if (!healthCache || force)
    healthCache = fetch('/api/health')
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? (r.json() as Promise<Health>) : null))
      .catch(() => null);
  return healthCache;
}
export async function cloudAvailable(): Promise<boolean> {
  const h = await cloudHealth();
  return !!h?.storage.d1 && !!h.storage.r2;
}
