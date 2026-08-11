# 0040 · TASK · Явный выбор клиентских бандлов в SSR (dev/prod)

- Статус: [ ]
- Эпик: —
- Зависит от: —
- Спека: —
- Нужен дизайн: нет (инфраструктурная правка, UI не меняется)
- Дизайн: —
- PR: —

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

- [ ] После `pnpm --filter platform build && pnpm --filter platform dev` браузер получает свежий dev-бандл (`GET /static/bundle.js`, а не `/static/bundle.<oldhash>.js`), новые правки в компонентах подтягиваются HMR/reload без ручной чистки `dist/client/`.
- [ ] После `pnpm --filter platform build` prod-сервер (запуск `node dist/server/server.js`) корректно находит хешированные `bundle.<hash>.js` и `main.<hash>.css` в `dist/client/` (регресс prod-режима не допускаем).
- [ ] Если ожидаемый бандл отсутствует, сервер падает с осмысленным сообщением, а не отдаёт пустой `src=""` в HTML.
- [ ] Ручная проверка через Playwright MCP: открыть `/projects`, убедиться, что `document.scripts[…].src` указывает на `/static/bundle.js` в dev-режиме.
- [ ] `pnpm --filter platform typecheck`, `pnpm --filter platform lint` — чисто.

## Заметки

Всплыло 2026-08-12 при отладке багов `NewProjectTile` (курсор + focus-обводка после Escape). Симптомы: правки в JSX не долетают до браузера, хотя `dist/client/bundle.js` их содержит. Причина — `server.ts` подсовывал старый `bundle.<hash>.js` от предыдущей prod-сборки, лежавший рядом.
