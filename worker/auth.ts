/**
 * Lightweight, account-less authorization.
 *
 * The browser generates a random 256-bit "device key" (kept in localStorage, shown to the user
 * as a sync key so they can use it on another device). Every API call sends it as a Bearer
 * token. The Worker never stores the key itself — only SHA-256(key), used as `owner_id`.
 * Every query is scoped by owner_id, so a project id alone never grants access.
 *
 * If the app is deployed behind Cloudflare Access, the Access-authenticated identity can be
 * used instead (see README "Authentication").
 */
const KEY_RE = /^[A-Za-z0-9_-]{43,128}$/;

export async function ownerFromRequest(req: Request): Promise<string | null> {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m || !KEY_RE.test(m[1])) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(m[1]));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
