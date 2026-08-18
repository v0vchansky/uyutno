# 0040 · TASK · Явный выбор клиентских бандлов в SSR (dev/prod)

- Статус: [x]
- Эпик: —
- Зависит от: —
- Спека: —
- Нужен дизайн: нет (инфраструктурная правка, UI не меняется)
- Дизайн: —
- PR: — (прямой коммит в main)

## Описание

`src/server/server.ts:62-66` выбирает JS/CSS для SSR-обёртки самым наивным способом:

```ts
const cssFile = fs.readdirSync(staticPath).find(f => f.endsWith('.css'));
const jsFile = fs.readdirSync(staticPath).find(f => f.endsWith('.js'));
```

Это ломается, если в `dist/client/` одновременно лежат артефакты и prod-сборки (`bundle.<contenthash>.js`, `main.<contenthash>.css`), и dev-сборки (`bundle.js`, `styles.css`). `webpack.client.js:16` чистит `dist/client/` только в prod (`clean: isProd`), поэтому типичный сценарий «сначала `pnpm build`, потом `pnpm dev`» оставляет старые хешированные файлы. Они сортируются по алфавиту раньше свежих (`bundle.2a08…` < `bundle.js`), и `find(...)` возвращает первый — старый. Сервер отдаёт стейл-бандл, HMR/новые правки не долетают до браузера, при этом ошибок не видно: страница просто ведёт себя как до правок.

Ловили этот случай на баге с `NewProjectTile` — правки в `className` (`cursor-pointer`, замена `focus-visible:ring` на `focus-visible:border`) не подхватывались, потому что сервер продолжал раздавать `bundle.2a08ac0e09f580c0c715.js` от старой prod-сборки. Ручное удаление хешированных файлов чинит симптом, но не причину.

## Скоуп

Правится в двух местах, эту задачу закрываем обеими правками (иначе одна из них не даёт нужного эффекта поодиночке):

1. **`apps/platform/src/server/server.ts` — явный выбор ассетов, а не «первый попавшийся».**

   - В dev-режиме сервер ищет ровно `bundle.js` и `styles.css` — имена, которые webpack эмитит в dev (`webpack.client.js:13,44`).
   - В prod-режиме ищет `bundle.<hash>.js` и `main.<hash>.css` по регуляркам, а не по `endsWith`. Так первый попавшийся посторонний `.js`/`.css` в `dist/client/` уже не подменяет наш бандл.
   - Если ожидаемый файл не найден — падать с понятной ошибкой (например, `throw new Error('Client bundle not found in dist/client — did you run pnpm dev or pnpm build?')`), чтобы сразу видеть проблему, а не тихо отдавать битую HTML.
   - Режим определяем через `process.env.NODE_ENV` (в webpack он и так проставляется через `cross-env` в скриптах dev/build).

2. **`apps/platform/webpack/webpack.client.js` — чистить `dist/client/` и в dev тоже.**

   - `clean: isProd` → `clean: true`. По умолчанию webpack 5 при `clean: true` не трогает `.hot-update.*` из текущей компиляции (там своя логика чистки), но, чтобы точно ничего не сломать, при необходимости оставить `.hot-update.(js|json)` через `output.clean.keep`.
   - Это гарантирует, что в dev не будет реликтовых prod-хешей рядом с текущими `bundle.js`/`styles.css`.

Обе правки вместе покрывают и текущий кейс (стейл-файлы после `pnpm build`), и будущие (кто-нибудь руками подкинет `.js` в `dist/client/` — сервер всё равно возьмёт наш ожидаемый).

## Приёмка

- [x] После `pnpm --filter platform build && pnpm --filter platform dev` браузер получает свежий dev-бандл (`GET /static/bundle.js`, а не `/static/bundle.<oldhash>.js`), новые правки в компонентах подтягиваются HMR/reload без ручной чистки `dist/client/`.
- [x] После `pnpm --filter platform build` prod-сервер (запуск `node dist/server/server.js`) корректно находит хешированные `bundle.<hash>.js` и `main.<hash>.css` в `dist/client/` (регресс prod-режима не допускаем).
- [x] Если ожидаемый бандл отсутствует, сервер падает с осмысленным сообщением, а не отдаёт пустой `src=""` в HTML.
- [x] Ручная проверка через Playwright MCP: открыть `/projects`, убедиться, что `document.scripts[…].src` указывает на `/static/bundle.js` в dev-режиме.
- [x] `pnpm --filter platform typecheck`, `pnpm --filter platform lint` — чисто.
- [x] Гонка `pnpm dev` (сервер стартует раньше, чем клиентский watch выпустил бандл) закрыта; обходной `pnpm build:client:dev && pnpm dev` из `playwright.config.ts` убран, `pnpm test:e2e` с холодного старта проходит.

