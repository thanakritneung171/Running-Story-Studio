import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const SHOTS = process.env.SHOTS_DIR;
const shot = async (p: Page, name: string) => SHOTS && p.screenshot({ path: `${SHOTS}/${name}.png` });

function readPng(buf: Buffer) {
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
  return { width, height, colorType, bitDepth, idat: Buffer.concat(idat) };
}

/** Decode RGBA8 PNG scanlines and count alpha values. */
function alphaStats(png: ReturnType<typeof readPng>) {
  const { width: w, height: h } = png;
  const data = inflateSync(png.idat);
  const stride = w * 4;
  let prev = Buffer.alloc(stride);
  let transparent = 0, opaque = 0;
  for (let y = 0; y < h; y++) {
    const f = data[y * (stride + 1)];
    const line = Buffer.from(data.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? line[x - 4] : 0, b = prev[x], c = x >= 4 ? prev[x - 4] : 0;
      if (f === 1) line[x] = (line[x] + a) & 255;
      else if (f === 2) line[x] = (line[x] + b) & 255;
      else if (f === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    for (let x = 3; x < stride; x += 4) line[x] === 0 ? transparent++ : line[x] === 255 && opaque++;
    prev = line;
  }
  return { transparent, opaque, total: w * h };
}

async function newProject(page: Page, template: string) {
  await page.goto('/new');
  await page.setInputFiles('[data-testid=activity-input]', 'tests/fixtures/park-loop.gpx');
  await expect(page.getByTestId('stats-grid')).toBeVisible();
  await page.getByRole('button', { name: /Choose a template/ }).click();
  await page.getByTestId(`template-${template}`).click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.waitForTimeout(600);
}

const props = (page: Page) => page.getByTestId('layer-props');
const num = async (page: Page, label: string) => Number(await props(page).getByLabel(label, { exact: true }).inputValue());

async function selectLayer(page: Page, name: string) {
  await page.getByTestId('tab-layers').click();
  await page.getByTestId('layer-list').getByRole('button', { name, exact: true }).click();
  await expect(props(page)).toBeVisible();
}

test('drag, resize, undo/redo, reorder and persist across reload', async ({ page }) => {
  await newProject(page, 'minimal');
  await selectLayer(page, 'GPS route');
  const x0 = await num(page, 'X');
  const y0 = await num(page, 'Y');
  const w0 = await num(page, 'W');
  const stage = page.getByTestId('stage');
  const box = (await stage.boundingBox())!;
  const z = box.width / 1080;
  // Drag the route layer by its centre 100 doc-px to the right (Alt disables snapping).
  const cx = box.x + (x0 + w0 / 2) * z;
  const cy = box.y + (y0 + 100) * z;
  await page.keyboard.down('Alt');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 10 * z, cy, { steps: 1 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect.poll(() => num(page, 'X')).toBeCloseTo(x0 + 100, 0);
  await expect.poll(() => num(page, 'Y')).toBeCloseTo(y0, 0);

  // Resize from the east handle.
  const eHandle = page.locator('[data-handle="e"]');
  const hb = (await eHandle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 - 50 * z, hb.y + hb.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => num(page, 'W')).toBeCloseTo(w0 - 50, 0);

  // One undo per gesture.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => num(page, 'W')).toBeCloseTo(w0, 0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => num(page, 'X')).toBeCloseTo(x0, 0);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect.poll(() => num(page, 'X')).toBeCloseTo(x0 + 100, 0);

  // Reorder: bring to front → first row in the list (top = front).
  await props(page).getByRole('button', { name: 'Bring to front' }).click();
  await expect(page.getByTestId('layer-row').first()).toContainText('GPS route');

  // Style edit: route colour.
  await props(page).locator('input.font-mono').first().fill('#00aaff');

  // Stats toggle adds/removes a tile.
  await page.getByTestId('tab-stats').click();
  await page.getByTestId('stat-toggle-avgHr').check();
  await page.getByTestId('tab-layers').click();
  await expect(page.getByTestId('layer-list')).toContainText('Avg HR');

  await expect(page.getByTestId('save-status')).toBeVisible({ timeout: 10_000 });
  await shot(page, '05-edited');
  const url = page.url();
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  await selectLayer(page, 'GPS route');
  expect(await num(page, 'X')).toBeCloseTo(x0 + 100, 0);
  await expect(props(page).locator('input.font-mono').first()).toHaveValue('#00aaff');
  // New tiles are added on top, so the route is now second from the front.
  await expect(page.getByTestId('layer-row').nth(0)).toContainText('Avg HR');
  await expect(page.getByTestId('layer-row').nth(1)).toContainText('GPS route');

  // Appears on the projects page and can be duplicated / deleted.
  await page.goto('/projects');
  await expect(page.getByTestId('project-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.getByTestId('project-card')).toHaveCount(2);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Project actions' }).first().click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('project-card')).toHaveCount(1);
  expect(url).toContain('/editor/');
});

test('PNG export has exact dimensions; transparent PNG has a real alpha channel; background image upload', async ({ page }) => {
  await newProject(page, 'photo-overlay');
  await page.getByTestId('tab-uploads').click();
  await page.setInputFiles('[data-testid=media-input]', 'tests/fixtures/photo.jpg');
  await page.getByTestId('tab-layers').click();
  await expect(page.getByTestId('layer-list')).toContainText('Background photo');

  await page.getByTestId('open-export').click();
  // Opaque PNG at 1080×1920
  await page.getByTestId('format-png').click();
  await page.getByTestId('run-image-export').click();
  await expect(page.getByTestId('image-result-info')).toContainText('1080×1920');
  let dl = page.waitForEvent('download');
  await page.getByTestId('download-image').click();
  let png = readPng(readFileSync(await (await dl).path()));
  expect([png.width, png.height]).toEqual([1080, 1920]);
  let a = alphaStats(png);
  expect(a.transparent).toBe(0);
  expect(a.opaque).toBe(a.total);

  // Square preset (scaled to fit)
  await page.getByTestId('size-preset').selectOption('square');
  await page.getByTestId('run-image-export').click();
  await expect(page.getByTestId('image-result-info')).toContainText('1080×1080');

  // Transparent overlay: background photo + canvas background excluded.
  await page.getByTestId('size-preset').selectOption('canvas');
  await page.getByTestId('format-png-transparent').click();
  await page.getByTestId('run-image-export').click();
  await expect(page.getByTestId('alpha-report')).toContainText('fully transparent');
  dl = page.waitForEvent('download');
  await page.getByTestId('download-image').click();
  png = readPng(readFileSync(await (await dl).path()));
  expect([png.width, png.height, png.colorType, png.bitDepth]).toEqual([1080, 1920, 6, 8]); // RGBA8
  a = alphaStats(png);
  expect(a.transparent / a.total).toBeGreaterThan(0.3); // genuinely transparent pixels
  expect(a.opaque).toBeGreaterThan(1000); // the graphics themselves are opaque
  await shot(page, '06-export');

  // JPEG
  await page.getByTestId('format-jpeg').click();
  await page.getByTestId('run-image-export').click();
  await expect(page.getByTestId('image-result-info')).toContainText('image/jpeg');
});

test('video export produces a playable MP4 with the declared size, fps and duration', async ({ page }) => {
  test.setTimeout(240_000);
  await newProject(page, 'transparent-overlay');
  await page.getByTestId('tab-uploads').click();
  await page.setInputFiles('[data-testid=media-input]', 'tests/fixtures/clip.webm');
  await page.getByTestId('tab-layers').click();
  await expect(page.getByTestId('layer-list')).toContainText('Background video');
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-tab-video').click();
  await expect(page.getByTestId('video-capabilities')).not.toContainText('Checking');
  await page.getByTestId('video-duration').fill('2');
  await page.getByTestId('run-video-export').click();
  await expect(page.getByTestId('video-result')).toBeVisible({ timeout: 200_000 });
  await shot(page, '07-video');
  const info = await page.getByTestId('video-result-info').textContent();
  const dl = page.waitForEvent('download');
  await page.getByTestId('download-video').click();
  const d = await dl;
  const path = await d.path();
  expect(d.suggestedFilename()).toMatch(/\.mp4$/);
  if (SHOTS) copyFileSync(path, `${SHOTS}/export.mp4`);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-count_frames', '-of', 'json', path]).toString());
  expect(probe.format.format_name).toContain('mp4');
  const v = probe.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
  expect([v.width, v.height]).toEqual([1080, 1920]);
  expect(v.avg_frame_rate).toBe('30/1');
  expect(Number(v.nb_read_frames)).toBe(60);
  expect(Number(probe.format.duration)).toBeCloseTo(2, 0);
  const audio = probe.streams.find((s: { codec_type: string }) => s.codec_type === 'audio');
  expect(audio, 'background clip audio should be kept').toBeTruthy();
  // Fully decodable: ffmpeg must read every frame without errors.
  execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', path, '-f', 'null', '-']);
  console.log(`video: ${info} | codec ${v.codec_name} | audio ${audio?.codec_name}`);
});

test('cancelling a video export cleans up and allows retry', async ({ page }) => {
  await newProject(page, 'sporty');
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-tab-video').click();
  await expect(page.getByTestId('video-capabilities')).not.toContainText('Checking');
  await page.getByTestId('video-duration').fill('10');
  await page.getByTestId('run-video-export').click();
  await expect(page.getByTestId('video-progress')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('video-progress')).toBeHidden();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByTestId('video-duration').fill('1');
  await page.getByTestId('run-video-export').click();
  await expect(page.getByTestId('video-result')).toBeVisible({ timeout: 120_000 });
});
