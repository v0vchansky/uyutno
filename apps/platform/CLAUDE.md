# `apps/platform` — конвенции

Единое приложение uyutno: Express + React SSR (клиент и сервер в одном процессе). См. ADR 0003, 0004.

## Раскладка кода

- `src/client/` — клиентские модули. Конвенции: [`src/client/CLAUDE.md`](./src/client/CLAUDE.md).
- `src/server/` — серверные модули. Конвенции: [`src/server/CLAUDE.md`](./src/server/CLAUDE.md).
- `src/shared/` — изоморфный код: Zod-схемы API, типы, константы. Без Node-only и без DOM-only API.
- `db/migrations/` — SQL-миграции dbmate.
- `webpack/` — конфиги webpack (клиент + сервер).
- `public/` — статика.

## Что смотреть перед началом работы

- [ADR 0007](../../docs/adr/0007-arhitektura-proekta-moduli.md) — модули, граф импортов, registry-паттерн.
- [ADR 0003](../../docs/adr/0003-stek-frontenda.md) — стек фронтенда.
- [ADR 0004](../../docs/adr/0004-stek-bekenda.md) — стек бэкенда.
- [ADR 0005](../../docs/adr/0005-model-autentifikatsii.md) — модель аутентификации.
- [ADR 0006](../../docs/adr/0006-shema-bd-v0.md) — схема БД.
- [ADR 0009](../../docs/adr/0009-frontend-ui-stek-tailwind-v4-heroui-v3.md) — версии UI-стека (Tailwind v4, HeroUI v3, React 19).
- [ADR 0010](../../docs/adr/0010-path-aliases-app-server.md) — path aliases `@app/*` / `@server/*`.
- [ADR 0011](../../docs/adr/0011-linter-i-formatter-eslint-prettier.md) — линтер и форматтер (ESLint 10 flat config + Prettier 3).
- [ADR 0012](../../docs/adr/0012-git-hooks-lefthook.md) — git-хуки (lefthook + lint-staged, pre-commit).

Как поднять и запустить локально — [`README.md`](./README.md).
