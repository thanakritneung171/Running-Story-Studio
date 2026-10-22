import { test, expect } from '@playwright/test';

// Runs against `wrangler dev` (Worker + local D1/R2): E2E_CLOUD=1 E2E_BASE_URL=http://127.0.0.1:8788
test.skip(!process.env.E2E_CLOUD, 'cloud tests need the Worker running (E2E_CLOUD=1)');

const KEY = 'e2e_cloud_sync_key_' + 'k'.repeat(30) + Date.now();

test('cloud sync: save on one device, reopen on another with the same sync key', async ({ browser }) => {
  const a = await browser.newContext();
  await a.addInitScript((k) => {
    localStorage.setItem('rss.deviceKey', k);
    localStorage.setItem('rss.cloudSync', '1');
  }, KEY);
  const p1 = await a.newPage();
  await p1.goto('/new');
  await p1.setInputFiles('[data-testid=activity-input]', 'tests/fixtures/straight-5k.fit');
  await expect(p1.getByTestId('stats-grid')).toContainText('5.00');
  await p1.getByRole('button', { name: /Choose a template/ }).click();
  await p1.getByTestId('template-editorial').click();
  await expect(p1.getByTestId('editor')).toBeVisible();
  await p1.getByTestId('tab-uploads').click();
  await p1.setInputFiles('[data-testid=media-input]', 'tests/fixtures/photo.jpg');
  await p1.getByTestId('tab-layers').click();
  await expect(p1.getByTestId('layer-list')).toContainText('Background photo');
  await expect(p1.getByText('Unsaved changes')).toBeHidden({ timeout: 15_000 });
  await expect(p1.getByTestId('save-status')).toContainText('Saved to cloud', { timeout: 15_000 });
  const url = p1.url();
  await a.close();

  // Fresh browser profile = nothing in IndexedDB.
  const b = await browser.newContext();
  await b.addInitScript((k) => {
    localStorage.setItem('rss.deviceKey', k);
    localStorage.setItem('rss.cloudSync', '1');
  }, KEY);
  const p2 = await b.newPage();
  await p2.goto('/projects');
  await expect(p2.getByTestId('project-card')).toHaveCount(1);
  await p2.goto(url);
  await expect(p2.getByTestId('editor')).toBeVisible();
  await p2.getByTestId('tab-layers').click();
  await expect(p2.getByTestId('layer-list')).toContainText('Background photo');
  await expect(p2.getByTestId('layer-list')).toContainText('Title');
  await b.close();

  // A different key sees nothing.
  const c = await browser.newContext();
  await c.addInitScript(() => localStorage.setItem('rss.cloudSync', '1'));
  const p3 = await c.newPage();
  await p3.goto('/projects');
  await expect(p3.getByText('No projects yet.')).toBeVisible();
  await p3.goto(url);
  await expect(p3.getByText(/Project not found/)).toBeVisible();
  await c.close();
});
