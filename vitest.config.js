// Test settings (kept apart from vite.config.js so tests don't load the dev server plugins).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.js'], environment: 'node' },
});
