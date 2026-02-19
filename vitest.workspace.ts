import { defineWorkspace } from 'vitest/config'
import path from 'node:path'

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'unit',
      environment: 'happy-dom',
      include: ['src/**/*.test.ts'],
      exclude: ['src/**/*.browser.test.ts'],
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'browser',
      include: ['src/**/*.browser.test.ts'],
      browser: {
        enabled: true,
        provider: 'playwright',
        instances: [
          { browser: 'chromium' },
        ],
        headless: true,
      },
    },
  },
])
