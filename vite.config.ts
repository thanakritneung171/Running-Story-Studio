import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  server: {
    // `npm run dev:api` runs the Worker (D1 + R2 locally) on :8787.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  test: {
    include: ['tests/**/*.test.ts', 'worker-tests/**/*.test.ts'],
    environment: 'node',
  },
});
