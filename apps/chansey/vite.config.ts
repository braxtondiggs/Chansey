/// <reference types="vitest" />
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  return {
    root: __dirname,
    cacheDir: '../../node_modules/.vite/chansey',

    plugins: [nxViteTsPaths()],

    test: {
      globals: true,
      cache: {
        dir: '../../node_modules/.vitest/chansey',
      },
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
      reporters: ['default'],
      coverage: {
        reportsDirectory: '../../coverage/chansey',
        provider: 'v8',
      },
      setupFiles: ['src/test-setup.ts'],
    },

    define: {
      'import.meta.vitest': mode !== 'production',
    },
  };
});
