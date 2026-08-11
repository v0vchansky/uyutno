# 0029 · TASK · Выход из аккаунта: `/auth/logout` + клиент

- Статус: [x]
- Эпик: 0005
- Зависит от: 0011 (session middleware), 0026 (кнопка «Выйти» в шапке)
- Спека: [docs/adr/0005-model-autentifikatsii.md](../../adr/0005-model-autentifikatsii.md)
- Нужен дизайн: нет (согласовано, кнопка уже свёрстана в 0026 — задача про поведение)
- Дизайн: —
- PR: —

## Описание

Кнопка «Выйти» в меню профиля и в мобильном бургере (сделаны в 0026) сейчас вызывает `authManager.logout()`, который бросает `Error('not implemented')`. Приделываем реальный выход.

**Подход — GET-редирект, не JSON-API.** Клиент делает `window.location.href = '/auth/logout'`. Сервер отзывает сессию, чистит cookie, редиректит на `/`. Это проще фетча + перезагрузки, а благодаря `SameSite=lax` у `session_id` cookie кросс-сайтовый `<img src>`-CSRF не сработает (cookie шлётся только на top-level навигацию с того же сайта). Худший сценарий — по клику на внешнюю ссылку `<a href>` можно случайно разлогиниться, но это UX-шум, не компрометация. Для v0 приемлемо; классический POST + CSRF-токен добавим, если/когда появятся другие GET-мутации.

Роут — top-level `/auth/logout`, не `/api/v1/auth/logout`: это top-level навигация с 302, а `/api/v1/*` у нас держит JSON-ручки. Уже есть аналогия — `/auth/callback/:provider` (OAuth callback) живёт вне `/api/v1`.

Полный флоу:

1. Клиент: `authManager.logout()` → `window.location.href = '/auth/logout'` (метод синхронный, тип `void`).
2. Сервер: `GET /auth/logout` читает `req.cookies[SESSION_COOKIE_NAME]`. Если есть — `sessionManager.revokeSession(sessionId)`. Всегда: `clearSessionCookie(res)`; `res.redirect(302, '/')`.
3. Браузер идёт на `/`, приходит SSR-ответ без сессии — шапка/подвал автоматически в guest-состоянии.

## Скоуп

**Сервер (`apps/platform/src/server/`):**

- Новый контроллер `auth/controllers/logoutController.ts` — фабрика `createLogoutController(sessionManager)`, возвращает Express-хендлер, который делает шаги 2 выше.
- Регистрация в `auth/router.ts` под тем же `createAuthRouter`, но роут — `GET /logout`. Учти, что `createAuthRouter` монтируется под `/api/v1/auth` в `server.ts` — под logout нужен **отдельный роутер** или отдельная точка монтирования. Проще всего: расширить `router.ts` фабрикой `createLogoutRouter(sessionManager)` (аналог `createOAuthCallbackRouter`), которую в `server.ts` смонтировать под `/auth` — тогда путь на клиенте будет `/auth/logout`.
- Юнит-тест `logoutController.test.ts` с fake `sessionManager` и fake `req`/`res` (по образцу `oauthStateCookie.test.ts`): проверить два кейса — есть cookie (revoke вызван) и нет cookie (revoke не вызван), в обоих 302 на `/` и `clearSessionCookie`.
- Если понадобится — экспорт из `auth/index.ts`.

**Клиент (`apps/platform/src/client/auth/managers/AuthManager.ts`):**

- Заменить `async logout(): Promise<never>` на `logout(): void`, тело — `window.location.href = '/auth/logout';`. Прежний `throw` уходит.
- Обновить сигнатуру потребителей — `ProfileMenu.tsx` и `MobileMenu.tsx`:
  - убрать `try/catch` и `navigate('/')` — редирект делает сервер;
  - `onClick={() => authManager.logout()}`.

**Тесты:**

- `logoutController.test.ts` — как выше.
- Если в клиентских тестах уже есть покрытие `AuthManager` — привести к новой сигнатуре (не создавать новые ради этого).

## Приёмка

- [x] `GET /auth/logout` с активной cookie — 302 на `/`, `Set-Cookie: session_id=; ...` с истёкшим временем, запись в `sessions` удалена.
- [x] `GET /auth/logout` без cookie — тоже 302 на `/` (не 4xx, не 500).
- [x] `AuthManager.logout()` синхронный, `void`, тело — `window.location.href = '/auth/logout'`.
- [x] `ProfileMenu` и `MobileMenu` вызывают `authManager.logout()` без `try/catch` и без ручного `navigate('/')`.
- [x] Юнит-тесты logout-контроллера (2 кейса) — зелёные.
- [x] `pnpm --filter platform typecheck` — чисто.
- [x] Playwright MCP: залогин под `test@uyutno.dev` / `test1234`, открытие меню профиля на `/`, клик «Выйти» → пользователь на `/`, шапка в guest-состоянии. То же — из мобильного бургера (390px, залогин, открыть бургер, нажать «Выйти»).

## Заметки

—
