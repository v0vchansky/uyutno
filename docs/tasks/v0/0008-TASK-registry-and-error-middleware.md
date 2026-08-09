# 0008 · TASK · Registry + error-middleware + core/errors

- Статус: [ ]
- Эпик: 0005
- Зависит от: —
- Спека: docs/adr/0007-arhitektura-proekta-moduli.md
- PR: —

## Описание

Завести общую инфраструктурную обвязку из [ADR 0007](../../adr/0007-arhitektura-proekta-moduli.md), без которой невозможно чисто разложить auth-модуль:

1. **Registry в `common`** — тип `Registry` (запись из инстансов общих сервисов, включая `AuthService`), React context `RegistryContext`, хук `useRegistry()`. Сам инстанс собирается в `application`. На клиенте — синглтон при бутстрапе; на сервере — per-request (если нужен request-scoped контекст, например `req-id` в логгере). Стабильный по референсу.
2. **Базовые ошибки в `core`** — иерархия `AppError` и наследников: `NotFoundError` (404), `ValidationError` (400), `UnauthorizedError` (401), `ForbiddenError` (403), `ConflictError` (409). Ровно как в [`src/server/CLAUDE.md`](../../../apps/platform/src/server/CLAUDE.md).
3. **Error-middleware в `application`** — ловит все исключения из контроллеров, маппит `AppError` в соответствующий HTTP-статус, остальное — `500 Internal server error` с полным стеком в логгер. `4xx` в логи не пишет как ошибки. Использует `express-async-errors` (или тонкую обёртку `asyncHandler`) — выбрать по вкусу, обосновать одним комментарием в PR.
4. **Тонкий HTTP-клиент в `core`** — минимальная обёртка над `fetch` или `axios` для клиентских модулей (см. [`src/client/CLAUDE.md`](../../../apps/platform/src/client/CLAUDE.md) — «Единственный HTTP-клиент — из модуля core»). Interceptors как API — без бизнес-логики (сам auth-interceptor подключается в задаче 0011).
5. **ESLint no-restricted-imports** — правила графа импортов из ADR 0007 (стрелка = «может импортировать», всё остальное запрещено). Конфиг per-directory через `files` в `eslint.config.mjs`.

Модули `core` и `common` создаются впервые — в `src/client/core/`, `src/client/common/` (уже частично есть), симметрично в `src/server/core/`, `src/server/common/` — заводим по факту, без пустого каркаса. `AuthService` пока имеет тип-заглушку с методом `getCurrentUser` (реализация — в 0011).

Вне скоупа:

- Реализация `AuthService` (в 0011).
- Реальный логгер (пока `console`-заглушка в `core`).
- Rate-limit middleware (по месту в задачах 0012/0013/0014).

## Приёмка

- [ ] `Registry` типизирован, `RegistryContext` и `useRegistry` экспортируются из `common`.
- [ ] На клиенте `Application` оборачивает дерево в `<RegistryContext.Provider>` с собранным инстансом; хук возвращает тот же объект по всему дереву.
- [ ] В `core` есть классы `AppError`, `NotFoundError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError`.
- [ ] На сервере error-middleware маппит `AppError` в статусы; `5xx` уходят в логгер полностью, `4xx` — как info без стека.
- [ ] Тонкий HTTP-клиент в `core` доступен для импорта из клиентских модулей; API interceptors описан (даже если пока пуст).
- [ ] ESLint падает на нарушение графа импортов (`landing → common → auth → core` ок; `auth → common` — ошибка). Покрыто минимум одним примером в конфиге.

## Заметки

—
