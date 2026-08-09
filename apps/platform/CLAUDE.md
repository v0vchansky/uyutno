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

Как поднять и запустить локально — [`README.md`](./README.md).
