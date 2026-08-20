# 0006. Схема БД для v0: auth-таблицы и projects (без содержимого сцены)

- Статус: Принято
- Дата: 2026-08-08

## Решение

Минимальный набор таблиц под auth-модель ADR 0005 и оболочку проекта: `users`, `sessions`, `oauth_accounts`, `password_reset_tokens`, `projects` (только оболочка — id, владелец, имя, timestamps). Все пять — одной пачкой миграций до старта работы над фичами, чтобы дальше только наращивать. Реализация OAuth и password reset в коде — по плану v0 (см. `docs/product/release-v0.md`), таблицы заводим сразу.

За пределами ADR (отдельные ADR по факту):

- Хранение содержимого сцены — перед стартом редактора.
- Каталог мебели — перед Этапом 3.
- Демо-проект — ближе к реализации.
- История/undo, версии проекта, «корзина» — по запросу.

### Соглашения (для всех таблиц)

- **PK:** `UUID v7`, генерация в приложении (пакет `uuid` v10+). Не `gen_random_uuid()` (даёт v4), не `bigint serial`.
- **Naming:** `snake_case`, множественное число для таблиц (`users`, `projects`, `sessions`, `oauth_accounts`, `password_reset_tokens`).
- **Timestamps:** `TIMESTAMPTZ` (UTC-aware). Везде `created_at NOT NULL DEFAULT now()`. `updated_at` — только на реально мутирующих таблицах (`users`, `projects`), обновляется руками в коде (без триггеров БД).
- **Cascade:** `ON DELETE CASCADE` на всех FK к `users`.
- **Email:** `TEXT` + нормализация в коде (lowercase + trim перед insert/select). Без CITEXT extension.
- **Soft-delete:** нет. Всё hard-delete.
- **Индексы:** `UNIQUE` создают автоматически; на все FK — вручную (Postgres сам не создаёт).
- **Enum-подобные поля:** `TEXT` + `CHECK` constraint. Не PostgreSQL `ENUM` (`ALTER TYPE ... ADD VALUE` болезненно эволюционирует).
- **Файлы миграций:** одна миграция на одну таблицу. Порядок: `users` → `sessions` → `oauth_accounts` → `password_reset_tokens` → `projects`. Каждая с `-- migrate:up` и `-- migrate:down`.

### `users`

Учётка пользователя. Один email = одна учётка. `password_hash` nullable — OAuth-only юзеры без пароля, пока не установят его в настройках.

| Колонка             | Тип           | Ограничения              | Комментарий                                              |
| ------------------- | ------------- | ------------------------ | -------------------------------------------------------- |
| `id`                | `UUID`        | `PRIMARY KEY`            | UUID v7, генерируется в приложении                       |
| `email`             | `TEXT`        | `NOT NULL UNIQUE`        | Нормализуется (lowercase + trim) перед записью и поиском |
| `password_hash`     | `TEXT`        | `NULL`                   | argon2id-хеш; `NULL` для OAuth-only                      |
| `email_verified_at` | `TIMESTAMPTZ` | `NULL`                   | Заложено на будущее; на v0 не заполняется                |
| `created_at`        | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` |                                                          |
| `updated_at`        | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Обновляется в коде при мутации                           |

Индексы: `UNIQUE (email)` — автоматически.

### `sessions`

Server-side sessions из ADR 0005. `id` = сама случайная строка, которая живёт в cookie у пользователя (opaque, ≥32 байта энтропии, hex/base64url).

| Колонка            | Тип           | Ограничения                                       | Комментарий                                     |
| ------------------ | ------------- | ------------------------------------------------- | ----------------------------------------------- |
| `id`               | `TEXT`        | `PRIMARY KEY`                                     | Сам `session_id` из cookie                      |
| `user_id`          | `UUID`        | `NOT NULL REFERENCES users(id) ON DELETE CASCADE` |                                                 |
| `expires_at`       | `TIMESTAMPTZ` | `NOT NULL`                                        | Абсолютный дедлайн (rolling refresh продлевает) |
| `last_activity_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()`                          | Обновляется при активности для rolling TTL      |
| `created_at`       | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()`                          |                                                 |

Индексы:

- `(user_id)` — инвалидировать все сессии юзера (например, после password reset).
- `(expires_at)` — периодическая очистка протухших сессий (`DELETE FROM sessions WHERE expires_at < now()`).

**Session ID хранится как есть, без хеширования.** session_id никогда не публикуется наружу (живёт только в HttpOnly cookie); при компрометации БД злоумышленник получает более серьёзные последствия, чем возможность залогиниться. Хеширование добавит cost на каждый запрос без реального security-профита.

### `oauth_accounts`

Привязки локального пользователя к OAuth-провайдерам (Yandex ID, VK ID). Один юзер = несколько привязок, но не более одной на провайдера.

