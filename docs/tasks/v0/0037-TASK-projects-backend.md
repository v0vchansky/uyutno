# 0037 · TASK · Бэкенд `projects` — Manager/Repository/Router (REST API)

- Статус: [ ]
- Эпик: 0035
- Зависит от: 0036, 0011, 0008
- Спека: docs/tasks/v0/0035-EPIC-projects-screen.md
- Нужен дизайн: нет (серверный слой, дизайна нет)
- Дизайн: —
- PR: —

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

- [ ] Все 5 роутов возвращают ожидаемые статусы и тела; 401 без сессии; 404 при попытке трогать чужой проект.
- [ ] Валидация имени: `trim`, пусто → 400, > 60 символов → 400.
- [ ] `GET /api/v1/projects` возвращает список пользователя в порядке `updated_at DESC`.
- [ ] После `PATCH` и `POST /:id/duplicate` карточка ползёт наверх (updated_at обновляется).
- [ ] `DELETE` возвращает 204 и физически удаляет строку.
- [ ] Unit-тесты на `ProjectsManager` (валидация имени, дублирование, «чужой проект → NotFoundError») зелёные.
- [ ] `pnpm --filter platform typecheck` и `pnpm --filter platform lint` зелёные.

## Заметки

—
