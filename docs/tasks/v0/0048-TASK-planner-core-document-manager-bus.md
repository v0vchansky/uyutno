# 0048 · TASK · Ядро планера без Three: документ, `PlannerManager`, шина, история-заглушка, мост React

- Статус: [x]
- Эпик: 0043
- Зависит от: 0047
- Спека: docs/adr/0015-arhitektura-dvizhka-planera.md (A2, A4, A5, A6, A8, A9); docs/adr/0016-model-dokumenta-planera.md (B1–B7); docs/product/architecture/planner-build-order.md (шаг 1); docs/product/architecture/testing-strategy.md (слои 1–2, «Что считается покрытым»); docs/product/features/planner/README.md («Единицы и координаты», «Принципы»)
- Нужен дизайн: нет (движок без UI; `<Planner />` визуально не меняется — по-прежнему пустой `<canvas>`)
- Дизайн: —
- PR: — (прямой коммит в main)

## Описание

После 0047 пакет `@uyutno/planner` собирается, линтуется и тестируется, но слои `document/` и `engine/` — заглушки. Эта задача заполняет их **ядром без Three и без DOM** ровно по ADR 0015/0016: модель документа, фасад `PlannerManager` с транзакциями через `immer`, типизированная шина `mitt`, история-заглушка, мост с React на `useSyncExternalStore`. Результат — движок поднимается headless в Jest, а `<Planner />` монтирует его так же, как в 0047 (проекция в Three и рендер — задача 0049).

Ровно один PR. UI визуально не меняется.

### Скоуп (что делаем)

1. **Слой `document/`** (plain JSON, чистые функции; ни Three, ни DOM, ни React — ESLint):
   - Типы дерева документа по скетчу ADR 0016 B3 в объёме «нужно шагу 1 и очевидно шагу 2»: `format: 'uyutno.planner'`, `version: 1`, `settings { units, wallHeight }`, `view { activeView, cameras }` (камеры per вид: позиция/поворот/зум 0..1, спека 08/10), `floors[]` с `layout { points: Record<Id, Point>, contours, covers, areas, cuts, rooms }` и `scene { items, rulers, hidden }` — коллекции пустые, типы объявлены. Схемы, отданные в ADR H/J/K (`items` по `kind`, `finishes`, `underlay`), не детализируются: `finishes`/`underlay` в типе не появляются, пока нет ADR — записать в «Заметках».
   - `createEmptyDocument()` (один этаж, дефолтные камеры, `wallHeight = DEFAULT_WALL_HEIGHT = 280`, `units: 'cm'`); `createId()` через `uuidv7` (B2); квантование координат `quantize()` до `0.001` см (B1) — константа рядом с функцией, не в `constants.ts`.
   - Типы и константы — рядом с использованием (`apps/platform/CLAUDE.md`), без `types.ts`.
2. **Слой `engine/`**:
   - `PlannerManager` (фасад, A2) с неймспейсами шага 1: `document` (`get()`, `load(doc)`, команды-мутации — минимум `setSettings`), `view` (`get()`, `setActive`, `setCamera`, `resetCamera`), `history` (`get(): { canUndo, canRedo }`, `undo`, `redo` — заглушка до ADR D: пустая история). Состав команд — из ADR: то, что нужно шагу 1 и монтированию, не больше.
   - Команда = транзакция (A2, B5): `produce` через `immer` с auto-freeze **всегда** → синхронный rebuild производного (пустой `DerivedState`, но место и порядок «мутация → rebuild → ровно одно событие» есть) → одно событие шины. `document.get()` — замороженный снимок; неизменённые поддеревья сохраняют ссылку.
   - Типизированная шина `mitt` с картой `PlannerEvents` (A5): `document:changed { document }`, `view:changed { activeView, cameras }`, `history:changed { canUndo, canRedo }`. `subscribe(cb)` = wildcard `*` (A4), `on/off` — типизированные для проекций; сама шина наружу пакета не отдаётся.
   - Свой `Result<T, E>` (`{ ok: true; value } | { ok: false; error }`), исключений из команд наружу нет.
   - `dispose()` снимает всех подписчиков.
