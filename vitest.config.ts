import { defineConfig } from 'vitest/config';

/**
 * Kök yapılandırma — her paket kendi vitest.config.ts'ini bir "project" olarak sağlar.
 * (Vitest 3.2'de `vitest.workspace.ts` yerine `test.projects` kullanılıyor.)
 *
 * Tümünü çalıştır:  pnpm vitest run
 * Tek paket:        pnpm vitest run --project contracts
 */
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
  },
});
