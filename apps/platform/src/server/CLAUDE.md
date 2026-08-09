# Конвенции внутренней раскладки серверных модулей — `src/server/`

Этот файл описывает **что лежит внутри серверного модуля**. Список самих модулей, граф импортов и registry-паттерн — в [ADR 0007](../../../../docs/adr/0007-arhitektura-proekta-moduli.md). Стек бэкенда (Express + Kysely + `pg` + dbmate + Zod) — в [ADR 0004](../../../../docs/adr/0004-stek-bekenda.md).

## Структура модуля

Каждый модуль внутри `src/server/` может содержать:

```
feature/
├── controllers/   # Express route handlers
├── middleware/    # Express middleware
├── services/      # бизнес-логика (если повторяется или сложная)
├── repositories/  # работа с БД через Kysely
├── lib/           # утилитарные функции
└── index.ts       # публичный API модуля: роуты, сервисы для регистрации в Registry
```

Не все директории обязательны — создавай только те что нужны. Модуль заводится по факту, не создавать пустой каркас заранее.

## Контроллеры (`controllers/`)

Обычные Express route handlers. Если бизнес-логика простая — она может быть прямо в контроллере. Если логика повторяется или становится сложной — выносить в `services/`.

Если контроллер принимает зависимости (сервисы через DI) — оборачивать в фабричную функцию с префиксом `create*`:

```ts
export const createGetProjectController =
  (projectService: ProjectService) =>
  async (req: Request, res: Response): Promise<void> => { ... };
```

Аналогично для роутеров: `createProjectsRouter`, `createAuthRouter`.

Валидация входа (`req.body`, `req.query`, `req.params`) — через Zod-схемы из `src/shared/` (шарятся с клиентом).

## Middleware (`middleware/`)

Обычные Express middleware. Модуль-специфичные — здесь; общие (auth, request-id, error handler) — в `application`-модуле или в `core`.

## Сервисы (`services/`)

- Если сервис используется только внутри своего модуля — не нужно регистрировать в `Registry`, создавать локально
- Если сервис нужен в другом модуле — регистрировать в `Registry` в модуле `application` и прокидывать как зависимость

## Репозитории (`repositories/`)

Паттерн Repository для работы с БД через Kysely — стандарт для всех модулей которые работают с данными.

**Обработка ошибок — через типизированные исключения, никаких `try/catch` в контроллерах.** Централизованный error-middleware в модуле `application` ловит все исключения и маппит их в HTTP-ответы. Репозитории и сервисы просто бросают понятные ошибки, контроллеры пишутся линейно.

```ts
// common/errors.ts — базовые типы ошибок, живут в модуле common
export class AppError extends Error { ... }
export class NotFoundError extends AppError { ... }         // → 404
export class ValidationError extends AppError { ... }       // → 400
export class UnauthorizedError extends AppError { ... }     // → 401
export class ForbiddenError extends AppError { ... }        // → 403
export class ConflictError extends AppError { ... }         // → 409

// repository — бросает NotFoundError если не найдено, БД-ошибки пузырятся
export async function getProjectById(db: Database, id: string) {
  const project = await db
    .selectFrom('projects')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  if (!project) throw new NotFoundError(`Project ${id} not found`);
  return project;
}

// controller — линейный код без try/catch
export const createGetProjectController =
  (db: Database) => async (req: Request, res: Response) => {
    const project = await getProjectById(db, req.params.id);
    res.json(project);
  };
```

Error-middleware в `application`:

- Знает про типы `AppError` из `common`, маппит в статусы (`NotFoundError` → 404, `ValidationError` → 400, и т.п.).
- Всё остальное (в том числе pg/Kysely-ошибки) — `500 Internal server error`, полный стек — в логгер.
- Не логгирует юзер-фейсинг ошибки (`4xx`) как ошибки — только `5xx`.

Если запрос возвращает 0 строк при UPDATE/DELETE там где строка должна существовать — проверять `numUpdatedRows` / `numDeletedRows` и бросать `NotFoundError` прямо в репозитории.

При необходимости обернуть async-handler в Express так, чтобы `throw` в промисе долетал до middleware (либо `express-async-errors`, либо тонкая обёртка `asyncHandler(fn)`) — детали имплементации, не CLAUDE.md.

## Registry и модуль `application`

- Межмодульные зависимости на сервере решаются через Registry (см. ADR 0007)
- Сервисы которые нужны нескольким модулям регистрируются в `Registry` в модуле `application`
- Модуль `application` содержит только регистрацию зависимостей, подключение роутов и SSR-обвязку — без бизнес-логики
- Registry на сервере — per-request (для request-scoped вещей типа `req-id` в логгере); singleton-инстансы (пул `pg`, HTTP-клиенты) переиспользуются между запросами

## `index.ts`

Экспортирует всё что нужно снаружи модуля: роуты для подключения в `application`, сервисы для регистрации в `Registry`.

## Тесты

- Co-location: `foo.ts` + `foo.test.ts` лежат рядом. Никаких `__tests__/`.

## Именование

| Что                                                   | Формат                       |
| ----------------------------------------------------- | ---------------------------- |
| Файлы кода (controllers, services, repositories, lib) | `camelCase.ts`               |
| Классы                                                | `PascalCase`                 |
| Папки модулей                                         | `kebab-case` или `camelCase` |
