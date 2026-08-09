# 0007 · TASK · Миграции: users, sessions, oauth_accounts, password_reset_tokens

- Статус: [x]
- Эпик: 0005
- Зависит от: 0006
- Спека: docs/adr/0006-shema-bd-v0.md
- PR: f0bb679 (прямой коммит в main)

## Описание

Завести четыре auth-таблицы одной пачкой миграций по [ADR 0006](../../adr/0006-shema-bd-v0.md), с учётом соглашений (UUID v7, snake_case, TIMESTAMPTZ, ON DELETE CASCADE, TEXT + CHECK вместо ENUM, ручные индексы на FK). Порядок файлов миграций: `users` → `sessions` → `oauth_accounts` → `password_reset_tokens`. По одной миграции на таблицу, каждая с `-- migrate:up` и `-- migrate:down`.

Таблица `projects` из ADR 0006 в этой задаче **не создаётся** — она вернётся в эпике проектов вместе с ADR по хранению сцены.

Скоуп:

- `users` — id (PK, UUID v7), email (UNIQUE, TEXT), password_hash (NULL), email_verified_at (NULL), created_at, updated_at.
- `sessions` — id (PK, TEXT — сам session_id), user_id (FK → users, CASCADE), expires_at, last_activity_at, created_at. Индексы: (user_id), (expires_at).
- `oauth_accounts` — id (PK, UUID v7), user_id (FK → users, CASCADE), provider (TEXT + CHECK IN ('yandex','vk')), provider_user_id (TEXT), created_at. Индексы: UNIQUE(provider, provider_user_id), UNIQUE(user_id, provider), (user_id).
- `password_reset_tokens` — id (PK, UUID v7), user_id (FK → users, CASCADE), token_hash (TEXT UNIQUE), expires_at, used_at (NULL), created_at. Индексы: UNIQUE(token_hash) авто, (user_id), (expires_at).
- Перегенерация TS-типов схемы (`db:codegen`), коммит `db.generated.ts` вместе с миграциями.
- Down-миграции реально работают: `db:down` каждой миграции откатывает её без остатков.

Все нюансы (нормализация email в коде, session_id без хеширования, token_hash sha256 — но всё это уже в коде задач 0011+/0014) — здесь только структура таблиц.

Вне скоупа:

- Таблица `projects` (отдельно в эпике проектов).
- Репозиторный слой и код нормализации email (в задачах, использующих таблицы).

## Приёмка

- [ ] Четыре миграции в `apps/platform/db/migrations/` — по одной на таблицу, в порядке из ADR 0006.
- [ ] `pnpm --filter platform db:up` с чистой БД проходит без ошибок и накатывает все четыре таблицы.
- [ ] `pnpm --filter platform db:down` откатывает каждую миграцию по одной, БД возвращается к пустому состоянию.
- [ ] Все ограничения и индексы из ADR 0006 присутствуют (`\d+ users` и т.п. в psql — визуальная проверка).
- [ ] `db.generated.ts` перегенерирован, содержит типы всех четырёх таблиц; typecheck проходит.

## Заметки

—
