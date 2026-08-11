# 0037 · TASK · Бэкенд `projects` — Manager/Repository/Router (REST API)

- Статус: [x]
- Эпик: 0035
- Зависит от: 0036, 0011, 0008
- Спека: docs/tasks/v0/0035-EPIC-projects-screen.md
- Нужен дизайн: нет (серверный слой, дизайна нет)
- Дизайн: —
- PR: e6cfd2a (прямой коммит в main)

## Описание

Серверный модуль `projects` с CRUD-эндпоинтами под нужды экрана `/projects`. Соблюдаем конвенции `src/server/CLAUDE.md`: `ProjectsRepository` (Kysely, бросает `NotFoundError` при отсутствии), `ProjectsManager` (бизнес-логика — валидация имени, дублирование, авторизация «это мой проект»), фабрики контроллеров с `create*`, роутер `createProjectsRouter`, регистрация в `ServerRegistry`.

### Модуль `src/server/projects/`

Структура:

```
projects/
├── controllers/
├── managers/          # ProjectsManager (см. feedback: Manager, не Service)
├── repositories/      # projectsRepository
├── router.ts
└── index.ts
```

### Роуты

Все под `/api/v1/projects`, требуют `requireAuth('api')` (401 без сессии — через error-middleware).

- `GET /api/v1/projects` → `{ projects: Project[] }`. Список проектов текущего пользователя, отсортированный по `updated_at DESC` (используем индекс из 0036).
- `POST /api/v1/projects` → `{ project: Project }`. Тело: `{ name: string }`. Создаёт новый проект пользователя. Валидация имени — см. ниже.
- `PATCH /api/v1/projects/:id` → `{ project: Project }`. Тело: `{ name: string }`. Переименовывает проект. 404, если проект чужой или не существует (используем один и тот же ответ — не палим факт существования чужого проекта).
- `POST /api/v1/projects/:id/duplicate` → `{ project: Project }`. Копирует проект под именем `«{name} (копия)»`. 404 при чужом/несуществующем.
- `DELETE /api/v1/projects/:id` → `204 No Content`. 404 при чужом/несуществующем.

### Валидация

- Zod-схемы кладём в `src/shared/projects/` (шарим с клиентом): `ProjectNameSchema` (`z.string().trim().min(1).max(60)`), `CreateProjectRequestSchema`, `RenameProjectRequestSchema`, тип `ProjectDto` (`id`, `name`, `createdAt`, `updatedAt` — как ISO-строки).
- 400 при невалидном теле (единый формат ошибок через error-middleware).

### Тип `Project`

Изоморфный DTO лежит в `src/shared/projects/` — им же типизирован ответ клиента. Repository возвращает Kysely-ряд, Manager конвертирует в DTO (даты → ISO).

### Дублирование

Реализуется в `ProjectsManager.duplicate(userId, id)`: читает исходный проект, создаёт новую строку с именем `«{исходное имя} (копия)»`, возвращает DTO. Гонок в v0 не боимся, транзакции не нужны.

### Registry / router

- В `src/server/projects/index.ts` экспортируем `ProjectsManager`, `ProjectsRepository`, `createProjectsRouter`.
- В `src/server/application/createRegistry.ts` регистрируем `projectsManager`.
- В `src/server/server.ts` подключаем `createProjectsRouter({ projectsManager })` на `/api/v1/projects`.

### Что не делаем

- Клиентский слой (`src/client/project/` — переименовываем позже или добавляем `src/client/projects/`) — задача 0038.
- Никакого HTTP-кеша, ETag, оптимистичных апдейтов — тонкий REST без обвязки.
- Никакой сцены/thumbnail — вне скоупа эпика.

## Приёмка

- [x] Все 5 роутов возвращают ожидаемые статусы и тела; 401 без сессии; 404 при попытке трогать чужой проект.
- [x] Валидация имени: `trim`, пусто → 400, > 60 символов → 400.
- [x] `GET /api/v1/projects` возвращает список пользователя в порядке `updated_at DESC`.
- [x] После `PATCH` и `POST /:id/duplicate` карточка ползёт наверх (updated_at обновляется).
- [x] `DELETE` возвращает 204 и физически удаляет строку.
- [x] Unit-тесты на `ProjectsManager` (валидация имени, дублирование, «чужой проект → NotFoundError») зелёные.
- [x] `pnpm --filter platform typecheck` и `pnpm --filter platform lint` зелёные.

## Заметки

- `pnpm --filter platform` не имеет отдельного скрипта `lint` — линт живёт на корне (`pnpm lint`), запуск чистый.
- Хендс-он через curl (сборка `pnpm --filter platform build:server`, запуск `node dist/server/server.js` на порту `4000`):
  - `GET /api/v1/projects` без cookie → `401 Unauthorized`.
  - Регистрация двух юзеров через `/api/v1/auth/register`, дальше по cookie:
    - `POST /` с `"  Гостиная  "` → `201`, имя приходит триммированное.
    - `POST /` с `"   "` и с 61-символьным именем → `400` (`{"error":"Неверный формат запроса"}`); 60 символов — `201`.
    - `PATCH /:id` с валидным телом → `200`, `updated_at` обновляется, в `GET /` карточка едет наверх.
    - `POST /:id/duplicate` → `201`, имя `«{name} (копия)»`.
    - `DELETE /:id` → `204` с пустым телом, повторный `DELETE` → `404`.
  - Юзер B на всех модифицирующих ручках чужого `:id` (и на невалидном id) получает `404 {"error":"Проект не найден"}` — факт существования не палим.
- Тестовые пользователи в БД зачищены после проверки.
