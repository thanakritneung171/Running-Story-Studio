import type { TextStyle } from '../../../shared/design';
import { fontString } from './fonts';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const supportsLetterSpacing = (ctx: Ctx) => 'letterSpacing' in ctx;

export function measure(ctx: Ctx, text: string, style: TextStyle, size = style.fontSize): number {
  ctx.font = fontString(style, size);
  const ls = style.letterSpacing * (size / style.fontSize);
  if (supportsLetterSpacing(ctx)) {
    (ctx as CanvasRenderingContext2D).letterSpacing = `${ls}px`;
    return ctx.measureText(text).width;
  }
  return ctx.measureText(text).width + ls * Math.max(0, [...text].length);
}

/** Greedy word wrap to `maxWidth`, honouring explicit newlines. */
export function wrapLines(ctx: Ctx, text: string, style: TextStyle, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const next = line + w;
      if (line.trim() && measure(ctx, next.trimEnd(), style) > maxWidth) {
        out.push(line.trimEnd());
        line = w.trimStart();
      } else line = next;
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Draw a single line of text with alignment within [x, x+width] and its top at `top`. */
export function drawLine(ctx: Ctx, text: string, style: TextStyle, x: number, top: number, width: number, size = style.fontSize) {
  ctx.font = fontString(style, size);
  ctx.fillStyle = style.color;
  ctx.textBaseline = 'alphabetic';
  const ls = style.letterSpacing * (size / style.fontSize);
  const w = measure(ctx, text, style, size);
  // Letter spacing adds trailing space after the last glyph; remove it for alignment.
  const visualW = w - ls;
  const left = style.align === 'left' ? x : style.align === 'center' ? x + (width - visualW) / 2 : x + width - visualW;
  const lineH = size * style.lineHeight;
  // Place the alphabetic baseline so that cap height is vertically centred in the line box.
  const baseline = top + (lineH - size) / 2 + size * 0.8;
  if (style.shadow) {
    ctx.shadowColor = style.shadow.color;
    ctx.shadowBlur = style.shadow.blur;
    ctx.shadowOffsetX = style.shadow.x;
    ctx.shadowOffsetY = style.shadow.y;
  }
  ctx.textAlign = 'left';
  if (supportsLetterSpacing(ctx)) {
    (ctx as CanvasRenderingContext2D).letterSpacing = `${ls}px`;
    ctx.fillText(text, left, baseline);
  } else {
    let cx = left;
    for (const ch of text) {
      ctx.fillText(ch, cx, baseline);
      cx += ctx.measureText(ch).width + ls;
    }
  }
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  return { width: visualW, lineH };
}

export function applyCase(text: string, style: TextStyle) {
  return style.uppercase ? text.toUpperCase() : text;
}
