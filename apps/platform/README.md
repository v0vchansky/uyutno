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
pnpm --filter platform db:migrate

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
