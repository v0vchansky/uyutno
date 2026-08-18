# 0014. Тестовый раннер: Jest + @swc/jest

- Статус: Принято
- Дата: 2026-08-10

## Решение

- **Раннер юнит-тестов**: **Jest 30** (`jest`, `@types/jest`).
- **Транспиляция TS/TSX в тестах**: `@swc/jest` — тот же SWC, что и в webpack-сборке (ADR 0013), без отдельного babel/ts-jest.
- Конфиг — общий базовый `jest.config.base.mjs` в корне монорепы (transform через `@swc/jest` с опциями из корневого `.swcrc`, `testMatch`, ESM-маппинг `.js`); каждый воркспейс держит свой `jest.config.mjs`, который расширяет базовый и задаёт `roots`/алиасы: `apps/platform/jest.config.mjs` (клиент + сервер, `@app/*`/`@server/*`) и `packages/planner/jest.config.mjs`. `pnpm test` в корне = `pnpm -r test`.
- **Co-location**: `foo.ts` + `foo.test.ts` лежат рядом, без директорий `__tests__/`.
- **Test environment**: `node` по умолчанию. Клиентские тесты, которым нужен DOM, включают `/** @jest-environment jsdom */` в шапке файла (пока таких нет).
- Запуск: `pnpm test` (корень, все воркспейсы) или `pnpm --filter platform test` / `pnpm --filter @uyutno/planner test`.

## Почему

Пробовали `node:test` — встроенный раннер Node 22 без внешних зависимостей. Уперлись в связку с TypeScript: `@swc-node/register` (нужен, чтобы `node:test` понимал `.ts`) конфликтует с TypeScript 7 (`Cannot read properties of undefined (reading 'Js')`), а без него `node:test` не запускает TS-файлы напрямую. Тратить время на воркэраунды ради «zero-deps» не окупается.

Jest — дефолт индустрии, экосистема (снэпшоты, моки, watch-mode, `expect`-матчеры) готова из коробки. `@swc/jest` даёт нативную SWC-транспиляцию — та же скорость и та же конфигурация парсера, что уже используется в webpack-сборке (ADR 0013). Никаких `babel-jest` и `ts-jest` в дереве зависимостей.

Vitest не рассматривали: он ориентирован на Vite-сборку, а у нас webpack. Тащить второй сборочный тулчейн только ради раннера — избыточно.

## Что важно знать

- **SWC-транспиляция в jest = нет type-check в тестах.** Как и в основной сборке — типы стирает без проверки. Type-check тестов идёт через `pnpm --filter platform typecheck` (в него уже включены `.test.ts` файлы). Ошибки типов в тестах не завалят `pnpm test`, но завалят typecheck и pre-commit.
- **`@types/jest` подключены только в серверном `tsconfig.json`** (`types: ["node", "jest"]`), потому что все текущие тесты — серверные. Когда появятся клиентские тесты, добавить `"jest"` и в `src/client/tsconfig.json`.
- **Module resolution в тестах — через `moduleNameMapper`**, а не через `tsconfig.paths`: jest не читает tsconfig. Алиасы `@app/*` и `@server/*` продублированы в `jest.config.mjs`. При добавлении новых path aliases — синхронизировать в обоих местах.
- **ESM-специфика**: `moduleNameMapper` включает правило `^(\\.{1,2}/.*)\\.js$` → без расширения, чтобы `import './foo.js'` (ESM-стиль) резолвился в `./foo.ts` в тестах.
