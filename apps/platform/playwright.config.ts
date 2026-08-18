import { defineConfig } from '@playwright/test';

/**
 * Playwright — слои 3–4 тестовой стратегии (docs/product/architecture/testing-strategy.md): реальный браузер и WebGL
 * для perf/leak-гвардов и E2E-смоука. Тесты — в `e2e/*.spec.ts` (не `*.test.ts`, чтобы не попадать под Jest).
 * Запуск: `pnpm --filter platform test:e2e` (или `pnpm test:e2e` из корня). Сервер: если dev-сервер уже поднят
 * (`pnpm dev`, порт 4000) — используется он; иначе конфиг сам собирает dev-бандл клиента и поднимает `pnpm dev`
 * (в CI — всегда сам). Dev-бандл собирается **до** старта сервера намеренно: `server.ts` читает имена бандлов из
 * `dist/client` при старте, а `pnpm dev` запускает клиентский watch параллельно серверу (гонка; задача 0040).
 * Гварды читают планер через dev-only событие `planner:ready` — нужен именно dev-бандл, не prod.
 * Требуется `apps/platform/.env` (dev-сервер стартует с `--env-file`) и Postgres из `infra/dev` — как для `pnpm dev`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'pnpm build:client:dev && pnpm dev',
    url: 'http://localhost:4000/api/v1/health',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
