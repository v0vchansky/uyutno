# apps/platform

Единое приложение uyutno: Express + React SSR в одном процессе. Обслуживает лендинг, личный кабинет и редактор проектов.

Архитектурные детали и конвенции — в [`CLAUDE.md`](./CLAUDE.md) и [ADR](../../docs/adr/). Этот файл — только про то, как поднять и запустить локально.

## Требования

- **Node.js 22 LTS** (`nvm install 22`)
- **pnpm 9.x** (через Corepack: `corepack enable`)
- **Docker** (Docker Desktop или colima) — для локального PostgreSQL

Конкретные версии зафиксированы в `package.json` (`engines`, `packageManager`).

## Первый запуск

```bash
# из корня репозитория
pnpm install

# PostgreSQL в докере (postgres:18-alpine)
docker compose -f infra/dev/docker-compose.yml up -d

# миграции схемы
pnpm --filter platform db:up

# dev-сервер
pnpm --filter platform dev
```

Приложение поднимается на `http://localhost:4000`.

## Dev-сервер

- Порт: **4000** (HTTP).
- HTTPS локально не поднимаем: Yandex ID и VK ID разрешают `http://localhost` в redirect URI как исключение для dev. Если позже упрёмся в кейс, где браузер требует secure context (cross-site cookies и т.п.), добавим `mkcert` точечно.

## PostgreSQL

- Образ: `postgres:18-alpine`.
- Конфиг: [`infra/dev/docker-compose.yml`](../../infra/dev/docker-compose.yml).
- Данные — в docker-volume. Полный сброс: `docker compose -f infra/dev/docker-compose.yml down -v`.
- В проде PostgreSQL живёт на сервере (bash + systemd, без докера). Докер — только инструмент dev-среды.
- Строка подключения по умолчанию — `postgres://uyutno:uyutno@localhost:5432/uyutno` (соответствует docker-compose). Переопределяется через `DATABASE_URL`.

## Миграции и типы БД

Миграции — через [dbmate](https://github.com/amacneil/dbmate), файлы в [`db/migrations/`](./db/migrations/). Типы TS-схемы генерируются [`kysely-codegen`](https://github.com/RobinBlomberg/kysely-codegen) в [`src/server/postgres/db.generated.ts`](./src/server/postgres/db.generated.ts) — файл коммитится в репу.

| Команда                             | Что делает                                             |
| ----------------------------------- | ------------------------------------------------------ |
| `pnpm --filter platform db:new`     | создать новую миграцию (`<timestamp>_<name>.sql`)      |
| `pnpm --filter platform db:up`      | накатить все pending-миграции                          |
| `pnpm --filter platform db:down`    | откатить последнюю применённую миграцию                |
| `pnpm --filter platform db:status`  | показать список миграций и их состояние                |
| `pnpm --filter platform db:codegen` | перегенерировать `db.generated.ts` из текущей схемы БД |

После любого изменения схемы миграцией нужно прогнать `db:codegen` и закоммитить обновлённый `db.generated.ts` в одном PR с миграцией.

## Тесты

Юнит-тесты — на **Jest** через `@swc/jest` (ADR [0014](../../docs/adr/0014-testovyy-runner-jest-swc.md)). Файлы лежат рядом с кодом (`foo.ts` + `foo.test.ts`), без `__tests__/`.

| Команда                                  | Что делает                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm --filter platform test`            | прогнать все тесты один раз                                                           |
| `pnpm --filter platform test -- --watch` | watch-mode, перезапуск на изменения                                                   |
| `pnpm --filter platform test:e2e`        | Playwright: perf/leak-гварды и E2E-смоук (`e2e/*.spec.ts`), реальный Chromium + WebGL |

Type-check тестов идёт отдельно через `pnpm --filter platform typecheck` — jest типы не проверяет.

Playwright-тесты (`e2e/`, конфиг `playwright.config.ts`) используют уже поднятый dev-сервер на 4000, а без него сами собирают dev-бандл клиента и запускают `pnpm dev` (нужны `.env` и Postgres, как для `pnpm dev`). Браузер — `pnpm exec playwright install chromium` один раз.

## Ручная проверка и тестовые данные

Тестовые учётки для локального прогона (login, гарды, `/auth/me`) — в [`docs/testing.md`](../../docs/testing.md).

## Переменные окружения

В dev `dev:server` запускает `node --env-file=./.env`, поэтому `apps/platform/.env` подхватывается автоматически (нативный Node ≥20, без пакета `dotenv`). Значения из шелла имеют приоритет над `.env`. В prod (`pnpm start`) `.env` не читается — переменные ожидаются в окружении.

| Переменная                   | Обязательна | Дефолт (dev)                                     | Назначение                                                                                                    |
| ---------------------------- | ----------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                   | нет         | `development`                                    | Влияет на флаги cookie (`Secure` включается в `production`) и на fallback-секреты                             |
| `DATABASE_URL`               | нет         | `postgres://uyutno:uyutno@localhost:5432/uyutno` | Строка подключения к PostgreSQL                                                                               |
| `PUBLIC_BASE_URL`            | нет         | `http://localhost:4000`                          | Базовый URL сервера, используется для построения OAuth-`redirect_uri` (`${PUBLIC_BASE_URL}/auth/callback/…`)  |
| `YANDEX_OAUTH_CLIENT_ID`     | для OAuth   | —                                                | `client_id` приложения Yandex ID. Если пусто — эндпоинты `/api/v1/auth/oauth/yandex/*` и колбэк вернут 404    |
| `YANDEX_OAUTH_CLIENT_SECRET` | для OAuth   | —                                                | `client_secret` того же приложения                                                                            |
| `OAUTH_STATE_SECRET`         | в prod      | `uyutno-dev-oauth-state-secret` (только dev)     | Секрет для HMAC-подписи short-lived cookie `oauth_state` (state + `from`). В prod требуется явно ≥16 символов |

### Локальный запуск с Yandex OAuth

1. Зарегистрировать приложение в кабинете Yandex OAuth (задача 0010). Redirect URI для dev: `http://localhost:4000/auth/callback/yandex`.
2. Прописать креды в `apps/platform/.env`:
   ```
   YANDEX_OAUTH_CLIENT_ID=<client id>
   YANDEX_OAUTH_CLIENT_SECRET=<client secret>
   ```
   и запустить `pnpm --filter platform dev`. Альтернативно — экспортировать те же переменные в шелл (значения из шелла перекрывают `.env`).
3. Открыть `http://localhost:4000/login`, нажать «Yandex ID» — редирект на `oauth.yandex.ru`.

Если `YANDEX_OAUTH_CLIENT_ID`/`SECRET` не заданы, сервер стартует, но при старте выведет warning и `/api/v1/auth/oauth/yandex/start` будет отвечать 404. На клиенте в этом случае кнопка «Yandex ID» на `/login` и `/register` не рендерится: SSR прокидывает в `window.__INITIAL_STATE__.oauthEnabledProviders` фактически включённые провайдеры (валидная ситуация только в dev без OAuth).
