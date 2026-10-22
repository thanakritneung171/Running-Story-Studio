import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const SHOTS = process.env.SHOTS_DIR;
const shot = async (p: Page, name: string, fullPage = false) => {
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
};

/** Minimal PNG decoder (8-bit RGBA, non-interlaced) to verify the alpha channel of exports. */
function decodePng(buf: Buffer) {
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  let off = 8;
  let width = 0, height = 0, colorType = -1, bitDepth = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('ascii');
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  return { width, height, colorType, bitDepth, raw: colorType === 6 && bitDepth === 8 ? unfilter(inflateSync(Buffer.concat(idat)), width, height) : null };
}
function unfilter(data: Buffer, w: number, h: number) {
  const bpp = 4, stride = w * bpp;
  const out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = data[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const raw = data[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = raw;
      if (f === 1) v = raw + a;
      else if (f === 2) v = raw + b;
      else if (f === 3) v = raw + ((a + b) >> 1);
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[y * stride + x] = v & 255;
    }
  }
  return out;
}

async function importAndCreate(page: Page, template: string) {
  await page.goto('/new');
  await page.setInputFiles('[data-testid=activity-input]', 'tests/fixtures/park-loop.gpx');
  await expect(page.getByTestId('stats-grid')).toBeVisible();
  await page.getByRole('button', { name: /Choose a template/ }).click();
  await page.getByTestId(`template-${template}`).click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.waitForTimeout(800);
}

test('import GPX, review stats, create from template', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Import your run/ })).toBeVisible();
  await page.waitForTimeout(1200);
  await shot(page, '01-landing');
  await page.goto('/new');
  await page.setInputFiles('[data-testid=activity-input]', 'tests/fixtures/park-loop.gpx');
  const grid = page.getByTestId('stats-grid');
  await expect(grid).toBeVisible();
  await expect(grid).toContainText('Distance');
  await expect(grid.getByText('Calories').locator('..')).toContainText('Not available');
  await shot(page, '02-review', true);
  await page.getByRole('button', { name: /Choose a template/ }).click();
  await page.waitForTimeout(500);
  await shot(page, '03-templates', true);
  await page.getByTestId('template-sporty').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.waitForTimeout(1000);
  await shot(page, '04-editor');
  expect(errors).toEqual([]);
});

test('rejects malformed and unsupported files with a clear error', async ({ page }) => {
  await page.goto('/new');
  await page.setInputFiles('[data-testid=activity-input]', 'tests/fixtures/malformed.gpx');
  await expect(page.getByRole('alert')).toContainText(/not valid XML/i);
  await page.setInputFiles('[data-testid=activity-input]', 'tests/fixtures/not-activity.gpx');
  await expect(page.getByRole('alert')).toContainText(/Unsupported file/i);
});
