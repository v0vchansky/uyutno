# 0019 · TASK · 404-страница для неизвестных путей

- Статус: [x]
- Эпик: 0016
- Зависит от: 0004
- Спека: —
- Нужен дизайн: нет (согласовано, делаем по guidelines)
- Дизайн: —
- PR: —

## Описание

Сейчас сервер отдаёт SSR-шелл на любой URL: в `apps/platform/src/server/server.ts` catch-all `app.get('/{*splat}', page)` возвращает 200 OK для любого пути, а клиентский `<Routes>` в `apps/platform/src/client/application/components/Router/Router.tsx` для незнакомых путей рендерит пустое место внутри layout. Пользователь видит «страницу», хотя её не существует; поисковики получают 200 на мусорные URL.

Нужно честное 404: правильный HTTP-статус и внятная страница «такой страницы нет» + ссылка на главную.

Скоуп:

- Компонент `NotFoundPage` в клиентском модуле (обёрнут в `PublicLayout`, свои `<title>` и `<meta name="description">` — по правилам `apps/platform/src/client/CLAUDE.md`).
- Клиентский роут `<Route path="*" element={<NotFoundPage />} />` — чтобы SPA-переходы на несуществующий путь тоже показывали 404, а не пустой layout.
- Серверная 404-обвязка: неизвестные page-пути отвечают статусом **404** и рендерят ту же `NotFoundPage`. Механизм — на усмотрение исполнителя (единый список known page paths, шаренный между клиентом и сервером; либо клиентский `useMatches`/loader-хук, дающий сигнал серверу выставить статус). Главное — status code честный, контент совпадает с клиентским 404.
- Учесть уже используемый `/projects`: он фигурирует как дефолт-редирект после логина (`LoginPage.tsx:59`, `RegisterPage.tsx:96`) и в `redirectIfAuthenticated` (`DEFAULT_TARGET = '/projects'`). Пока реальной страницы `/projects` нет, дефолт-редирект временно перевести на `/`, чтобы после успешного входа пользователь не улетал на 404. Вернём `/projects` в дефолт, когда появится сама страница (отдельная задача).

Вне скоупа:

- Настоящая страница `/projects` и её auth-гард — это отдельная будущая задача.
- Кастомная 500-страница — отдельная задача, если понадобится.
- Локализация 404 — v0 однoязычный, не трогаем.

## Приёмка

- [x] `curl -i http://localhost:4000/nonexistent` возвращает `HTTP/1.1 404 Not Found` и HTML c контентом 404-страницы (не SSR-шелл текущей главной).
- [x] В браузере на неизвестном URL отрисовывается `NotFoundPage` внутри `PublicLayout` с ссылкой на главную; свои `<title>` и `<meta name="description">` присутствуют в `<head>`.
- [x] Известные пути (`/`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/project/:id`) продолжают отвечать 200 и рендериться как раньше.
- [x] После успешного логина/регистрации пользователь попадает на существующую страницу (`/projects`), а не на 404.
- [x] SPA-переход на несуществующий путь (навигация через `<Link>` / `navigate`) показывает `NotFoundPage`, а не пустой layout.
- [x] Визуальная проверка через Playwright MCP: 1440 / 768 / 390, golden path и 404-состояние.

## Заметки

- Дефолт-редирект после логина/регистрации трогать не пришлось: страница `/projects` уже готова (эпик 0035, задачи 0036–0039). Абзац в «Описании» про временный перевод на `/` — устаревший, оставил как есть; сам критерий приёмки поправил на актуальную формулировку («на существующую страницу `/projects`, а не на 404»).
- `NotFoundPage` — в модуле `landing` (`apps/platform/src/client/landing/pages/NotFoundPage/NotFoundPage.tsx`), экспортирован из `landing/index.ts`. Внутри — `PublicLayout` (`mode='landing'` по дефолту), заголовок «404», подзаголовок «Такой страницы нет», подпись, ссылка-кнопка «На главную» → `Route.Home`. Копия и типографика — по `docs/ui/guidelines.md`; своя пара `<title>`/`<meta description>` в JSX.
- Единый источник «известных путей» — `Route` enum в `apps/platform/src/shared/router/routes.ts`. Туда же добавил `isKnownPagePath(pathname)` (регексп-матчер, поддерживает `:id`-параметры).
- Сервер (`apps/platform/src/server/server.ts`): catch-all `app.get('/{*splat}', ...)` теперь перед вызовом `page` дёргает `isKnownPagePath(req.path)` и, если false, ставит `res.status(404)`. HTML тот же — рендерится тот же SSR-шелл, но с 404-статусом; клиентский `<Route path='*'>` внутри Router даёт визуальный контент.
- Клиентский Router (`apps/platform/src/client/application/components/Router/Router.tsx`): добавлен `<Route path='*' element={<NotFoundPage />} />` в конец `<Routes>`. Плюс заглушки под задачу 0014 для `/forgot-password` и `/reset-password` (`element={<></>}`) — иначе wildcard подхватил бы их и клиент показал бы NotFoundPage, хотя сервер отдаёт 200. Когда 0014 закроется, заглушки заменятся на реальные формы.
- Проверки: `pnpm --filter platform typecheck` — чисто; `pnpm lint` (корневой; `pnpm --filter platform lint` не существует) — чисто.
- `curl` по всем ключевым путям: `/nonexistent` → 404, `/foo/bar/baz` → 404; `/`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/project/xyz` → 200. HTML на `/nonexistent` содержит `<title>Страница не найдена — уютно</title>`, «Такой страницы нет», «Проверьте адрес».
- Playwright MCP на dev-сервере `:4000`:
  - 1440 / 768 / 390 — скриншоты `/nonexistent` под залогиненным пользователем: layout + шапка `landing`-режима + подвал, центрированная 404-композиция, кнопка «На главную».
  - SPA-переход по клику «На главную» с `/nonexistent` — URL стал `/`, title — «уютно — планировщик квартиры онлайн» (без перезагрузки).
  - SPA-переход `history.pushState('/spa-unknown') + PopStateEvent` на главной — title сразу стал «Страница не найдена — уютно», React Router перематчил wildcard.
  - SPA-переход на `/forgot-password` под залогиненным пользователем — редирект в `/projects` через `RedirectIfAuthenticated`, NotFoundPage не мелькает (стаб-роут отработал).
