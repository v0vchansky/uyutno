# 0049 · TASK · Проекция в Three: канвас, ортокамера top, пустая сцена, render-on-demand, resize/dispose без утечек, perf/leak-гвард

- Статус: [ ]
- Эпик: 0043
- Зависит от: 0048
- Спека: docs/adr/0015-arhitektura-dvizhka-planera.md (A7 — жизненный цикл, render-on-demand, гвард; A9); docs/adr/0016-model-dokumenta-planera.md (B1 — маппинг `(x,y)→(x,h,−y)`, B7 — `Document.view`); docs/product/architecture/planner-build-order.md (шаг 1, парковка «ADR G»); docs/product/architecture/testing-strategy.md (слой 3 — perf/leak-гварды); docs/product/features/planner/08-cameras-views.md («2D top-view»); docs/product/architecture/threejs-r185-migration.md
- Нужен дизайн: нет (пустая сцена без UI-элементов; вёрстка страницы не меняется — канвас на весь рабочий контейнер, как в 0047)
- Дизайн: —
- PR: —

## Описание

Завершающая задача шага 1: ядро из 0048 получает **проекцию в Three** — единственный слой пакета, который трогает `three` и DOM. После неё эпик 0043 «стоит на ногах»: `/project/:id` открывает планер с канвасом на весь контейнер, ортокамерой сверху и пустой сценой; рендер только по требованию (в покое ни одного `requestAnimationFrame`); resize и unmount не текут. Здесь же закрываются обязательные пункты приёмки эпика 0043 (канвас на весь контейнер, нет RAF в покое, unmount освобождает renderer/геометрии/материалы).

Ровно один PR. Инструментов, геометрии, мешей стен — нет (шаги 2 и 4).

### Скоуп (что делаем)

1. **`projection/three/ThreeProjection`** (A7): один `WebGLRenderer` на переданный `canvas`; одна `Scene` (пустая; фон/свет — минимум, чтобы «пустая сцена» была видна как фон); **ортокамера сверху** из `Document.view` (`activeView`, камера вида `plan`): центр/зум → фрустум камеры; **маппинг план→мир `(x, y) → (x, h, −y)` — в одном месте** проекции (B1; ADR G позже расширяет, не переносит). Проекция подписана на шину через `manager.on/subscribe`, документ читает через фасад, в документ не пишет; `view:changed` → перестроить камеру и `invalidate()`; `document:changed` → в шаге 1 просто `invalidate()` (сцена пустая).
2. **`RenderLoop`** (A7): `invalidate()` выставляет бюджет кадров, дефолт `FRAME_BUDGET = 5` (константа рядом с классом), переопределяется параметром `createPlanner({ frameBudget })`; луп через `requestAnimationFrame` декрементирует бюджет и **самозавершается** — в покое `rAF` не планируется; повторный `invalidate()` во время лупа только пополняет бюджет (без второго лупа). Инвалидируют: любое событие шины, resize.
3. **Resize**: `ResizeObserver` на контейнер канваса (родителя) → `renderer.setSize` с `devicePixelRatio`, пересчёт фрустума ортокамеры под aspect, `invalidate()`. Канвас занимает контейнер целиком (стили — задача страницы; проекция не пишет `style` кроме размеров, необходимых three).
4. **`dispose()`** в обратном порядке (A7): `off` подписок на шину, `ResizeObserver.disconnect()`, `cancelAnimationFrame` активного лупа, обход сцены с `dispose()` геометрий/материалов/текстур, `renderer.dispose()` + `forceContextLoss()`. Повторный `dispose()` — no-op.
5. **`getStats()`** для гварда (A7): `{ frame: renderer.info.render.frame, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }`. Как Playwright достаёт результат фабрики: **dev-only проп** `<Planner onReady={(planner) => …} />` (или аналог), **не** `window.__*`; в проде проп не передаётся, глобалов нет.
6. **`createPlanner`** реально поднимает `ThreeProjection(manager, canvas, { frameBudget })`, `<Planner />` монтирует полноценно (canvas → фабрика → контекст → dispose на unmount) — как в 0048, без второй точки создания.
7. **Тесты**:
   - Jest (без Three, где возможно): `RenderLoop` с фейковым `requestAnimationFrame` (бюджет, самозавершение, повторный `invalidate`, отмена при dispose), маппинг `(x,y,h)→(x,h,−y)` и расчёт фрустума ортокамеры из камеры вида (чистые функции, вынесены из класса).
   - **Playwright-гвард** (testing-strategy, слой 3): открыть `/project/:id`, дождаться `onReady`, ассертить «idle FPS ≈ 0» (за секунду покоя `getStats().frame` не растёт), после resize/событий и unmount (навигация со страницы) `renderer.info.memory.geometries/textures` не растут и после `dispose()` — 0. Расположение и запуск Playwright-тестов — по текущей практике репозитория (если инфраструктуры Playwright-тестов ещё нет — завести минимальную в этой задаче и записать в «Заметках», как запускать).
8. **Приёмка через Playwright MCP** по протоколу доски (UI-задача → визуальная проверка на 1440 / 768 / 390): канвас на весь контейнер, консоль без ошибок и WebGL-предупреждений, после ухода со страницы и возврата — новый планер без утечек.

### Что НЕ в задаче

- Меши стен/полов, свет по умолчанию сверх минимума, colorSpace-настройки — ADR G (шаг 4).
- Интеракция камеры (pan/zoom мышью), кнопки видов, orbit/walk — шаги 2/4/9; здесь камера только читает `Document.view`.
- Canvas2D-конструктор (Q17), превью через render target (шаг 9).
- Изменения в ядре 0048 сверх подключения проекции.

## Приёмка

- [ ] `packages/planner/src/projection/three/`: `ThreeProjection` (один `WebGLRenderer`, одна `Scene`, ортокамера top из `Document.view`, маппинг план→мир в одном месте, подписка на шину), `RenderLoop` (`invalidate()`, `FRAME_BUDGET = 5`, параметр `frameBudget`, самозавершение), `ResizeObserver`, `dispose()` (подписки, observer, rAF, сцена, renderer + `forceContextLoss`), `getStats()`.
- [ ] `createPlanner({ canvas, projectId, logger, frameBudget? })` поднимает проекцию; `<Planner />` монтирует и размонтирует без утечек; dev-only проп для доступа к результату фабрики (не `window.__*`).
- [ ] Jest: `RenderLoop` (все ветки), маппинг/фрустум — зелёные без импорта `three` в тесты.
- [ ] Playwright-гвард: idle FPS ≈ 0 за секунду покоя; `renderer.info.memory` не растёт после resize и повторного mount/unmount; после `dispose()` — 0. Записано, как запускать.
- [ ] Приёмка эпика 0043: `/project/:id` — канвас на весь рабочий контейнер, ортокамера top, пустая сцена, никакого постоянного RAF в покое; unmount освобождает renderer/геометрии/материалы (проверено через `renderer.info` в Playwright).
- [ ] Визуальная проверка через Playwright MCP на 1440 / 768 / 390: канвас на весь контейнер, консоль чистая.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` зелёные; ESLint-слои (`projection/` без `react`) не нарушены.
- [ ] Prettier чист; ровно один PR.

## Заметки

—
