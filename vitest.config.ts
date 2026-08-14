import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.spec.ts'],
    restoreMocks: true,
    clearMocks: true,
    pool: 'forks',
  },
})
