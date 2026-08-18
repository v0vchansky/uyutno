import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Базовый конфиг Jest для всех воркспейсов (ADR 0014). Каждый воркспейс держит свой `jest.config.mjs`,
 * который расширяет этот (`...jestBaseConfig`) и задаёт только своё: `roots`, алиасы в `moduleNameMapper`.
 * Опции SWC — из корневого `.swcrc` (тот же файл, что у `swc-loader` в webpack платформы, ADR 0013):
 * один источник правды для парсера/JSX/target, дублирования инлайном нет.
 */

const swcrc = JSON.parse(readFileSync(fileURLToPath(new URL('./.swcrc', import.meta.url)), 'utf8'));

/** @type {import('jest').Config} */
export const jestBaseConfig = {
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    // ESM-стиль `import './foo.js'` → `./foo.ts` (ADR 0014).
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    // `swcrc: false` — не искать `.swcrc` от файла вверх: опции уже переданы явно из корневого файла.
    '^.+\\.(t|j)sx?$': ['@swc/jest', { ...swcrc, swcrc: false }],
  },
};
