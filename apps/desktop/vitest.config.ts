import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Several integration tests inspect the real Windows model paths and
    // shared SQLite state; run files serially so those checks are deterministic.
    maxWorkers: 1,
    minWorkers: 1,
    // Skill/tool contract tests genuinely scan the real home skill library
    // (thousands of SKILL.md dirs on a real dev machine), which exceeds the
    // 5s default. Raise it rather than weakening the assertions.
    testTimeout: 30000,
    hookTimeout: 30000,
    passWithNoTests: true,
    setupFiles: ['tests/setup.ts']
  },
  // Web components use the automatic JSX runtime (no `import React`) —
  // match Next.js/SWC behavior so UI tests can render them.
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    // `@shared` = desktop shared types; `@/*` = desktop Electron renderer source
    // (regex so scoped packages like `@testing-library` still resolve).
    alias: [
      { find: '@shared', replacement: resolve(__dirname, 'src/shared') },
      { find: /^@\//, replacement: `${resolve(__dirname, 'src/renderer/src')}/` },
    ],
  }
})
