import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Use the pre-installed Chromium when the bundled Playwright browser is not downloaded.
const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = process.env.PW_CHROMIUM ?? (existsSync(preinstalled) ? preinstalled : undefined);

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    launchOptions: { executablePath, args: ['--enable-unsafe-swiftshader'] },
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'npx vite build && npx vite preview --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: true, timeout: 120_000 },
});