3. **Слой `ui/`**: `PlannerContext` (+ хук доступа к менеджеру с понятной ошибкой вне провайдера), `usePlannerSelector(selector)` на `useSyncExternalStore` (A4: подписка = `manager.subscribe`, `getSnapshot` = `selector(manager)`); `<Planner />` кладёт `manager` в контекст. `createPlanner` без Three-проекции остаётся совместимым: `{ canvas, projectId, logger, frameBudget? } → { manager, projection, dispose }` — проекция подключается в 0049.
4. **Тесты Jest** (слои 1–2 testing-strategy, «вся математика и все ветки»):
   - `document/`: форма пустого документа, plain-JSON (`JSON.parse(JSON.stringify(x))` эквивалентен), `quantize` — обычный случай, обе стороны порога, отрицательные, `-0`, `NaN`/`±Infinity`; `createId` — формат UUID v7, уникальность.
   - `engine/`: транзакционность (ровно одно событие на команду; снимок заморожен глубоко; неизменённые поддеревья — те же ссылки; порядок «состояние обновлено до эмита»; no-op не эмитит), каждая ветка ошибки каждой команды (`Result.ok === false`), `load` (формат/версия), `subscribe`/`unsubscribe`, `dispose`, `history`-заглушка.
   - `ui/`: `usePlannerSelector` в jsdom с `@testing-library/react` (devDeps пакета: `jest-environment-jsdom`, `@testing-library/react`, `react-dom`) — читает начальное значение, ре-рендерит по событию, не ре-рендерит по неизменному примитиву; хук вне провайдера бросает.
5. **ESLint-слои** соблюдены (`document/`, `engine/` — без `three`/`react`/DOM; `ui/` — единственный с `react`).

### Что НЕ в задаче

- Three: `WebGLRenderer`, сцена, камера, `RenderLoop`, `ResizeObserver`, `getStats()`, perf/leak-гвард — **0049**.
- Геометрия (`document/geometry/`, ADR C), инструменты (ADR E), реализация undo (ADR D), save/load с бэкендом и zod-схема (ADR F) — шаги 2–3.
- Правки спеки `features/planner/*` и ADR — если ADR нужно уточнить фактом, одна строка в «Заметках».
- Playwright/визуальная приёмка: UI не меняется (тот же пустой `<canvas>`).

## Приёмка

