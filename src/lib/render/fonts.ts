import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/800.css';
import '@fontsource/inter/900.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/700.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/playfair-display/400-italic.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import type { DesignDocument, TextStyle } from '../../../shared/design';

/** Fonts are self-hosted (bundled), so exports never depend on a third-party font CDN. */
export const FONT_FAMILIES = ['Inter', 'Bebas Neue', 'Oswald', 'Playfair Display', 'JetBrains Mono'] as const;

export function fontString(s: Pick<TextStyle, 'fontFamily' | 'fontWeight' | 'fontSize' | 'italic'>, size = s.fontSize) {
  return `${s.italic ? 'italic ' : ''}${s.fontWeight} ${size}px "${s.fontFamily}", system-ui, sans-serif`;
}

/**
 * Make sure every font used by the document is loaded before rendering for export.
 * Returns the list of fonts that failed to load (the renderer then falls back to system fonts).
 */
export async function ensureFonts(doc: DesignDocument): Promise<string[]> {
  if (typeof document === 'undefined' || !document.fonts) return [];
  const wanted = new Set<string>();
  for (const l of doc.layers) {
    if (l.type === 'text') wanted.add(fontString(l.style, 40));
    if (l.type === 'stat') {
      wanted.add(fontString(l.valueStyle, 40));
      wanted.add(fontString(l.labelStyle, 40));
    }
  }
  const failed: string[] = [];
  await Promise.all(
    [...wanted].map(async (f) => {
      try {
        const res = await document.fonts.load(f, '0123456789:.kmABC');
        if (res.length === 0) failed.push(f);
      } catch {
        failed.push(f);
      }
    }),
  );
  return failed;
}
