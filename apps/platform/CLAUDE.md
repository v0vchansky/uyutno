# `apps/platform` — конвенции

Единое приложение uyutno: Express + React SSR (клиент и сервер в одном процессе). См. ADR 0003, 0004.

## Раскладка кода

- `src/client/` — клиентские модули. Конвенции: [`src/client/CLAUDE.md`](./src/client/CLAUDE.md).
- `src/server/` — серверные модули. Конвенции: [`src/server/CLAUDE.md`](./src/server/CLAUDE.md).
- `src/shared/` — изоморфный код: Zod-схемы API, типы, константы. Без Node-only и без DOM-only API.
- `db/migrations/` — SQL-миграции dbmate.
- `webpack/` — конфиги webpack (клиент + сервер).
- `public/` — статика.

## Общие конвенции TypeScript

Применимо и к клиенту, и к серверу.

- **Типы и интерфейсы живут рядом с использованием, не в `types.ts`.** Отдельный `types.ts`, куда сваливаются все типы модуля, — антипаттерн: разрывает связь между кодом и его формой, ухудшает читаемость, накапливает мёртвые типы. Тип объявляется в том же файле, где используется. Если нужен в нескольких файлах модуля — экспортируется из «главного» файла соответствующей сущности (например, тип `Project` — рядом с самой сущностью, а не в `project/types.ts`).
- **Константы — там же, где используются, не в `constants.ts`.** Та же логика: `constants.ts` превращается в свалку разнородных значений без контекста. Константа объявляется в том же файле, что её основное использование; при необходимости — экспортируется.
- **Циклические импорты на уровне типов — норма.** `import type` не создаёт runtime-зависимости и выпиливается компилятором. Если из-за естественной раскладки типов рядом с использованием появляется циклический `import type` — оставляем, не рефакторим ради избавления. Циклические runtime-импорты — по-прежнему плохо, избегаем как обычно.

## Тесты

Раннер — **Jest** через `@swc/jest` ([ADR 0014](../../docs/adr/0014-testovyy-runner-jest-swc.md)). Конфиг платформы — [`jest.config.mjs`](./jest.config.mjs) (покрывает и клиент, и сервер) поверх общего базового `jest.config.base.mjs` в корне монорепы; опции SWC — из корневого `.swcrc` (тот же файл, что у webpack, ADR 0013).

- **Co-location**: `foo.ts` + `foo.test.ts` лежат рядом, без директорий `__tests__/`.
- **API**: `describe` / `it` / `expect` из глобалов jest. Не использовать `node:test`.
- **Test environment**: `node` по умолчанию. Клиентским тестам с DOM — прописывать `/** @jest-environment jsdom */` в шапке файла.
- **Path aliases** (`@app/*`, `@server/*`) продублированы в `jest.config.mjs` (`moduleNameMapper`), потому что jest не читает `tsconfig.paths`. При добавлении новых aliases — синхронизировать оба места.
- **Type-check тестов** идёт через `pnpm typecheck`, не через `pnpm test` — SWC стирает типы без проверки. Ошибки типов в тестах не завалят `pnpm test`, но завалят typecheck и pre-commit.
- Запуск: `pnpm --filter platform test` (только платформа) или `pnpm test` в корне (все воркспейсы, включая `packages/planner`).
- **Playwright (слои 3–4 [testing-strategy](../../docs/product/architecture/testing-strategy.md))** — `apps/platform/e2e/*.spec.ts` (не `*.test.ts`, чтобы не попадать под Jest), конфиг `playwright.config.ts`, свой `e2e/tsconfig.json` в `typecheck`. Запуск `pnpm --filter platform test:e2e` / `pnpm test:e2e` из корня; поднятый dev-сервер переиспользуется. Perf/leak-гварды планера читают экземпляр через dev-only событие `planner:ready` (`project/lib/plannerReadyEvent.ts`), не через `window.__*`.

## Что смотреть перед началом работы

- [ADR 0007](../../docs/adr/0007-arhitektura-proekta-moduli.md) — модули, граф импортов, registry-паттерн.
- [ADR 0003](../../docs/adr/0003-stek-frontenda.md) — стек фронтенда.
- [ADR 0004](../../docs/adr/0004-stek-bekenda.md) — стек бэкенда.
- [ADR 0005](../../docs/adr/0005-model-autentifikatsii.md) — модель аутентификации.
- [ADR 0006](../../docs/adr/0006-shema-bd-v0.md) — схема БД.
- [ADR 0009](../../docs/adr/0009-frontend-ui-stek-tailwind-v4-heroui-v3.md) — версии UI-стека (Tailwind v4, HeroUI v3, React 19).
- [ADR 0010](../../docs/adr/0010-path-aliases-app-server.md) — path aliases `@app/*` / `@server/*`.
- [ADR 0011](../../docs/adr/0011-linter-i-formatter-eslint-prettier.md) — линтер и форматтер (ESLint 10 flat config + Prettier 3).
- [ADR 0012](../../docs/adr/0012-git-hooks-husky.md) — git-хуки (husky + lint-staged, pre-commit).
- [ADR 0013](../../docs/adr/0013-transpilyator-swc.md) — транспилятор (SWC вместо Babel).
- [Гайдлайн интерфейса](../../docs/ui/guidelines.md) — правила по UI (шкала отступов, типографика, цвет, компоновка); токены темы — в [`src/client/theme-uyutno.css`](./src/client/theme-uyutno.css).

Как поднять и запустить локально — [`README.md`](./README.md).
