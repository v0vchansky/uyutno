# 0006 · TASK · Инфра БД: pg + Kysely + dbmate + кодоген типов

- Статус: [~]
- Эпик: 0005
- Зависит от: —
- Спека: docs/product/features/auth.md
- PR: —

## Описание

Поднять серверный слой работы с PostgreSQL: подключение пула `pg`, обёртка Kysely с типизированной схемой, миграционный инструмент dbmate, кодоген TS-типов из схемы БД. Без этого ни одна auth-задача не сдвинется — репозиториям нужен рабочий DB-слой.

Скоуп:

- Добавить зависимости: `pg`, `kysely`, `dbmate` (или его npm-обёртка), генератор типов (`kysely-codegen` или аналог — выбрать по совместимости с pg 16+ и ES-модулями проекта).
- Создать директорию `apps/platform/db/migrations/` (см. ADR 0007 — `db/` на уровне `apps/platform/`, не в `src/server/`).
- Реализовать модуль `src/server/postgres/` с фабрикой пула `pg.Pool` и инстансом Kysely (`Database` — тип, `db` — инстанс). Пул singleton на процесс, конфиг из `process.env.DATABASE_URL` с дев-дефолтом (без формального env-слоя, см. ADR 0007 «Env-переменные»). БД-слой живёт в отдельном модуле, а не в `core`.
- Скрипты в `apps/platform/package.json`: `db:new` (создать миграцию), `db:up`, `db:down`, `db:status`, `db:codegen` (перегенерировать TS-типы схемы).
- Сгенерированный файл типов (`src/server/postgres/db.generated.ts`) — коммитим в репо, чтобы typecheck работал сразу после `pnpm install`.
- Пример пустой миграции (или самый первый файл — заглушка) для проверки цепочки. Основные миграции — в задаче 0007.
- Локальная разработка: инструкция в `apps/platform/README.md` — как поднять Postgres (docker compose-файл в `infra/` или локальный `postgres` — выбрать простейший вариант) и накатить миграции.

Вне скоупа:

- Сами миграции таблиц (в задаче 0007).
- Репозиторный слой конкретных сущностей (в задачах 0011+).
- Формальный env-loader и валидация env (см. ADR 0007, откладывается).
- Продовые кредлы и деплой БД.

## Приёмка

- [x] `pnpm --filter platform db:up` накатывает миграции на локальный Postgres без ошибок.
- [x] `pnpm --filter platform db:codegen` перегенерирует `db.generated.ts` без диффа (после пустой миграции).
- [x] В `src/server/postgres/` есть экспорт типа `Database` (Kysely-схема) и singleton-инстанса `db`.
- [x] Простой health-check через Kysely (`select 1`) отрабатывает — либо в тесте, либо в отдельной проверочной ручке (по усмотрению исполнителя).
- [x] Инструкция по запуску локальной БД зафиксирована в `apps/platform/README.md`.

## Заметки

- Инфра-починка (не в исходном скоупе задачи, но без неё Postgres не поднимался): в `infra/dev/docker-compose.yml` том монтировался в `/var/lib/postgresql/data` (конвенция pg17), а образ `postgres:18-alpine` требует монтирование в `/var/lib/postgresql` — иначе контейнер уходит в crashloop. Исправлено.
- `kysely-codegen@0.20` (CJS) не работает с `kysely@0.29` (ESM-only) на Node 20 — падает с `ERR_REQUIRE_ESM`. На требуемом проектом Node 22 (см. `apps/platform/README.md`) работает через `--experimental-require-module`, включённый по умолчанию.
- `kysely-codegen` по умолчанию включает служебную таблицу `schema_migrations` (dbmate) в тип `DB`. Исключено флагом `--exclude-pattern 'public.schema_migrations'`.
- Добавлен ESLint-override для `**/*.generated.ts`, снимающий `@typescript-eslint/no-empty-object-type` (пока схема пустая, `interface DB {}` — валидный вывод codegen; после первой таблицы правило снова сработает по существу, но уже не на пустом интерфейсе).
- `src/server/postgres/` — новый серверный модуль, не перечисленный в таблице модулей ADR 0007. Если считать его полноценным модулем (а не под-либой в `core`), таблицу и граф импортов в ADR 0007 стоит обновить отдельным PR.
