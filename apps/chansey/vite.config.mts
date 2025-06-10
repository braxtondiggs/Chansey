/// <reference types="vitest" />
import angular from '@analogjs/vite-plugin-angular';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  return {
    root: __dirname,
    cacheDir: '../../node_modules/.vite/chansey',

    plugins: [angular(), nxViteTsPaths()],

    test: {
      globals: true,
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
      reporters: ['default'],
      coverage: {
        reportsDirectory: '../../coverage/chansey',
        provider: 'v8'
      },
      setupFiles: ['src/test-setup.ts'],
      testTimeout: 10000, // Increase timeout for CI
      hookTimeout: 10000, // Increase hook timeout
      teardownTimeout: 5000, // Add teardown timeout
      retry: process.env.CI ? 2 : 0, // Retry flaky tests in CI
      server: {
        deps: {
          inline: ['@ngneat/spectator']
        }
      },
      // Add pool options for better stability
      pool: 'forks',
      poolOptions: {
        forks: {
          singleFork: process.env.CI // Use single fork in CI for better stability
        }
      }
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler'
        }
      }
    },
    define: {
      'import.meta.vitest': mode !== 'production'
    }
  };
});