| Колонка            | Тип           | Ограничения                                       | Комментарий                                        |
| ------------------ | ------------- | ------------------------------------------------- | -------------------------------------------------- |
| `id`               | `UUID`        | `PRIMARY KEY`                                     | UUID v7                                            |
| `user_id`          | `UUID`        | `NOT NULL REFERENCES users(id) ON DELETE CASCADE` |                                                    |
| `provider`         | `TEXT`        | `NOT NULL CHECK (provider IN ('yandex', 'vk'))`   | Новый провайдер = миграция (drop + recreate CHECK) |
| `provider_user_id` | `TEXT`        | `NOT NULL`                                        | Идентификатор пользователя у провайдера            |
| `created_at`       | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()`                          |                                                    |

Индексы:

- `UNIQUE (provider, provider_user_id)` — быстрый lookup при OAuth-логине; один провайдерский аккаунт не привязан к двум локальным.
- `UNIQUE (user_id, provider)` — один юзер = максимум одна привязка на провайдера.
- `(user_id)` — для страницы настроек безопасности.

Токены провайдера (access_token, refresh_token) **не сохраняются** — по ADR 0005 используются только в момент callback'а.

### `password_reset_tokens`

Одноразовые токены сброса пароля из ADR 0005. В БД хранится **sha256-хеш** от raw токена (raw уходит в email; сохранение raw в БД повышает риск утечки через backups/логи).

| Колонка      | Тип           | Ограничения                                       | Комментарий                       |
| ------------ | ------------- | ------------------------------------------------- | --------------------------------- |
| `id`         | `UUID`        | `PRIMARY KEY`                                     | UUID v7                           |
| `user_id`    | `UUID`        | `NOT NULL REFERENCES users(id) ON DELETE CASCADE` |                                   |
| `token_hash` | `TEXT`        | `NOT NULL UNIQUE`                                 | sha256 от raw токена              |
| `expires_at` | `TIMESTAMPTZ` | `NOT NULL`                                        | TTL 1 час от `created_at`         |
| `used_at`    | `TIMESTAMPTZ` | `NULL`                                            | Повторное использование запрещено |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()`                          |                                   |

Индексы:

- `UNIQUE (token_hash)` — автоматически, основной lookup при переходе по ссылке.
- `(user_id)` — инвалидация всех reset-токенов юзера после успешной смены пароля.
- `(expires_at)` — периодическая очистка протухших.

### `projects`

Проект интерьера. **В v0 только структурная оболочка.** Хранение сцены (геометрия комнаты, объекты, материалы) — отдельный ADR перед реализацией редактора (`scene JSONB` целиком vs отдельные таблицы `project_walls` / `project_objects`).

| Колонка      | Тип           | Ограничения                                       | Комментарий                                 |
| ------------ | ------------- | ------------------------------------------------- | ------------------------------------------- |
| `id`         | `UUID`        | `PRIMARY KEY`                                     | UUID v7                                     |
| `user_id`    | `UUID`        | `NOT NULL REFERENCES users(id) ON DELETE CASCADE` |                                             |
| `name`       | `TEXT`        | `NOT NULL`                                        | Название проекта, отображаемое пользователю |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()`                          |                                             |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()`                          | Обновляется при любом изменении             |

Индексы: `(user_id)` — для страницы «мои проекты». Индексы под будущие поля (например, `(user_id, updated_at DESC)` для сортировки «последние изменённые») добавим вместе с этими полями.

**TODO для отдельного ADR:** хранение сцены, превью проекта, `last_opened_at`, механика демо-проекта (в БД через system-user + `is_demo` или seed-ом в коде).

## Почему

Каждая таблица напрямую вытекает из ADR 0005. UUID v7 (сортируемость по времени → лучше индексы, чем v4; не раскрывает порядок как `bigint serial`; генерация в приложении даёт ID до `INSERT` — удобно для логов, retry, идемпотентных операций). `TEXT` + нормализация email, а не CITEXT — не требуем extension, вся логика прозрачна в коде и покрывается тестами; CITEXT медленнее обычного TEXT на индексах. `updated_at` руками — триггеры прячут мутацию (при debug'е неочевидно, почему изменился), тесты усложняются. Hard-delete — на v0 нет запроса на корзину; soft-delete добавляет `WHERE deleted_at IS NULL` в каждый запрос (риск забыть). `TEXT + CHECK` вместо `ENUM` — `ALTER TYPE ... ADD VALUE` не работает внутри транзакции с использованием значения, миграции хрупкие; Kysely-типы enum'ов пишутся руками в TS независимо от типа в БД. `session_id` не хешируется, а reset token — хешируется: разный attack surface (cookie в HttpOnly vs email/logs/backups).

## Что важно знать

- **`projects` без содержимого сцены не даёт реального функционала** — только «создать пустой проект». Полноценный редактор требует отдельного ADR перед Этапом 2.
- **Ручное обновление `updated_at`** — риск забыть в новом коде. Компенсируется общей обёрткой в repository-функциях, когда появятся.
- **`ON DELETE CASCADE` для `projects`** мгновенно уничтожит все проекты при удалении юзера. Если появится требование «сохранить проекты при удалении аккаунта» — переделывать через soft-delete + отвязку.
- **CHECK на `provider`** обновляется миграцией при добавлении нового OAuth-провайдера. Приемлемо: провайдеры добавляются редко.
- **`sessions.id` как opaque строка** — при отладке в БД её нельзя сопоставить со «своей» сессией без cookie в браузере.
