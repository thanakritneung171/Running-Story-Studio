import { XMLParser } from 'fast-xml-parser';
import { ActivityImportError } from './errors';

// Works in Web Workers and Node (DOMParser is not available in workers).
export function parseXml(text: string, arrayTags: string[]): Record<string, unknown> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    processEntities: true,
    isArray: (name) => arrayTags.includes(name),
  });
  let out: Record<string, unknown>;
  try {
    out = parser.parse(text, true) as Record<string, unknown>;
  } catch (e) {
    throw new ActivityImportError(
      `The file is not valid XML: ${(e as Error).message.split('\n')[0]}`,
      'malformed',
    );
  }
  return out;
}

export function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const raw = typeof v === 'object' && v !== null && '#text' in v ? (v as { '#text': unknown })['#text'] : v;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  return Number.isFinite(n) ? n : undefined;
}

export function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'object' && '#text' in (v as object)) return String((v as { '#text': unknown })['#text']);
  if (typeof v === 'object') return undefined;
  return String(v);
}

export function time(v: unknown): number | undefined {
  const s = str(v);
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
}

export function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
