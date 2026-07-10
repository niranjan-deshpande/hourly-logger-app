import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// The capture parser is pure renderer-side TypeScript. Mirror the
// electron.vite.config.ts aliases so tests resolve @shared / @ the same
// way the app does.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