## Заметки

Всплыло 2026-08-12 при отладке багов `NewProjectTile` (курсор + focus-обводка после Escape). Симптомы: правки в JSX не долетают до браузера, хотя `dist/client/bundle.js` их содержит. Причина — `server.ts` подсовывал старый `bundle.<hash>.js` от предыдущей prod-сборки, лежавший рядом.

Часть 2 скоупа (`webpack.client.js` + `webpack.server.js` — `clean: true` в dev) сделана ad-hoc вне задачи: `pnpm dev` теперь всегда чистит `dist/`, реликтовые файлы больше не оседают. В задаче остаётся часть 1 — явный выбор ассетов в `server.ts` по регулярке (страховка от любых посторонних `.js`/`.css` в `dist/client/`).

**Реализация (2026-08-18).** Новый модуль `apps/platform/src/server/application/clientAssets.ts` (+ `clientAssets.test.ts`, 10 кейсов) — единственное место на сервере, знающее имена бандлов; `pageMiddleware` принимает резолвер `() => Promise<ClientAssets>` и вызывает его на каждый запрос; `server.ts` создаёт резолвер по `process.env.NODE_ENV` (инлайнится DefinePlugin при сборке сервера).

- **Prod** (`NODE_ENV=production`): при старте один раз `readdir(dist/client)`, ровно один файл по `^bundle\.[0-9a-f]+\.js$` и ровно один по `^main\.[0-9a-f]+\.css$`; иначе процесс падает с сообщением вида `Expected exactly one bundle.<hash>.js in …, found bundle.0000.js, bundle.49a5….js — did you run pnpm build (and is dist/client clean)?` / `Client build directory not found: … — did you run pnpm build?` (оба сценария воспроизведены, exit 1). Дальше — кэш.
- **Dev** (гонка из 0049): имена фиксированы (`/static/bundle.js`, `/static/styles.css`), диск при старте не читается. На запросе страницы — два `existsSync`; если файлов ещё нет (клиентский watch не успел, или в `dist/client` пока лежат prod-хеши после `pnpm build`), запрос ждёт их появления (поллинг 200 мс, один общий ожидатель на все параллельные запросы, лог `waiting for the client webpack watch…` / `Client bundle is ready`), лимит 90 с → `ClientAssetsUnavailableError` (503, `AppError`) с пояснением, а не HTML с 404-ссылками. Проверено: `pnpm build && pnpm dev`, `curl /` сразу после `health` — 200 с `/static/bundle.js` и `/static/styles.css`, в логе сервера `waiting… → ready`.
- **Побочная находка, исправлена:** `build:server` шёл без `NODE_ENV=production`, поэтому `pnpm build` собирал серверный бандл с инлайненным `NODE_ENV="development"` (в т.ч. `isProd=false` для флагов cookie `Secure` и `oauth_state`). Теперь `build:server` = `cross-env NODE_ENV=production webpack …`, а первичная сборка внутри `dev:server` зовёт webpack напрямую (наследует `NODE_ENV=development` от `pnpm dev`). Без этого prod-сервер после `pnpm build` искал бы `bundle.js`.
- **Playwright:** `webServer.command` → `pnpm dev`; скрипт `build:client:dev` удалён (больше нигде не используется); комментарий в `playwright.config.ts` и разделы dev-сервера/тестов в `apps/platform/README.md` обновлены. `apps/platform/CLAUDE.md` обходного пути не упоминал — без изменений.
- Прогоны: `pnpm typecheck` — `packages/planner typecheck: Done`, `apps/platform typecheck: Done`; `pnpm lint` — без вывода (0 ошибок); Prettier по файлам задачи чист; `pnpm test` — `packages/planner: Test Suites: 15 passed / Tests: 167 passed`, `apps/platform: Test Suites: 12 passed / Tests: 91 passed`; `pnpm test:e2e` с холодного старта (после `pnpm build`, dev-сервер поднимал сам Playwright через `pnpm dev`, без предварительной сборки клиента) — `4 passed (12.3s)`; Playwright MCP на `/projects` (dev): `document.scripts` → `http://localhost:4000/static/bundle.js`, stylesheet → `/static/styles.css` (в консоли — pre-existing hydration-warning React, есть в логах MCP от 2026-08-11, к задаче не относится). Node v20.17 при `engines >=22` — pnpm предупреждает, всё проходит. Dev-сервер и MCP-браузер остановлены; Postgres в Docker был поднят до задачи — не трогал.
