/** Identify media by magic bytes. Client-provided names and MIME types are never trusted. */
export type Sniffed = { kind: 'image' | 'video'; mime: string } | null;

export function sniffMedia(b: Uint8Array): Sniffed {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  const str = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length < 12) return null;
  if (at(0, 0xff, 0xd8, 0xff)) return { kind: 'image', mime: 'image/jpeg' };
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { kind: 'image', mime: 'image/png' };
  if (str(0, 4) === 'RIFF' && str(8, 4) === 'WEBP') return { kind: 'image', mime: 'image/webp' };
  if (str(4, 4) === 'ftyp') {
    const brand = str(8, 4);
    if (/^(avif|avis)$/.test(brand)) return { kind: 'image', mime: 'image/avif' };
    if (/^(heic|heix|mif1)$/.test(brand)) return null; // not decodable in most browsers
    if (brand === 'qt  ') return { kind: 'video', mime: 'video/quicktime' };
    return { kind: 'video', mime: 'video/mp4' };
  }
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return { kind: 'video', mime: 'video/webm' };
  return null;
}