- [x] `packages/planner/src/document/`: типы дерева по ADR 0016 (`format`, `version`, `settings`, `view` с `activeView` и камерами видов, `floors[].layout {points, contours, covers, areas, cuts, rooms}`, `floors[].scene {…}`), `createEmptyDocument()`, `createId()` (uuidv7), `quantize()`; тесты на все ветки.
- [x] `packages/planner/src/engine/`: `PlannerManager` с неймспейсами `document` / `view` / `history`, транзакции через `immer` (auto-freeze всегда) с sync rebuild-хуком, шина `mitt` с событиями `document:changed` / `view:changed` / `history:changed`, `subscribe(cb)` = wildcard, свой `Result<T, E>`; тесты: одно событие на команду, замороженный снимок, структурное разделение, все ветки ошибок.
- [x] `packages/planner/src/ui/`: `PlannerContext`, `usePlannerSelector` на `useSyncExternalStore`; `<Planner />` кладёт `manager` в контекст; тест хука в jsdom.
- [x] `createPlanner` совместим с 0049 (`{ canvas, projectId, logger, frameBudget? } → { manager, projection, dispose }`), `ProjectPage` монтирует без изменений поведения.
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` зелёные (вывод в «Заметках»); ESLint-слои не нарушены.
- [x] Ревью субагента-критика (ADR 0015/0016, конвенции CLAUDE.md) пройдено, замечания устранены или записаны.
- [x] Prettier чист; ровно один PR.

## Заметки

Решения в рамках ADR (установка автора: «правильно, надолго»):

- **`PlannerDocument`, а не `Document`.** Пакет компилируется с `lib: dom`; тип `Document` из скетча ADR 0016 совпал бы по имени с DOM-глобалом, и забытый импорт молча подхватывал бы не тот тип. Экспорт из `@uyutno/planner` — `PlannerDocument`. _(ADR 0016 при желании уточнить одной строкой.)_
- **Транзакция — одна точка `PlannerStore.transact(recipe)`**: `immer.produce` → если изменилось что-то кроме `view` — sync rebuild в **две фазы**: `normalize(draft)` (нормализация хранимого в том же снимке, шаг 2) и `rebuild(document)` — чистая функция от уже финализированного замороженного снимка (в `DerivedState` не могут утечь immer-прокси черновика; замечание критика) → фиксация → события **по одному на изменившийся факт**: `document:changed` при изменении содержимого, `view:changed` при изменении `view`, ни одного при no-op (immer вернул тот же объект). Следствия: `setSettings`/будущие команды инструментов → одно `document:changed`; `view.*` → одно `view:changed` без rebuild; **`load` — единственная команда с двумя событиями** (`document:changed` + `view:changed`), т.к. заменяет оба факта. Формулировка ADR «ровно одно событие» трактована как «одно на факт»; если автор хочет строго одно на команду — `load` можно оставить только с `document:changed` (payload содержит `view`), но тогда проекция обязана перечитывать камеру и по нему.
- **Свой экземпляр `new Immer({ autoFreeze: true })`** вместо глобального `produce`: auto-freeze не зависит от чужих `setAutoFreeze` в приложении-хосте (глобалов нет).
- **Производное состояние** — `DerivedState { floors: DerivedFloor[] }` (пока только `id` этажа), доступно как `document.getDerived()` (для проекций, ADR G); пересобирается только при изменении содержимого; заморожено.
- **`document.load(doc)`** проверяет только `format === 'uyutno.planner'` и `version` (целое, `1 ≤ v ≤ DOCUMENT_VERSION`), zod/миграции — ADR F; документ замораживается на месте (`freeze(doc, true)`) — им владеет движок, копий нет.
- **`setSettings(patch)`** пишет поля поимённо (`undefined` в документ не попадает); `units` — из `UNITS`, иначе `invalid-units`; `wallHeight` — конечное `> 0`, иначе `invalid-wall-height`. **`setCamera(view, camera)`** типизирована по виду и валидируется **по схеме камеры вида** (ключи дефолтной камеры): каждое поле обязательно и конечно, лишние → `invalid-camera`, `zoom ∈ [0, 1]`; неизвестный вид → `invalid-view` (то же для `setActive`/`resetCamera` — строковые входы проверяются на рантайме, потому что шаг 3 принесёт сырой JSON). Координаты камеры (`x`, `y`, `elevation`) **квантуются** `quantize` как любая координата документа (B1), все числа нормализуют `-0 → 0` (иначе `load(save(x)) == x` ломается на `Object.is`). Поля присваиваются поимённо, чтобы immer видел no-op при тех же значениях.
- **`history`** — пустая история: `get()` = стабильный `{ canUndo: false, canRedo: false }`, `undo`/`redo` → `err({ kind: 'nothing-to-undo' | 'nothing-to-redo' })`; `history:changed` объявлен в карте шины, не эмитится (ADR D).
- **Форма камер** (`Document.view.cameras`, спека 08/10 + числа из реверса roomtodo 08): `plan { x, y, zoom }`, `orbit { x, y, elevation, pan, tilt, zoom }`, `walk { x, y, pan, tilt }` (высота глаз фиксирована спекой; fov-пресет walk не хранится — спека не требует). Дефолты: plan `(0,0, zoom 0.5)`; orbit `(0,0, elevation 110, pan 45, tilt 45, zoom 0.1)`; walk `(0,0,0,0)`. Смысл шкалы `zoom` (в масштаб/дистанцию) — проекция вида, ADR G. Камеры конструктора в документе нет (парковка ADR E/G). **Вопрос автору:** схема orbit/walk — ок как задел, или сузить до `plan` до шага 4?
- **`FloorScene`** = `{ items, rulers, hidden }`; `finishes` (ADR J) и `underlay` (ADR K) в типе отсутствуют до своих ADR — форма дерева не меняется, поля добавятся. `SceneItem` — по скетчу ADR (`kind`, `catalogId`, `x/y/elevation/rotation`), поля по `kind` — ADR H.
- **`quantize`**: `round(v·1000)/1000` (без хвостов плавающей точки), `-0 → 0`, не-конечные значения пробрасываются (валидация — на границе команды).
- **`<Planner />`**: менеджер создаётся в `useEffect` (нужен canvas), кладётся в `useState` → дети рендерятся внутри `PlannerContext` только когда движок поднят (до эффекта и в SSR — нет); `subscribe` — стрелочное поле менеджера (стабильная ссылка для `useSyncExternalStore`, без `bind`). `usePlannerSelector` — серверный снимок = тот же селектор. **Вопрос автору (вне ADR):** панели скина — как `children` `<Planner>` рядом с `<canvas>` (фрагмент, лэйаут задаёт страница) или `<Planner>` становится контейнером с оверлеями внутри — решить, когда появится первый макет панелей.
- **`document/index.ts`-заглушка удалена**: внутри пакета импорт по файлам, единственный `index.ts` — публичный API пакета.
- **jsdom для `ui/`**: devDeps пакета `jest-environment-jsdom`, `@testing-library/react`, `@testing-library/dom`, `react-dom`, `@types/react-dom`; тесты с `/** @jest-environment jsdom */`. `react-dom` — только devDep (пакет его не импортирует; рендерит платформа).
- **`dispose()`** менеджера снимает подписчиков (`bus.all.clear()`); команды после dispose работают, событий не порождают — «мёртвый» менеджер не бросает из размонтированных эффектов.
- **Изоляция подписчиков:** `subscribe`/`on` оборачивают хендлеры в `try/catch` → ошибка в `logger.error('subscriber threw')`, команда возвращает `ok`, остальные подписчики и второе событие (`load`) доставляются (ADR A2 «исключений наружу нет»; `mitt` сам хендлеры не защищает). `on` — тоже стрелочное поле (переживает деструктуризацию).
- **`<Planner logger />` — любая ссылка:** пропс-логгер держится в `useRef`, планеру отдаётся стабильный делегат, эффект зависит только от `projectId`; inline-`logger={{…}}` больше не пересоздаёт движок. `Planner.tsx` переехал в папку `ui/Planner/` (компонент — папкой, `src/client/CLAUDE.md`). Из публичного API убран сам `PlannerContext` (контекст — внутри пакета, ADR A4): наружу `usePlannerManager`/`usePlannerSelector`; экспортированы все типы сущностей документа.
- **Ревью критика (субагент):** blocker'ов нет; закрыты все should: изоляция исключений подписчиков, `assignCamera` по схеме (лишние/недостающие поля), `-0`/квантование камер, `logger` вне deps эффекта, двухфазный rebuild, тесты на SSR (`renderToString`: canvas есть, планер не поднимается, детей нет), на несколько подписчиков/повторную отписку, `load` того же снимка и JSON-копии (round-trip B5), `load(null)`, ошибки камер по orbit/walk, смену менеджера в контексте. Nits: `HistoryState` перенесён к `HistoryNamespace` (тип рядом с использованием), `PlannerManagerParams` не экспортируется. Не делалось: `load` замораживает объект вызывающего на месте — оставлено сознательно (владение переходит движку, задокументировано в JSDoc).

Прогоны (2026-08-18, после правок по ревью): `pnpm typecheck` — `packages/planner typecheck: Done`, `apps/platform typecheck: Done`; `pnpm lint` — без вывода (0 ошибок); `pnpm test` — `packages/planner: Test Suites: 10 passed, 10 total / Tests: 113 passed, 113 total`, `apps/platform: Test Suites: 11 passed / Tests: 81 passed`; `pnpm build` — `client (webpack 5.109.2) compiled with 3 warnings` (только pre-existing size-limit warnings, бандл 609 KiB), `server (webpack 5.109.2) compiled successfully`; SSR-смоук `node dist/server/server.js` → `/project/abc` 200 с `<canvas class="block h-full w-full">`. Prettier чист по файлам задачи. Локальный Node v20.17 при `engines >=22` — pnpm предупреждает, всё проходит.
