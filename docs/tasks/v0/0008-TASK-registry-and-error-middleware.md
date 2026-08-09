# 0008 · TASK · Registry + error-middleware + common/errors

- Статус: [x]
- Эпик: 0005
- Зависит от: —
- Спека: docs/adr/0007-arhitektura-proekta-moduli.md
- PR: —

## Описание

Завести общую инфраструктурную обвязку из [ADR 0007](../../adr/0007-arhitektura-proekta-moduli.md), без которой невозможно чисто разложить auth-модуль:

1. **Registry в `common`** — тип `Registry` (запись из инстансов общих сервисов, включая `AuthService`), React context `RegistryContext`, хук `useRegistry()`. Сам инстанс собирается в `application`. На клиенте — синглтон при бутстрапе; на сервере — per-request (если нужен request-scoped контекст, например `req-id` в логгере). Стабильный по референсу.
2. **Базовые ошибки в `common`** — иерархия `AppError` и наследников: `NotFoundError` (404), `ValidationError` (400), `UnauthorizedError` (401), `ForbiddenError` (403), `ConflictError` (409). Ровно как в [`src/server/CLAUDE.md`](../../../apps/platform/src/server/CLAUDE.md). Живут в `src/server/common/errors.ts`; клиентская копия — по мере необходимости в последующих задачах.
3. **Error-middleware в `application`** — ловит все исключения из контроллеров, маппит `AppError` в соответствующий HTTP-статус, остальное — `500 Internal server error` с полным стеком в логгер. `4xx` в логи не пишет как ошибки. Express 5 сам ловит промисные reject'ы — отдельная обёртка `asyncHandler` не нужна.
4. **HTTP-клиент в `common`** — инстанс axios с `baseURL: '/api/v1'`, экспортируется как `api` из `src/client/common/`. Interceptors — родной API axios (`api.interceptors.request/response`), сам auth-interceptor подключается в задаче 0011.
5. **ESLint no-restricted-imports** — правила графа импортов из ADR 0007 (стрелка = «может импортировать», всё остальное запрещено). Конфиг per-directory через `files` в `eslint.config.mjs`. Из forbidden-списка для `auth` убирается `@app/common` — граф разрешает `auth → common`.

Модули `core` и `common` создаются впервые — в `src/client/core/`, `src/client/common/` (уже частично есть), симметрично в `src/server/core/`, `src/server/common/` — заводим по факту, без пустого каркаса. `AuthService` пока имеет тип-заглушку с методом `getCurrentUser` (реализация — в 0011).

Вне скоупа:

- Реализация `AuthService` (в 0011).
- Реальный логгер (пока `console`-заглушка в `core`).
- Rate-limit middleware (по месту в задачах 0012/0013/0014).

## Приёмка

- [x] `Registry` типизирован, `RegistryContext` и `useRegistry` экспортируются из `common`.
- [x] На клиенте `Application` оборачивает дерево в `<RegistryContext.Provider>` с собранным инстансом; хук возвращает тот же объект по всему дереву.
- [x] В `common` (на сервере) есть классы `AppError`, `NotFoundError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError`.
- [x] На сервере error-middleware маппит `AppError` в статусы; `5xx` уходят в логгер полностью, `4xx` — как info без стека.
- [x] HTTP-клиент `api` (axios) в `common` доступен для импорта из клиентских модулей.
- [x] ESLint падает на нарушение графа импортов (`landing → common → auth`, `auth → common → core` ок; `common → landing/project/application` — ошибка). Покрыто минимум одним примером в конфиге.

## Заметки

—
