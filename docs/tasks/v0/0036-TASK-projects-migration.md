# 0036 · TASK · Миграция `projects` + Kysely codegen

- Статус: [ ]
- Эпик: 0035
- Зависит от: 0006, 0007
- Спека: docs/tasks/v0/0035-EPIC-projects-screen.md
- Нужен дизайн: нет (миграция БД, дизайна нет)
- Дизайн: —
- PR: —

## Описание

Заводим таблицу `projects` — фундамент под весь эпик /projects. В v0 у проекта только название и метаданные; сцена (стены, мебель, камера) появится в эпике редактора и здесь не моделируется — под неё сейчас не резервируем колонок.

### Схема

Файл миграции — `apps/platform/db/migrations/YYYYMMDDHHMMSS_projects.sql`, оформление и стиль — как у существующих (см. `20260810120000_users.sql`).

Поля:

- `id UUID PRIMARY KEY` — генерируется на приложении (`crypto.randomUUID()`), не в БД.
- `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE` — при удалении пользователя чистим его проекты каскадом.
- `name TEXT NOT NULL` — имя проекта, ограничение длины валидируется на приложении (60 символов, см. `projects-screen.md`). CHECK на пустую строку — `CHECK (char_length(name) > 0)`, чтобы БД гарантировала непустоту.
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` — обновляется приложением при rename/duplicate; триггер не заводим (в проекте пока такого подхода нет — см. `users`).

Индексы:

- `CREATE INDEX projects_user_id_updated_at_idx ON projects (user_id, updated_at DESC)` — покрывает основной запрос «мои проекты, свежие сверху».

Миграция `down` — `DROP TABLE projects` без сохранения данных (v0-конвенция dbmate-миграций, см. существующие файлы).

### Codegen

После наката миграции — `pnpm --filter platform db:codegen` перегенерирует `src/server/postgres/db.generated.ts`, куда добавится запись `projects`. Файл коммитим (см. заметку в 0006).

### Что не делаем

- Репозиторий/сервис/роуты `projects` — задача 0037.
- Никаких колонок под сцену (`scene_json`, `thumbnail_url` и т.п.) — они не нужны в v0-скоупе экрана и появятся вместе с редактором.

## Приёмка

- [ ] `pnpm --filter platform db:up` накатывает миграцию на чистой БД без ошибок.
- [ ] `pnpm --filter platform db:down` откатывает её без ошибок.
- [ ] В `src/server/postgres/db.generated.ts` появилась запись `projects` с ожидаемым набором полей.
- [ ] `pnpm --filter platform typecheck` зелёный.
- [ ] Каскадное удаление проекта при удалении пользователя проверено вручную (через `psql` или интеграционный тест — на усмотрение автора; достаточно строки в «Заметках» с описанием проверки).

## Заметки

—
