# 0055 · TASK · Команды планировки как транзакции + реальный `history` (снапшоты, два контейнера, coalescing, лимит 100, dirty-флаг)

- Статус: [ ]
- Эпик: 0050
- Зависит от: 0054, 0052
- Спека: docs/adr/0018-mutatsii-tranzaktsii-i-undo-planera.md (ADR D — принятый: D1–D10); docs/adr/0015-arhitektura-dvizhka-planera.md (A2, A5); docs/adr/0016-model-dokumenta-planera.md (B4, B5); docs/product/features/planner/09-undo-redo.md (целиком); 01-walls-and-contours.md («Редактирование», «Клавиатура и мышь» — транзакции); 02-rooms-floors-ceilings.md («Undo/redo для авто-производных объектов»); docs/product/architecture/testing-strategy.md (слой 2, `undo(redo(x)) == x`)
- Нужен дизайн: нет (движок без UI)
- Дизайн: —
- PR: —

## Описание

Слой `engine/` получает то, что нужно инструментам шага 2 и спеке 09: **команды планировки** как транзакции `PlannerStore` и **настоящий неймспейс `history`** вместо заглушки 0048. UI визуально не меняется (кнопки undo/redo — 0061); после задачи движок headless в Jest умеет: добавить контур → комната выведена → `undo` вернул пустой этаж → `redo` вернул комнату; серия `movePoint` под одним coalescing-ключом = одна запись.

Скоуп (по ADR D, границы уточняются — «Заметки»):

1. **Команды планировки** (неймспейс `document`, ADR 0018 D1; `floorId` явный): `addContours(floorId, { kind, points: PlanPosition[] }[])` (сырой результат инструмента; id вершин по квантованной координате — сварка с существующими; валидация ≥ 3 точек / самопересечение / вырожденность), `movePoints(floorId, moves, { coalesce? })` (без геометрической валидации; драг стены — два конца; **разрез стены и слияние точек — не команды**: T-стык и тождество координат делает `normalize` ADR 0017), `deletePoint(floorId, id)` (каскад D2: id снимается со всех владельцев, контур/пол/зона с < 3 точками удаляются, cuts — с зоной), `setEdgeLength(floorId, edge, length, { anchor? })` (симметрично ±Δ/2 или вся Δ на конец, противоположный `anchor`; отказ `too-short` < 15 / самопересечение / `out-of-range`), `setWallWidth(floorId, faces: [FaceRef, FaceRef], width)` (сдвиг `faces[0]` на Δ по нормали; `unknown-axis`); коалесинг-ключи `'edge-length:…'`/`'wall-width:…'` формируют сами команды. Валидация на границе (`Result` с ветками отказа спеки 01), квантование координат (B1), `undefined` в документ не попадает; каждая команда — одна транзакция → `normalize`/`rebuild` (0054) → одно `document:changed`.
2. **API транзакции для истории** (ADR 0018 D5): `store.transact(recipe, meta)` с `meta.history: 'none' | 'reset' | { zone: 'layout' | 'scene'; coalesce?: string }`; коалесинг — замена записи на `pointer` при `lastCommitKey === key`, серия рвётся другим коммитом/undo/redo/`load`/сменой выделения (внутренний `history.breakSeries()`, зовёт `tools`); гейта «мышь зажата» и `removeUndoState` нет — документ не меняется до коммита (граница D↔E), live-драг/превью — в `ToolState` (0057/0059).
3. **`HistoryNamespace` реальный** (ADR 0018 D3–D6, D9): два контейнера memento «stack + pointer» (записи — ссылки на замороженные `floors[i].layout` / `floors[i].scene` всех этажей, снимок после `normalize`); активная зона = зона активного вида, но последняя запись/undo/redo переключает её до следующей смены вида (D4) — `history:changed` и при смене вида; baseline при создании/`load` (`history: 'reset'`), не откатывается; restore = транзакция замены поддеревьев с `history: 'none'` + обычный rebuild; `MAX_HISTORY = 100` сверх baseline, `shift()` на переполнении; redo-хвост сбрасывается новой записью; `undo`/`redo` не трогают `view` и `settings` (`settings` вне истории); хук **`StoreHooks.beforeReplace()`** перед restore и перед `load` — `PlannerManager` подключает `tools.interrupt()` (0057) — имя не переименовывать.
4. **Dirty-флаг** (ADR 0018 D7): поле `PlannerStore`, ставится любой транзакцией содержимого (команды, `settings`, restore), не `view`; наружу `document.isDirty()`, `document.markSaved()` (заглушка до ADR F), событие `document:dirty-changed { dirty }` только при смене; `load`/создание — `false`.
5. **Тесты слоя 2** (все ветки): каждая команда — успех и каждая ветка отказа; удаление точки с общим id по всем комбинациям владельцев; ровно одна запись на коммит, coalescing по ключу, `skip` не пишет; лимит: 101-й push вытесняет самый старый, baseline не откатывается; `undo(redo(x)) == x` и `redo(undo(x)) == x` property-тестом (`fast-check`); `history:changed` только при изменении; `view` не меняется на undo; dirty-флаг по всем веткам; `dispose` снимает подписчиков.

Не в задаче: инструменты и ввод (0057), отрисовка (0056), UI-кнопки (0061), сохранение (шаг 3).

## Приёмка

- [ ] Команды планировки шага 2 в фасаде по ADR D; каждая — одна транзакция → одно `document:changed`; `Result` с ветками отказа спеки 01; квантование на границе.
- [ ] `history`: два контейнера, снапшоты по ссылке, baseline, лимит 100 с trim, redo-сброс, `history:changed`, undo/redo не трогают `view`; dirty-флаг по ADR D.
- [ ] Тесты слоя 2 по списку выше зелёные, включая property `undo(redo(x)) == x`.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` зелёные; ревью субагента-критика (ADR D, спека 09) пройдено.
- [ ] Prettier чист; ровно один PR.

## Заметки

- Скоуп заведён до принятия ADR D (0052); после принятия — сверить состав команд, форму API транзакции (коммит/коалесинг/гейт), правило удаления общей точки, форму dirty-флага и поправить этот файл. Если ADR D решит, что live-драг всё же идёт через документ (`skip`-транзакции), сюда добавляется гарантия «rebuild на каждый кадр не эмитит историю» и перф-оговорка. Если после ADR D объём (7 команд со всеми ветками отказа + история + dirty + property) не влезает в один PR — резать по границе «команды планировки» / «history + dirty», правкой этого файла и одним дополнительным номером.
- **Уточнено по ADR 0018 (2026-08-19):** состав команд, форма `TransactionMeta` (`'none' | 'reset' | { zone, coalesce }`), хук `StoreHooks.beforeReplace`, внутренний `history.breakSeries()`, правило активной зоны D4, dirty-флаг D7 — вписаны в скоуп выше; `splitSegment`/`mergePoints` из скоупа убраны (делает `normalize`). Live-драг документ не трогает — гарантия «rebuild на каждый кадр» не нужна. Если объём не влезает в один PR — резать по границе «команды планировки» / «history + dirty».
