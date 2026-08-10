# 0020 · TASK · Реакция клиента на состояние авторизации (шапка + гард auth-страниц)

- Статус: [~]
- Эпик: 0005
- Зависит от: 0011, 0012, 0013
- Спека: —
- PR: —

## Описание

Клиент нигде не учитывает `authManager.getCurrentUser()` вне формы логина/регистрации. Из-за этого:

1. Залогиненный пользователь на `/` видит в шапке (`apps/platform/src/client/common/components/PublicLayout/PublicHeader.tsx`) кнопки «Войти» и «Создать проект», хотя уже вошёл.
2. По клику на «Войти» через `<Link>` он попадает на `/login` — серверный `redirectIfAuthenticated` (`apps/platform/src/server/auth/middleware/redirectIfAuthenticated.ts`) при SPA-навигации не срабатывает, а клиентской защиты нет.

Данные для решения уже есть: SSR прокидывает `request.user` в `initialState.user` (`apps/platform/src/server/application/middleware/page.ts`) → `createRegistry` → `AuthManager`, дальше доступно через `useRegistry()`.

Скоуп:

- **Шапка.** В `PublicHeader.tsx` учесть `authManager.getCurrentUser()`. Если пользователь есть — скрыть «Войти» и заменить «Создать проект» на «В личный кабинет» (`<Link to="/projects">`, стилистически как primary-кнопка, чтобы не ломать вертикальную сетку). Существующее скрытие «Войти» на `/login` и «Создать проект» на `/register` (для анонимов) — сохранить.
- **Гард auth-страниц.** Ввести layout-роут `RedirectIfAuthenticated` в модуле `@app/auth` (`components/RedirectIfAuthenticated/`), который читает `authManager.getCurrentUser()` и рендерит `<Navigate to="/projects" replace />` для залогиненных, иначе `<Outlet />`. В `apps/platform/src/client/application/components/Router/Router.tsx` завернуть в него `/login` и `/register`. Когда появятся `/forgot-password` и `/reset-password` (задача 0014), они добавляются под тот же wrapper — специально ради этого делаем не HOC, а именно layout-роут.
- **`/projects` пока не существует** — редирект временно уходит на пустой SSR-шелл, это уже поведение серверного `redirectIfAuthenticated` и меняется отдельно в задаче 0019 (там же — временный перевод дефолт-редиректа на `/`).

Вне скоупа:

- Меню/аватар/выход из системы — отдельная задача.
- Реальная страница `/projects` — отдельная задача.
- Правки в `LoginPage`/`RegisterPage` (кроме подключения через wrapper) — не нужны.

## Приёмка

- [ ] Залогиненный пользователь на `/` видит в шапке только кнопку «В личный кабинет» (ведёт на `/projects`); «Войти» отсутствует.
- [ ] Анонимный пользователь на `/` видит «Войти» + «Создать проект» — как раньше.
- [ ] SPA-переход на `/login` или `/register` для залогиненного (например, из адресной строки через `navigate()` или ручным вводом с уже открытой вкладки) немедленно редиректит на `/projects`, форма логина не отображается.
- [ ] Для анонима `/login` и `/register` продолжают открываться нормально.
- [ ] Серверный `redirectIfAuthenticated` не тронут — hard-load `/login` под сессией по-прежнему редиректит на сервере.
- [ ] Визуальная проверка через Playwright MCP: 1440 / 768 / 390; сценарии — аноним/залогинен на `/`, залогиненный переход на `/login`.

## Заметки

—
