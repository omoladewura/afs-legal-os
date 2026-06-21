/**
 * vitest.config.ts
 *
 * Inherits Vite's plugin + alias setup so '@/' paths resolve identically
 * in tests as they do at build time. No separate tsconfig required.
 *
 * Install:
 *   npm install -D vitest @vitest/ui
 *
 * Run:
 *   npx vitest run                  # CI / one-shot
 *   npx vitest                      # watch mode
 *   npx vitest --ui                 # browser UI
 *   npx vitest run --coverage       # coverage report (add @vitest/coverage-v8)
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      // Mirror the alias in vite.config.ts exactly
      '@': path.resolve(__dirname, './src'),
    },
  },

  test: {
    // jsdom gives us a DOM environment for any component tests added later.
    // Pure logic tests (SynthesisEngine.test.ts) don't need it but it doesn't hurt.
    environment: 'jsdom',

    // Don't require explicit `import { describe, it, expect }` if we ever add globals later.
    // Currently imports are explicit (preferred for type-safety).
    globals: false,

    // Only run files matching this pattern — keeps CI fast.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],

    // Inline CSS modules without needing a separate transform
    css: false,
  },
});
