import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/e2e/**', 'node_modules/**'],
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/__tests__/**', 'src/**/e2e/**', 'dist/**', 'docs/**', 'node_modules/**', 'scripts/**'],
      reporter: ['text', 'text-summary'],
      thresholds: {
        branches: 78,
        functions: 85,
        lines: 84,
        statements: 84,
      },
    },
  },
})
