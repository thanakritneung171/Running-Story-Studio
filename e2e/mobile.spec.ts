import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('mobile: import, pick template, adjust and export a PNG', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try with demo data' }).click();
  await expect(page.getByText('Demonstration data — not a real activity')).toBeVisible();
  await page.getByRole('button', { name: /Choose a template/ }).click();
  await page.getByTestId('template-dark-performance').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('stage')).toBeVisible();
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/08-mobile-editor.png` });
  await page.getByRole('button', { name: 'Design' }).click();
  await page.getByTestId('tab-stats').click();
  await page.getByTestId('stat-toggle-calories').check();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Export' }).click();
  await page.getByTestId('run-image-export').click();
  await expect(page.getByTestId('image-result-info')).toContainText('1080×1920');
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/09-mobile-export.png` });
});
