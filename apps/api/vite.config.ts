import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/api',

  plugins: [
    nxViteTsPaths(),
    swc.vite({
      module: { type: 'es6' }
    })
  ],
  define: {
    global: 'globalThis'
  },

  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/api',
      provider: 'v8'
    },
    setupFiles: ['reflect-metadata']
  }
});
