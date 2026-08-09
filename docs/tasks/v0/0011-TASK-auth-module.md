# 0011 · TASK · auth-модуль: AuthService, session middleware, /auth/me, гарды, axios-interceptor

- Статус: [ ]
- Эпик: 0005
- Зависит от: 0007, 0008
- Спека: docs/product/features/auth.md#гарды-и-редиректы-from-поведение
- PR: —

## Описание

Ядро auth: механизм сессий, определение «текущего пользователя», гарды на защищённые роуты (SSR + API + клиентский interceptor), логика редиректов на `/login`. Без бизнес-фичей регистрации/входа — только фундамент, на который сядут задачи 0012–0015.

### Backend (`src/server/auth/`)

- Репозитории (Kysely): `usersRepository` — `findByEmail`, `findById`, `create` (пока без password-логики — просто low-level); `sessionsRepository` — `create`, `findById`, `deleteById`, `deleteByUserId`, `touch` (обновляет `last_activity_at`, продлевает `expires_at` при rolling refresh).
- Сервис `SessionService` — `issueSession(userId)`, `revokeSession(sessionId)`, `revokeAllForUser(userId)`, `readSession(sessionId)`. Генерация session_id — opaque, ≥32 байта энтропии, hex/base64url (ADR 0005).
- `AuthService` — `getCurrentUser(req)`: читает cookie `session_id`, валидирует сессию, обновляет `last_activity_at`, возвращает `User | null`. Регистрируется в Registry (см. 0008).
- Middleware:
  - `sessionMiddleware` — на все запросы: подгружает `req.user` (или `null`), продлевает rolling TTL.
  - `requireAuth` — гард: если `req.user` пуст, для API-роутов бросает `UnauthorizedError` (→ 401 через error-middleware из 0008); для SSR-роутов делает `res.redirect('/login?from=<encoded pathname+search>')`. Флаг типа роута (`api` vs `page`) — параметр middleware, чтобы использовать один код для обоих случаев.
  - `redirectIfAuthenticated` — обратный гард: если `req.user` не пуст, редиректит с `/login`, `/register`, `/forgot-password`, `/reset-password` на `/projects` (или на `from`, если валиден).
- Cookie-хелперы: установка `session_id` с флагами `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age` под 30 дней; удаление cookie на logout (сам logout — не в этой задаче, но хелпер здесь).
- Валидация `from`: только относительный путь внутри своего домена (`^/[a-zA-Z0-9\-_/?=&.%]*$`, без `//`, без `http`, без `\`). Общий helper `normalizeFromParam(raw): string | null` в `src/server/auth/lib/`.
- Контроллер `GET /api/v1/auth/me` — возвращает `req.user` (или `null`, статус 200 в обоих случаях, не 401).

### Frontend (`src/client/auth/`)

- `AuthService` (клиентский) — обёртка вокруг HTTP-клиента: `getCurrentUser()` (`GET /api/v1/auth/me`), плюс методы-заготовки под login/register/logout (пусть возвращают ошибку «not implemented», реализация в 0012+). Регистрируется в клиентском Registry.
- SSR-hydration: текущий пользователь из `req.user` прокидывается в клиент через `window.__INITIAL_STATE__` (или аналогичный канал), клиентский `AuthService` инициализируется этим значением без второго запроса.
- **Axios-interceptor** (или fetch-обёртка в `core` — по факту стека из 0008): ловит `401` от `/api/v1/*`, читает `location.pathname + location.search`, редиректит на `/login?from=<encoded>` (клиентская навигация react-router). Не редиректит, если пользователь уже на `/login`, `/register`, `/forgot-password`, `/reset-password` (защита от цикла).
- Общий helper `buildAuthUrl(target, from)` в `src/client/auth/lib/` — единая точка построения ссылок между auth-экранами с сохранением `from` (для использования в задачах 0012/0013/0014).

### Application

- Роут `GET /api/v1/auth/me` подключён на бэке и клиенте.
- `requireAuth` подключён на минимальном тестовом защищённом роуте (например, `GET /api/v1/auth/me` требует auth? — нет, `/me` возвращает `null` без сессии; для проверки — временный роут `GET /api/v1/_auth-check` или проверка через будущий `/projects`). Достаточно чтобы гард был подключён к роутеру и падал на реальном запросе — конкретная точка приложения выбирается автором.

### Что не проверяется в этой задаче

Полный e2e SSR-редиректа с `?from=` на `/projects` — только когда появится сам `/projects` в эпике проектов. Здесь достаточно проверки на любом защищённом роуте, добавленном ради приёмки (можно временном).

## Приёмка

- [ ] `GET /api/v1/auth/me` возвращает `null` без cookie и объект пользователя при валидной сессии.
- [ ] Session middleware подгружает `req.user` и продлевает `last_activity_at` + `expires_at` при активности.
- [ ] `requireAuth` для API возвращает `401`; для SSR-страницы редиректит на `/login?from=…`.
- [ ] `redirectIfAuthenticated` уводит залогиненного пользователя с `/login`/`/register`/`/forgot-password`/`/reset-password` на `/projects`.
- [ ] `normalizeFromParam` пропускает относительные пути и отбрасывает всё остальное (open redirect protection); покрыт unit-тестами.
- [ ] Клиентский `AuthService` инициализируется значением из SSR без дополнительного запроса при первой загрузке.
- [ ] Axios-interceptor превращает `401` на `/api/v1/*` в клиентский редирект на `/login?from=…`; на auth-экранах не редиректит (нет цикла).
- [ ] Cookie `session_id` устанавливается с `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age` ≈ 30 дней.
- [ ] ESLint-правила из ADR 0007 не нарушены (в частности, `auth` не импортирует `common`).

## Заметки

—
