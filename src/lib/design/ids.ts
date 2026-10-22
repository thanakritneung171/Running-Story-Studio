export function uid(prefix = ''): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const s = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return prefix ? `${prefix}_${s}` : s;
}
