# Валидация competitor-mechanics против roomtodo-src

> Дата: 2026-08-13 (валидация + фикс-раунд). Источник правды: `roomtodo-src/plannercore.js` (81349 стр., НЕ минифицирован), `tris.js` (10001), `OrbitControls.js` (1115). React/UI-бандл и user.js — вне области. Per-doc отчёты — в `_validation/`.

## TL;DR

- Первичная валидация: 1276 claims, 90.6% CONFIRMED, 16 WRONG, 90 drift, 17 UNVERIFIABLE.
- Фикс-раунд: ~109 точечных Edit'ов через 21 доку, ~7 ложных drift-заявлений валидатора отвергнуты после re-verify, ~3 настоящих семантических правки (включая снятие ложного заявления о баге в нашей же доке), 11 из 11 in-scope UNVERIFIABLE разрешены.
- Статус сейчас: **доки можно использовать как источник для проектирования собственного редактора.** Все WRONG закрыты, все drift ≥3 строк подтянуты, все in-scope UNVERIFIABLE разрешены или конкретизированы.

## Что было исправлено (сводно)

### Настоящие семантические правки (не просто анкеры)

- **03-rooms-floors-structure L161** — sort/reverse. Было: «sorts descending, reversed to smallest-first». Стало корректно: `sortByArea` возвращает descending, затем `.reverse()` даёт итерацию smallest-outer-first, largest-outer-last (комментарий источника `o -> O` это подтверждает).
- **05-selection-transform-grouping L87** — `ProductTransform2DButton`. Было: «действует второе определение с `size=10` (77215/77223)». Реально: второе определение целиком закомментировано, действует первое определение с `size=7` (77158). Правка отражает актуальное поведение.
- **deep-05-cover-build3d L335-339** — снято ложное заявление о баге `dCeil` hoisting. `var dCeil` объявлен внутри covers-loop и не пересекается со zones-loop; логика корректна, бага нет. Утверждение из доки удалено.

### Разрешённые UNVERIFIABLE (11 из 11 in-scope)

- **00-overview L75 + 10-serialization** — PLINTH type-5: объявлен на 17844, парсера/писателя нет. Подтверждено.
- **03-rooms L230** — `PoolPlinthShape` 16 записей: bottom (0-7) / top (8-15) подтверждено grep'ом.
- **05-selection L87** — SVG-версия `ProductTransform2DButton` закомментирована (см. выше).
- **10-serialization L152** — inner cover: hard-coded материалы `m:'1', mc:'0', mr:0` на 53685-53686, не «defaults from table». Формулировка исправлена.
- **10-serialization L311** — `R2D.URL`: server-injected через template literal на 24583. Задокументировано.
- **11-floorplan L163** — live caller `setPlanAlignLength` находится вне `plannercore.js` (host UI). Помечено явно.
- **12-catalog L200** — KTX2/meshopt loaders: negative claim подтверждён отсутствием вызовов `.setKTX2Loader(` / `.setMeshoptDecoder(`.
- **deep-05 L330-332** — Materials side: `DoubleSide` на 31270 подтверждена; разводка coplanar cap/ceiling идёт через `checkCeilingVisible`, а не через нормали.
- **deep-05 L335-339** — `dCeil` hoisting: опровергнуто (см. выше).
- **deep-05 L340-342** — «первый билд с центром (0,0) до пересчёта bbox» подтверждено на 51224/51763.
- **deep-05 L343-346** — `cameraFrom.z` = высота (сигнатура `{x,y,h}` @55734). Подтверждено.

### Контр-факты к валидатору (найдены fix-агентами при re-verify, ~7)

- **03-rooms L209** — валидатор заявлял drift `rebuildWalls(pairs)` 65262→65266, реально анкер в доке уже был корректный.
- **03-rooms L210** — валидатор заявлял drift area-loop 65322-65350→65324-65352, реально анкер в доке уже был корректный.
- **07-measurements-rulers L47** — `Imperial.squareToString`: валидатор дал «реально 11244», фактическое значение 11222.
- **deep-05 L49** — `ELEMENT_CREATE cover/ceiling` 55506/55507: анкеры уже были верны, валидатор ошибся с +2 drift.
- **deep-05 L266** — `outerCovers.reverse()` 60425: анкер в доке уже был корректный.
- **deep-10 L34** — `exclude.children.includes(obj)` 36521: заявленный drift +1 не подтвердился, анкер верен.
- **deep-10 L327** — `maxMoveDist` 44589: заявленный drift −3 не подтвердился, анкер верен.

## Оставшиеся open items

**In-scope UNVERIFIABLE (0):** все разрешены в фикс-раунде.

**Out-of-scope UNVERIFIABLE (6):** только `13-uploads-ai-render-export` — факты в React/user.js вне окна валидации:

- `rendersPrices` в `renderMake/main/Main.jsx:424-428` (React).
- Валидация ≤60 МБ / ≤50 частей в `UploadCustomModelPopup.jsx` (React; в plannercore подтверждены только API `getTotalTriangles@20177`, `getPartsHashes@20187`).
- Поллинг 500 мс / прогресс `progress*3` в `UploadCustomModelAiPopup.jsx` (React).
- `UserRenders.makeRender` / 15000 мс поллинг / `RendersAnd360Popup.jsx` (user.js + React).
- `UserExport.makeExport`, `Export3DProjectPopup.jsx` 500 мс поллинг, `ExportPopup.jsx` gate, `ifcStatus`-событие (user.js + React).
- `pdfCreator.createView2D` (user.js + React).

Для порта нашего редактора эти факты не нужны, если планируем собственный backend и собственные UI-модалки.

## Итог для проектирования

Доки готовы как reference. Порядок работы: начинать с feature-спецификации `editor-mvp.md` (см. `docs/product/features/`), затем ADR — «single-FSM + single-model» (обходим два ключевых антипаттерна конкурента: параллельные state-машины `WC.State*`/`R2D.MIH.State*` и дублирование модели данных между `WC.core` и `R2D.Scene`), затем walking skeleton на Three.js r185+TS.

Ключевые константы (`WC.SNAP_DIST=10`, `TR.L_EPS=1e-8`, `TR.B_EPS=1e-4`, `WC.DEFAULT_WALLS_HEIGHT=280`, `WC.MAX_WALL_WIDTH=80`, `MIN_WALL_LENGTH=15`, `maxConnectorLength=40`, `radiusDropElement=10`), стейт-машины (все `WC.State*` и `R2D.MIH.State*`), пайплайны rebuild (`rebuildWallsAndCovers` → `resetWalls`/`resetCuts`/`resetAreas` → `findAutoCovers`/`rebuildCovers`), снап-приоритеты (порядок и радиусы в `WC.snapPos`), митра (deep-02), triangulation-ядро (cdt2d + clean-pslg через `tris.js:1912-1921`, ни одного упоминания `poly2tri`/`SweepContext`) — всё верифицировано построчно. Порт можно вести без обращения к `plannercore.js` на каждой строке: доки самодостаточны для проектирования, а точечные ссылки на источник даны для случаев, где семантика тонкая (митра, contour-tracing, cover-build3d).

## Первичная статистика (для истории)

Baseline первичной валидации (24 субагента). После фикс-раунда WRONG=0 во всех докax, drift ≥3 строк подтянут, in-scope UNVERIFIABLE=0.

| Doc | Audited | Confirmed | Drift (baseline) | Wrong (baseline) | Unverif. (baseline) | Комментарий |
|---|---|---|---|---|---|---|
| 00-overview | 27 | 26 | 0 | 0 | 1 | самый чистый top-level; PLINTH разрешён |
| 01-walls | 62 | 62 | 0 | 0 | 0 | эталон, всё точно до строки |
| 02-doors-windows | 38 | 33 | 5 | 0 | 0 | сдвиги ±1..±16 подтянуты |
| 03-rooms-floors-structure | 62 | 55 | 5 | 1 | 1 | sort/reverse переформулирован; PoolPlinthShape подтверждён |
| 04-furniture-placement | 82 | 74 | 8 | 0 | 0 | drift подтянут |
| 05-selection-transform-grouping | 68 | 65 | 2 | 0 | 1 | ProductTransform2DButton size=7 (правка) |
| 06-materials-textures | 78 | 74 | 3 | 1 | 0 | touchEnd guard якорь исправлен |
| 07-measurements-rulers | 62 | 46 | 9 | 7 | 0 | вся имперская цепочка перепривязана |
| 08-cameras-views | 92 | 88 | 3 | 1 | 0 | цитата CAMERA_MOVE исправлена |
| 09-undo-redo-history | 62 | 55 | 7 | 0 | 0 | ±1..±2 подтянуты |
| 10-serialization-save-format | 62 | 55 | 4 | 1 | 2 | preview JPEG; inner cover hard-coded; R2D.URL server-injected |
| 11-floorplan-import-align | 48 | 44 | 3 | 0 | 1 | live caller помечен как host UI |
| 12-catalog-assets | 42 | 38 | 2 | 1 | 1 | UPLOAD_ prefix уточнён; KTX2/meshopt отсутствуют |
| 13-uploads-ai-render-export | 27 | 20 | 1 | 0 | 6 | 6 остаются out-of-scope (React/user.js) |
| deep-01-triangulation-core | 42 | 41 | 1 | 0 | 0 | эталон |
| deep-02-wall-mitering | 38 | 36 | 2 | 0 | 0 | эталон |
| deep-03-contour-tracing | 42 | 41 | 0 | 0 | 0 | эталон |
| deep-04-3d-mesh-uv | 32 | 30 | 2 | 0 | 0 | якорь findTriCover унифицирован |
| deep-05-cover-build3d | 52 | 48 | 4 | 0 | 4 | все 4 unverifiable разрешены; ложное заявление о dCeil-баге снято |
| deep-06-opening-holes | 42 | 36 | 5 | 1 | 0 | findPlinthGaps переформулирован |
| deep-07-wall-axes-pipeline | 62 | 55 | 6 | 1 | 0 | modelData.depth якорь исправлен (2 места) |
| deep-08-geometry-predicates | 54 | 47 | 6 | 1 | 0 | range-check angle переформулирован |
| deep-09-wall-snap-internals | 42 | 39 | 3 | 0 | 0 | drift в mouseUp черчения подтянут |
| deep-10-furniture-stacking | 58 | 48 | 9 | 1 | 0 | y<−3 якорь 11295→11292 (2 места); 2 контр-факта к валидатору |
| **TOTAL** | **1276** | **1156** | **90** | **16** | **17** | **baseline 90.6% confirmed; после фикс-раунда WRONG=0, in-scope UNVERIFIABLE=0** |

## Системные паттерны ошибок (для будущих валидаций)

- **Body vs declaration**: анкер функции = строка `= function(` / `class`, не первое использование внутри тела.
- **Один якорь на два факта**: давать диапазон или два якоря, если пункт доки описывает две смежные строки (`04-furniture L121`).
- **Цитировать код дословно**: не переформулировать (`08-cameras L104` — `apiDispatcher.CAMERA_MOVE`, не глобальный `CAMERA_MOVE`).
- **Один неверный якорь повторяется**: batch-fix искать по значению строки (deep-07 `55199`×2, deep-10 `11295`×2).
- **Валидатор тоже ошибается**: обязательный re-verify перед применением правки (в этом раунде — 7 ложных drift-заявлений валидатора отвергнуты).

## Appendix: Original per-doc details (baseline, pre-fix)

> Зафиксировано первичной валидацией до fix-раунда. ~7 drift-заявлений были отвергнуты fix-агентами при re-verify — см. основной раздел «Контр-факты к валидатору». Оставлено для истории; сами доки уже отражают исправленное состояние.

### 00-overview.md
**Drift:** —
**Notes:**
- Все ключевые константы точны до знака и строки: `WC.SNAP_DIST=10` (60604), `WC.POINT_SIZE=6` (60605), `WC.CLICK_SHIFT=3` (60608), `WC.MAX_WALL_WIDTH=80` (54379), `WC.MIN_WALL_LENGTH=15` (54380), `WC.DEFAULT_WALLS_HEIGHT=280` (59320), `radiusDropElement=10` (13092), `TR.L_EPS=1e-8` (49482), `TR.B_EPS=1e-4` (49483), `TR.roundCoord` округляет до 0.001 (50554–50558).
- `R2D.createPlannerAPI` (600): 7 неймспейсов установлены на L602–608, только `apiScene` (602) и `apiConstr` (606) — EventDispatcher, остальные пять — простые `{}`. Методы верхнего уровня начинаются с L610 (`planner.mih`, `planner.zoomToMax` и далее) — подтверждено.
- Топология: `CPoint` 56814, `CWall` 56870, `CContour` 56890 (fields `points`/`holes`/`triangles` на 56896–56898), `CRoom` 56946 (наследует CContour через 56962). Диапазон "56890–56898" для полей CContour корректен.
- Data-классы: `DataWall` 52759 (флаг `changed=true` на 52795 подтверждён), `DataCut` 51682, `DataFrame` 51889, `DataPlug` 52053, `DataCover` 51725, `DataCeiling` 51789, `DataPlinth` 51436, `DataArea` 51617 — все объявлены как утверждается.
- Ссылка на `SNAP.Snap2D`: дефолт 10 на L9477 корректен (это конструктор JS-класса SNAP.Snap2D, не «конструктор стен»), значение 15 на L41668 — в `R2D.MouseInteractionHelper._snap2d.updateDistance(15)`. Формулировка "дефолт конструктора 10" в доке немного двусмысленна (может читаться как «конструктор стен»), но фактически верна для JS-конструктора класса.
- Bootstrap: `WC.core = new WC.WallsCore()` на 60583 подтверждён; сборка вьюверов на L66–76 подтверждена (Scene3D, Renderer3D, CommonSceneObject, MouseInteractionHelper, viewConstructor, view2d, view3d, viewWalk).
- `scene3d.bottom/middle` в основном render-цикле: renders на 36638, 36640 (диапазон "36638–36641" охватывает `clearDepth` на 36642) — корректно.
- Три вспомогательных `THREE.WebGLRenderer`: L19715, 19781 (ModelUploader — превью + cube), 21426 (MaterialUploader), 29435 (R2D.Tool preview) — все подтверждены.
- `maxActions=100` на L12299 объявлен как локальный `let`; ни `splice`, ни `pop` под него в теле `SceneHistory` (12295–12374) не найдено — утверждение "лимит не форсится" согласуется с локальной проверкой (полный аудит истории — вне зоны overview).
- `productSizes` — единственное упоминание в plannercore.js на L12351, только в guard-е saveState (никогда не передаётся как label). Подтверждает "нигде не вызывается".
- `private_material` — user.js:50, `me.data.add_mat = features.includes('private_material')` — точно как в доке.

### 01-walls.md
**Drift:** —
**Notes:**
- Все анкеры (номера строк) в доке точны до строки: `WC.StateEditing` 64529, `WC.StateDraggingPoint` 64013, `WC.StateDraggingWall` 64292, `WC.StateMakingArea` 65197, `WC.StateMakingRect` 65560, `WC.StateMakingWalls` 65855, `WC.StateMakingRoom` 66624, `WC.BaseState` 63057, `R2D.MIH.BaseState` 43487, `WC.SnapTool` 57221, `getSnapPoint` 57568, снап-лесенка 57629–57696, `blocksFromContour` 57922, `d = -wallsWidth` 57930, `recalcAng = Math.PI*0.75` 57924, C/D в разомкнутой ветке 58039–58040, fallback `C=L01;D=R01` 58048–58049, `A=C;B=D` 58064, замкнутая ветка 58099–58121, `DataPlug` 52053, `DataWall` 52759, `DataWall.build3D` 53070, `createConnectors` 54382 (доке 54495 — на `createPlug3D`), `createPlug3D` 54495 (два треугольника 54507–54508), `maxConnectorLength = 40` 54384, `WC.MIN_WALL_LENGTH = 15` / `WC.MAX_WALL_WIDTH = 80` 54379–54380, `WC.DEFAULT_WALLS_HEIGHT = 280` 59320, `WC.SNAP_DIST = 10` 60604, `WC.POINT_SIZE = 6` 60605, `WC.CLICK_SHIFT = 3` 60608, `WallsCore` 59323, `WallsData` 55010, `WallsData.setStructure` 55088, `WallsData.getData → structureToShort` 55073/53502, `wallsEditor.setStructure` 61476, `wallsEditor.getStructure` 61611, `setStructureToWallsData` 62325, `rebuildWallsAndCovers` 59533, `rebuildWalls` 59582, `resetWalls` 60139 (match+pointOnLine ветки 60164/60179), `connectAllPoints` 60285, `delPoint` 59361 (слияние двух стен 59411), `TR.rebuildContours` 51094, `TR.compareContoursByArea == INTERSECT` 59695, `TR.contourValid` 50525, `TR.contourSelfIntersected` 49845, `TR.roundCoord` округляет до 0.001 (50558), MIH init на 41925.
- `StateMakingWalls`: `me.wallsWidth = 10` (65864), стартовый `currentPt` из `WC.realPos` без снапа (65885), `signSide*wallsWidth` (65921), undo `splice(length-2, 1)` (65956), `calcStart` (66024) с `signSide=±1` по меньшему углу к соседям (66036–66046), фиксация после 3-й точки (66055), замыкание по `euclDist(lastPt, cur) ≤ wallsWidth` ИЛИ `euclDist(firstPt, cur) ≤ 0.1` (66063–66064). Мин. экранная длина инпута `minLen = 45` (66261).
- `StateMakingRoom`: `≥ 4` точки + `TR.contourValid` (66664); замыкание — `TR.manhDist ≤ eps=0.1` к первой или предпоследней (66779). CONFIRMED.
- `StateMakingArea`: заливка `rgba(0, 255, 0, 0.1)` (65482), отказ при `compareContours != OUTSIDE && != CONTACT` (65246). CONFIRMED.
- `StateEditing` хит-тест: `findNearest` в `POINT_SIZE/scale` (64564), сторона через `pointOnLine` с точностью `SNAP_DIST/2/scale` (64659), драг начинается при сдвиге `> POINT_SIZE/2` (64995 — константа `POINT_SIZE`, не `CLICK_SHIFT`; доc корректно это различает). Ctrl→`StateSelectedRoom` 65033–65035. Удаление точки в два клика через `dblClickToDel` (65099–65118).
- `StateDraggingWall`: `ptDir2 = perpendicularPoint(startPosA, startPosB, 100)` (64321), оба конца двигаются на одинаковую дельту (64355–64356). CONFIRMED.
- Заметка о доке: L54 говорит «мост между ними — ручной», и `WallsData` не имеет своего `getStructure` — save идёт через `getData() → structureToShort`. Проверено: `grep me.getStructure` даёт единственный хит на 61611 (wallsEditor), у `WallsData` только `me.getData` 55073. CONFIRMED.
- Единственная мелочь для будущей чистки (не WRONG): доc в §Data model пишет «`createConnectors`→`DataPlug`→`createPlug3D`» без строки, но это верно и подтверждено на 54382→54484→54489. Все числовые анкеры в §Geometry rebuild (54507–54508 для двух треугольников плага, 52053 для `DataPlug`, 53070 для `build3D`) точны.

### 02-doors-windows.md
**Drift:**
- 02-doors-windows.md L7: `radiusDropElement = 10` заявлен `R2D.Scene, 13092/13218` — 13092 объявление, 13218 первое использование (`dropElement`); формулировка корректна, но неявна.
- 02-doors-windows.md L38: `drawDoor14/drawDoor15, ~34685` — реально `drawDoor14` = 34669, `drawDoor15` = 34725; 34685 попадает внутрь тела `drawDoor14` (drift +16 от начала).
- 02-doors-windows.md L26: `DataPlug (type:'plug', 52053)` — `WC.DataPlug = function(...)` начинается на 52053, но `me.type = 'plug'` установлено на 52066 (drift +13).
- 02-doors-windows.md L32: `SNAP.Snap2D (9471)` — реально `SNAP.Snap2D = function()` на 9476 (9471 — заголовок комментария `// snap`), drift +5.
- 02-doors-windows.md L46: `calcTotalSizesOneSwing (35097)` — функция на 35098, формула на 35101 (мелкий off-by-one).

**Notes:**
- Ключевые якоря все на месте: `dropElement`:55172, `moveElement`:55154, `pickElement`:55241, `getAxis`:55338, `DataCut`:51682, `DataFrame`:51889, `DataPlug`:52053, `Axis`:52086, `getHoles`:52990, `triangulateContours` вызов:53185, `createFramesForAxis`:55677, `createFrame3D`:54606, `bottomHeight=2`:54608, `createConnectors`:54382, `maxConnectorLength=40`:54384, `resetCuts`:60188, `compareAndRebuildContours`:54944.
- Формулы `getHoles` (L54–56 в доке) полностью совпадают со строками 53019–53023/53035–53039 (парные ветки parallel/!parallel).
- Краевой отступ 5 см (`model.axisPos > axisLength − 5`) — реально на 61994 (доке 61995) — сдвиг на 1 строку.
- Сериализация `DataCut` `{id, pa, pb, m, addM, mr, mx, my}` (53531) и `areas` (53602) — подтверждено дословно.
- `cdt2d`/`clean-pslg` — подтверждено в tris.js:1912–1913 (`window.cdt2d = require('cdt2d')`, `window.cleanPSLG = require('clean-pslg')`).

### 03-rooms-floors-structure.md
**Drift:**
- 03-rooms-floors-structure.md L119: `TR.contoursAdjacent` заявлен L51153; call site на 51153, но определение — 51161 (ambiguous, kept as call-site).
- 03-rooms-floors-structure.md L118: clearDict/`getOneContour` заявлен L50772-50789; реально clearDict body 50790-50820, outer while 50770-50789.
- 03-rooms-floors-structure.md L116: `TR.angleBetweenLines` заявлен L50869-50909 (диапазон call-site); реально определение fn на 49754.
- 03-rooms-floors-structure.md L209: `WC.core.rebuildWalls(pairs)` заявлен L65262; реально 65266 (drift +4).
- 03-rooms-floors-structure.md L210: area-loop заявлен L65322-65350; реально 65324-65352 (drift +2).

**Notes:**
- All major pipeline anchors verified: `rebuildWallsAndCovers` L59533, `roundAllPoints` L59552, `rebuildWalls` L59582, `findAutoCovers` L59714, `rebuildRelatedCovers` L59810, `rebuildCovers` L59909, `delIntersectedAreas` L60101, `resetWalls` L60139, `resetCuts` L60188, `resetAreas` L60221, `connectAllPoints` L60285, `findCoverHoles` L60406, `findAllCoverTriangles` L60450 — all exact.
- Constants exact: `TR.L_EPS=1e-8` L49482, `TR.B_EPS=1e-4` L49483, `WC.SNAP_DIST=10` L60604, `WC.POINT_SIZE=6` L60605, `maxConnectorLength=40` L54384, `WC.DEFAULT_WALLS_HEIGHT=280`/`DEFAULT_AREA_HEIGHT=100` L59320-59321, `TR.roundCoord` L50554, `compareContoursByArea` setSize=10 L49965, 8 relation constants L49473-49480.
- Data* classes exact: DataObject L51212 (addNullData L51397), DataPlinth L51436, DataArea L51617, DataCut L51682, DataCover L51725, DataCeiling L51789, DataPlug L52053. Material key claim (`DataCeiling` default "wall", ceiling data.materialID "ceiling") verified at L51793 and L56994.
- Contour classes exact: CContour L56890, CRoom L56946, CCover L56965, CArea L57027; `getAllPairs` L57085, `getCutWallPairs` L57098; `calcArea` L56919 (doc says L56918 — off by 1).
- Plinth infra exact: PlinthShape L56396, PlinthCreator L56405, PoolPlinthShape L56412, loadSVG L56691, createPlinthShape L56701; top forces `shapeNum≥8` at L51516 (doc's "8" boundary confirmed). Skip condition `-bounds.maxY >= me.bottomPlinth.h` at 53301 exact.
- State classes exact: StateDraggingCoverPoint L63910, StateDraggingCoverSide L64408, StateMakingArea L65197, StateMakingCover L66322, StateSelectedCover L66882, StateSelectedRoom L67310, `findInnerStuf` L67405, StateSelectedArea L67638, `setCeilingHeight` on state L67030; `minLen=45` at L66578 (StateMakingCover) confirmed, but same const also appears at 65500/66261/66825 for other states.
- All 6 sample `rebuildWallsAndCovers()` call sites (L60776, L61598, L64037, L65108, L66680, L70155) confirmed exact.

### 04-furniture-placement.md
**Drift:**
- 04-furniture-placement.md L58: `stateSelectedProduct isClicked=false ставится в mouseUp (44961)` — реально 44981 (drift +20); 44961 — внутри mouseMove.
- 04-furniture-placement.md L117: parallel-фильтр 0.2 рад (9846) — формула `deltaAng` на 9846, а пороги/`continue` — 9847–9850.
- 04-furniture-placement.md L121: гейты `height/box.height > 5` OR `area/box.area > 25` (9966) — height-гейт на 9966, area-гейт на 9967 (два гейта под одним якорем).
- 04-furniture-placement.md L189: `APPOINTMENT_WALL "wall" vs "scene" (11473)` — реально 11474 (off by 1).
- 04-furniture-placement.md L212: `prevParamsMap (30177)` — реально объявлен на 30159, use на 30178; 30177 не попадает ни на объявление, ни на use.
- 04-furniture-placement.md L216: `isPointAtPointsList (30368)` — метод объявлен на 30790, первый вызов на 30369 (off by 1 от вызова).
- 04-furniture-placement.md L226: `OBJECT_DRAG_OUT_OF_WALL (43906)` — реально dispatch на 43907 (off by 1).
- 04-furniture-placement.md L245: `dropElement 10 см (55174)` — на 55174 default snapDist=10; сигнатура упоминается как 55172 — мелкое расхождение сигнатура/дефолт.

**Notes:**
- Все ключевые числовые пороги CONFIRMED: click-vs-drag 5 px (43537), start-drag ≥1 px (44959), snap 15 см (41668), moveElement 20 см (43989), dropElement 10 см (43890/14038/55174), smart-test `max/min < 15 && volume < 30000` (43940/43946), rMax=300 (44612), minRealSize=2 (77350), ratioUV=0.01 (30158), findFreeSpace margin=1.5 (10096), moveInFrontOfLines deltaAngle=π·0.2 (10046).
- Все ключевые классы/функции найдены по указанным строкам: `SceneObject` 11230, `Creator.makeSceneObject` 18035, `ObjectViewer3D.make` 31864, `MouseInteractionHelper` 41556, все `R2D.MIH.State*` (43487–45564), `SNAP.Snap2D` 9476 и его методы (`snapPolygon` 10007, `snapPolygonToNearestLine` 9742, `snapPolygonToNearestLineInOneDirection` 9807, `snapPolygonToBox` 9937, `findFreeSpace` 10094), `moveObjectHorizontal` 43952/44390, `moveObjectSmart` 44036, `moveObjectStraight` 44076, `moveObjectSmartFromCatalog` 44502, `setDefaultRotation` 44549, `moveElement`/`dropElement`/`pickElement` 55154/55172/55241, `getAxis` 55338, `ParametricScaler` 30138, `configurate` 30163, `updateModelUV` 30817, `ProductTransform2D` 77330, `ProductTransform2DButton` 77158+77215 (перекрытие 7px→10px).
- Формулы верифицированы построчно: shift `position = intersection + oldPosition − pointIntersect` (43982–43985); `x = position.x − shift.x` (44015); POSTER rotationY=`radToDeg(atan2(vectorNormal.x, vectorNormal.z))` (44061); axis.angle через своп внешней стены (55395–55406); productSizes coalesce на 12351.
- checkValues высотные ветки: `y < −3` → сброс в исходную; `< 0` → 0; `> 1000` → сброс — CONFIRMED на 11294–11300 в точности как в доке.
- Единственная стилистическая заметка: доки склонны собирать два соседних утверждения под один номер строки (например 9966 для height-и area-гейтов, 9847–9850 под 9846 для parallel-фильтра). Это не WRONG, но при чтении может ввести в заблуждение — драйф до 4 строк.

### 05-selection-transform-grouping.md
**Drift:**
- 05-selection-transform-grouping.md L71: `StateDraggingProduct` заявлен 43775, реально 43774 (drift −1; 43775 — тело function).
- 05-selection-transform-grouping.md L85: `ProductTransform2DHelper` заявлен 41430+, реально начинается на 41416 (drift −14; 41430 — уже внутри тела).

**Notes:**
- Все ключевые якоря MIH подтверждены построчно: `find3DObject` 42076, `StateMain.mouseUp` 43572, `setActiveGroup/Product/Constructor` 42108/42138/42230, `unsetActive*` 42123/42170/42251/42259, StateSelectedProduct.mouseDown/Move/Up 44665/44754/44972 (rMax=300 на 44612), StateSelectedGroup 45320, StateDraggingGroup 45564 (`moveGroupHorizontal` 45645, `startDraggingProduct` 45626, `stopDraggingGroup` 45697), Ctrl-merge 45028/45047–45056, Ctrl-toggle 45411–45444.
- CopyPaste полностью подтверждён: 69206/69208/69214/69221/69236/69241/69263/69279/69318/69324/69350/69355/69391/69396/69403/69405; ключ `'r2d_clipboard'` 69210/69217/69225; `makeSceneObjectData` 14862, `makeSceneGroupData` 14992 (objectsData 15021), `SceneHistory.makeGroupsStates` 13037, `Creator.makeFromLoadedData` 18178, `LogoEditor.copyLogo` 18801 — все совпадают. Инверсии z/ry на 14869/14874 подтверждены; `data.type == R2D.ProductType.MODEL` fx/fy/fz + forWall mf/mfr/mfx/mfy/mb/mbr/mbx/mby на 14891–14898 (light `lightInfo` встречается не здесь, а в клоне 42374–42375 — доку это не противоречит).
- Группа: конструктор 35313, `add` 35382 с пивотом `_x=(minX+maxX)/2, _z=(minZ+maxZ)/2, _y=minY (клампится ≥0)` 35415–35417, setX/Y/Z 35586/35594/35602, defineProperties x/y/z/rotation/rotationY/fx/fz/sx/sy/sz 35610, setRotation 35722, flipX/Z 35732/35740, update 35748, copyFrom 35756 (`gr.x + bbox.width` 35778), setHeight/Width/Depth 35790/35800/35811, validSceneObject 35849 (type ∈ 2/3/4, !forWall) — все подтверждены.
- QuickPanel-константы 823–872 и dispatch-точки (14409/14452/45055/45017/44683/43589/80276/80293) подтверждены; `pageConstructionListener` 58615 внутри `/*…*/` от 58453 до 58485 — подтверждено, факт «мёртвый код» верен.
- SNAP.Snap2D дефолт `_distance=10` на 9477, `updateDistance(15)` в `updateSnap2d` — единственное место в файле, 41668, подтверждено. maxMoveDist=5 в каждом state (43537/44589/45248/45326), start-drag threshold `>=1` на 44959.

### 06-materials-textures.md
**Drift:**
- 06-materials-textures.md L49: cover-serialization `mr/mx/my` заявлен L53770–53772, реально L53771–53773 (drift +1; m/addM на L53769/53770).
- 06-materials-textures.md L49: clipboard paste `mx/my` заявлен L69288–69289, реально `mx=L69289, my=L69290` (my за пределами интервала на +1).
- 06-materials-textures.md L40: cap material defaults заявлены L51843, реально L51843–L51844 (только `materialID` на L51843; `addMaterialID` на L51844).

**Notes:**
- Все крупные якоря подтверждены точно (`StateDraggingMaterial` L44160, `MaterialDragPreview` L10467, `WC.Part` L52441, `WC.findTriWall` L52463, `WC.findTriCover` L52564, `WC.findTriWallTile` L52677, `WC.DataWall` L52759 / build3D L53069, `-1` remainder L53180, `WC.DataArea` L51617 / build3D L51635, `WC.DataCover` L51725, `WC.DataCap` L51838, `WC.DataFrame` L51889, `PoolMaterials` L36182 + `getMaterial` L36232 + color-branch L36201, `ObjectViewer3DMaterial` L32115, `ObjectViewerColorMaterial` L32390 (MeshPhongMaterial L32393), `ProductPackageParser.parseMaterial` L26784, `makeTextureMap` L29326, `SceneObjectModel` L11575 / setters L11602–L11663, `Pool3D.__GLTFLoadListener` force-linear L36069/L36071 + POSTER metalness=0 L36072–L36077, `getDefaultMaterialByKey` L18988–L18989, `setStructure` L55088 / L61476, `elementUpdateEventHandler` L31141, `updateGeometry` L31119 + `mesh.num = parts[i].id` L31134, `updateMaterial` L31093 + `#FFFF00` opacity 0.3 L31107–L31110, undo restore L12656–L12688, `TR.B_EPS = 0.0001` L49483, `TConf.appendCanvas` L77676 + `tileConfig_canvas` L77678, `TConf.autoFill` L77865, `stepX/stepY` L77884, grid rounding L77887, `[-xn-2..xn+2]` L77897, `removeOutsideTiles` L77909, `randomRotate` gate L77912, `getTiles` L77917, `flipPoints` L77926/L77930, `TConf.splitArea` L78424 + inversion L78432/L78436 + threshold ≤5 L78434, `TConf.mergeAreas` L78283, `TConf.Snap` L79477 + snapToBorder/Neighbour L79483–L79493, `TConf.History` L78832 + `field.getData()`/`setData` snapshots L78844/L78856, `TConf.Delimiter.HOR/VER` L79150–L79151, `TConf.Area` defaults incl. `margin=0.5` L78929, `TConf.setDefaultMaterial` `#`-branch L78123 + fallback `'2013'` L78134, `isOwner`/`user_key` L17317–L17338).
- Front/back UV mirror in `findTriWall` — confirmed exactly at L52496–L52517; rotate-about-center at L52519–L52528; `/=pixPerMeter` L52530–L52537. `findTriCover` `kr = reverse ? -1 : 1` L52616–L52640; `Y=elevation, Z=-y` L52655–L52668. All formulas match doc.
- `setMaterial` part routing L52821–L52842 and `setAddMaterial` mirror L52844–L52864 with `getPartByID` L52874 — perfect match.
- GLTF force-linear override claim (Pool3D listener overwrites GLTFLoader's sRGB) is verified: `GLTFLoader` sets sRGBEncoding L5969, `__GLTFLoadListener` overwrites to LinearEncoding L36069/L36071, and this listener runs on `.load(url, ...)` callback (L36129) after loader. Doc's characterization ("netto Linear") is correct.
- `WC.Part` ctor at L52441–L52462 initializes `materialID=0`, `addMaterialID=""`, plus `triangles/trianglesSolid/area/vertices/uvs/indices` — doc snippet omits `trianglesSolid` but doesn't claim exhaustiveness. Not a defect.

### 07-measurements-rulers.md
**Drift:**
- 07-measurements-rulers.md L56: main `draw()` заявлен ~63819; реально `me.draw = function()` начинается на 63787 (drawPolygonSizes loop на 63800).
- 07-measurements-rulers.md L122/L17/L189: `R2D.CustomRulers.updateComponents` заявлен 38651; реально 38644 (drift −7).
- 07-measurements-rulers.md L127: `R2D.RulerAB (~39716)`; реально 39719 (в пределах ~).
- 07-measurements-rulers.md L96: `WC.wallsEditor.rulers (60664)`; реально assignment `me.rulers = []` на 60660 (drift −4).
- 07-measurements-rulers.md L47: `MetricCM squareToString (10841)`; реально 10836 (drift −5).
- 07-measurements-rulers.md L47: `Imperial squareToString (11249)`; реально 11244 (drift −5).
- 07-measurements-rulers.md L165: `SelectedWall.updateConstruction (70110)`; реально 70115 (drift +5).
- 07-measurements-rulers.md L166: `SelectedPoint.updateConstruction (70375)`; реально 70379 (drift +4).
- 07-measurements-rulers.md L170: `SelectedRuler.updateConstruction (70727)`; реально 70732 (drift +5).

**Notes:**
- Structural claims all check out: dimension-system unit tables (10741/10745/10757), constants (`_FOOT_TO_CM = 30.48`, `_INCH_TO_CM = 2.54`, `_MAX_INCHES = 12000`, `_approximate = 0.0625`), imperial `toString` 8-branch table, GCD helper, tolerant parser returning `{error: ...}` (Ukrainian), unit-less→feet fallback (`unitlessAs = 'foot'`), 200 ms drag/click threshold in `elemDragListener/elemUpListener`.
- Auto-dimension pipeline verified: `drawSize` at 63163, `drawPolygonSizes` at 63368, `minLen = 30` at 63170, text-fit `+30` gate at 63229, `sizesVisible = true` at 60530, toggle at 59195, `SNAP_DIST = 10` at 60604, `scaleVaues` table at 60571.
- Manual 2D ruler: `WC.Ruler` at 57191, `StateMakingRuler` at 68648, `StateDraggingRuler` at 68823, `StateSelectedRuler` at 68959, `StateDraggingRulerLine` at 64114, colours `#F92FDD` / `#B9E31F` at 63595–63599 all confirmed. Angle-snap ±1° branches present in both `WC.StateMakingRuler.draw` (~68779) and `elemDragListener` (~39289).
- 3D-side ruler: `R2D.Ruler3D` at 38226, `R2D.CustomRulers` at 38555, `R2D.RulerAB` at 39719, `addRuler` at 38708, `addPoint` at 38881, `createNewRuler` at 38926, `importData` at 38972, `exportData` at 39015, `delRuler` at ~39405, `_cancel` at ~39579, `viewUpdate` at 39324, `__lineDashedMaterialRed` colour `0xF92FDD` at 31755–31756, hover `0xbae51f` at 38592 — all confirmed.
- `maxScale`-is-dead-code claim confirmed: `WC.wallsEditor.maxScale` never assigned; the only `me.maxScale = scaleValues[scaleValues.length - 1]` is `TConf.Editor` at 79202 (constructor at 79153); walls-editor zoom table `scaleVaues` at 60571.
- SFK state class positions all confirmed at their declared header lines (69759 / 70050 / 70324 / 70643 / 70829 / 70934 / 71187 / 71289); minor ±5 drift is only in the per-method `updateConstruction` anchors within those bodies, listed above.

### 08-cameras-views.md
**Drift:**
- 08-cameras-views.md L120: `modelAsAnchorParams (~36955 в ctor Renderer3DPerspective)` — реально объявлен на 36955, ctor начинается 36939; корректно.
- 08-cameras-views.md L125: walk-clipping `defaultDist=20` заявлен 48637; реально `const defaultDist = 20` на 48639, `onClipping` на 48643 (drift +2/+6).
- 08-cameras-views.md L220: `addLightToModelsLights(wrap3d)` заявлен 49300; реально 49301 (drift +1; 49300 — заголовок `addLightToScene`).

**Notes:**
- Ключевые числа полностью подтверждены построчно: 3D cam `PerspectiveCamera(40, 800/600, 5, 40000)` @46185; `cameraState` @46248 (anchor.y=110, dist{10,30000,3000}, tilt{-0.8,1.57,1.25}); 2D `OrthographicCamera(-400,400,-300,300,1,1300)` @47231, tilt=π/2 @47270, dist=1200 @47269, zoom{min:-20,max:1,current:0} @47272; walk `PerspectiveCamera(60,800/600,5,6000)` @47912, anchor.y=150 @47980, dist{1,1,1} @47984, tilt{-1,1.45} @47989-91.
- Орбита-математика в `R2D.OrbitController` (27563): `update()` @27610-27621 — 1:1 с формулой в §2d; `setPan` без клампа @27599; `setTilt` жёсткий кламп @27602-27606; `setDistance` кламп @27607-27609.
- Пайплайн `render(useFilter, useBackground)` @36629: `clear() → filterBackground.render() → bottom → middle → clearDepth() → (contours) → clearDepth() → view2DObjects → clearDepth() → filterSelect → clearDepth() → top` — точное соответствие §7b. `autoClear=false` @36852. `logarithmicDepthBuffer:!phone` @36597.
- `RenderUpdater` @10202: `frames=5` @10203, `setFrames(2)` для мобайла @36612 — подтверждено; `onProgress=render(false,true)` / `onFinish=render(true,true)` @36860-36861.
- Walk-jump: `cameraJump(x,y)` @48215, `stepsNum=100`, `animTime=500`, `minDist=40`, `*0.8` факт-множитель, кап `±500`, easing `sin(t·π/2)` — всё построчно подтверждено @48217-48249; вызов из mouseUp с `R2D.viewWalk.cameraJump(objectData.point.x, objectData.point.z)` @43582/43653, гард `maxMoveDist=5` @43537.
- `LightViewer3D` (48921): coefs `spot=50/point=20/area=5/emission=0.1/maxLightCount=9` @48922-48926; `transpGlassMatId` `dev→32766, prod→41838` @48927-48932. `getDataFromPool` @49163 (JSZip.loadAsync + `light.json` — @49166-49191), `createLightWrap` @49202, `switchLight` @49106, `canLightOn` @49147, `setLightPower` @49427 (шкала 0-100, `curJSPower=curBlendPower/coef` @49453). Всё точно.
- `CoversTitleViewer3D` (48695): `planeSize=100` @48713, rotateX(-π/2) @48771, `distToCover=1` @48709/48779, billboard `mesh.rotation.set(0, cameraData.pan, 0)` @48916 — все анкера ±0.
- Скриншот 3D: `1280×720` (превью → `ProjectPreviewSize`) @46718; walk превью `265×150` + SSAO off @48318-48319 — подтверждено.
- Facade-делегирование Viewers: `getCameraData` @17067, `getSavedCameraData` @17072, `saveCameraData` @17075 (снимает все три sceneview), `savePanoData` @17097, `clearSavedCameraData` @17107 — совпадает.
- 2D `getSensitiveMove()=(1−r)·20` @37633; 3D `max(dist/1200,0.1)` @37041; sensitivePan/Tilt/Zoom/MobileZoom = 0.01/0.01/0.005/0.001 @36945-36948; 2D sensitiveZoom=0.05 @37581.
- `getCurrentViewerName()` @16851 корректно описан как бажный (walk→viewConstructor).
- Правая-drag pan `MEC.RIGHT_MOUSE_DOWN` закомментирован @28036, доп. @28048; TouchController @28091; MouseController @27932.
- `WC.WallsEditor` @60521, `WC.context` @60601, `scaleVaues` (typo) @60571 (41 элемент, центр=1.0), `moveButtonCameraNum=5` @60569, конструкторский `getViewStateData` фикс-заглушка `{state:'2d', tilt:90, zoom:0.1}` @60988-60999 — всё подтверждено.
- Скайбокс `SphereGeometry(6000, 60, 40)` @14461, `repositionSkybox` @14480, `setSkyboxRotation` @14548, `R2D.panorams=null` @82, `planner.setPanorams` @670. `checkSkybox` @14588 существует. Отсутствие `CubeCamera/WebGLCubeRenderTarget/equirect` подтверждено грепом по всем 81 349 строкам — все нули.
- `UPDATE_CAMERA_VIEWS="updateCameraViews"` @857, `UPDATE_TOURS="updateTours"` @859 — существуют только как event-константы; никакой тур-логики / URL-round-trip в файле нет (подтверждено).
- 2D zoom-таблица `scaleVaues` (typo) @37565 — 41 значение, `updateScalePointer(1-scale)` @37796.

### 09-undo-redo-history.md
**Drift:**
- 09-undo-redo-history.md L10: `R2D.Scene` заявлен ~13100, реально 13087 (`~` honest).
- 09-undo-redo-history.md L22/L36: `WC.WallsEditor.save` заявлен 61342, реально 61343 (drift +1).
- 09-undo-redo-history.md L27/L32: `me.disable` заявлен 62331, реально 62330 (drift −1).
- 09-undo-redo-history.md L57: `me.save()` в конце ctor WallsEditor заявлен 61407, реально 61405 (drift −2).
- 09-undo-redo-history.md L61/L95: `maxActions = 100` заявлен 12300, реально 12299 (12300 = `statesUndo = []`).
- 09-undo-redo-history.md L91: `removeUndoState` заявлен 12428, реально 12430 (drift +2).
- 09-undo-redo-history.md L52: `setData(dataObj)` заявлен 58270, реально 58272; `clear()` заявлен 58348, реально 58349.
- 09-undo-redo-history.md L117/L141: `setCurrentModelWidth saveState` заявлен 42838, реально 42837; rotation `saveState` 42799 → реально 42800.
- 09-undo-redo-history.md L83/L151: `updatePrevState` заявлен 12441, реально 12443.
- 09-undo-redo-history.md L83: `setAllElementsUnchanged` заявлен 55059, реально 55060.

**Notes:**
- Core architecture claims all confirmed: two independent stacks, three-slot SceneHistory (undo/redo/current), 100-cap declared-not-enforced (`statesUndo.push` at 12351 has no trim), `productSizes` coalescing exactly one guard line (12351), product diff-restore, wall `wasChanged`/`willBeChanged` gate (12650/12654), frames-gate commented out (12721–12730), plinth `visible` restored (12749) but not captured in `makeConstructionObjectsStates` (13005–13008 — bug confirmed).
- API bridge lines 753–756 (`planner.constr.*`) and 786–789 (`planner.scene.*`) confirmed verbatim; `canUndo/canRedo` are pull-style off `history.isUndo/isRedo` (getters at 12324–12329).
- `HISTORY_UNDO_REDO` sites 28566–28567, 43919, 44208, 44247 all verified. Additional undocumented sites exist (44355 etc.) — informational.
- `historyStageEvent` stub body at 46309–46311 confirmed (only a commented `R2D.User.updateElementHistory` call inside).
- Deep-clone / index-relinking anchors (`WC.CPoint.clone` 56857, wall re-clone in getData 58266, wall re-clone in setData 58338) all exact.
- Load-baseline pattern `scene.history.clear(); scene.history.saveState()` confirmed at 15575–15576 (doc says 15574–15576 — 1-line span drift, within tolerance).

### 10-serialization-save-format.md
**Drift:**
- 10-serialization-save-format.md L80: `R2D.Scene.getSceneState` заявлен 13899, реально 13878 (drift −21; 13900 начинается объект `res`).
- 10-serialization-save-format.md L128: `TConf.Field, 78605-78657` — диапазон это методы `toData`/`fromData` (`toData` на 78605); сам конструктор `TConf.Field` — на 77699 (drift −906, если про класс).
- 10-serialization-save-format.md L222: `parseProductModelMaterials, 26185` — реально 26175 (drift −10; 26185 — тело).
- 10-serialization-save-format.md L214: parser `z/ry` negation `26113+` — реально `z` на 26130, `ry` на 26137 (drift +17).

**Notes:**
- Все ключевые якоря WC.convert.* — точные попадания: `structureToShort:53502`, `wallToShort:53644`, `coverToShort:53668`, `coverFromShort:53765`, `shortToStructure:53828`, `structureToApp:53440`, `structureToEstimate:54177`, `copyWallData:54323`, `WC.contourFromPairs:52132`.
- Все SceneParser якоря точные: `parsePoints:25716`, `parseWalls:25749`, `parseCovers:25793`, `parseCuts:25856`, `parseRooms:25895`, `parseAreas:25923`, `parseCup:25990`, `parseSceneVersion001:26015`, `parseVersion001:26193`, `parse:26208`. Формы возвращаемых значений (`return []` для walls, `return null` для остальных) и правило «caller check `==null`» на 25683 подтверждены.
- Все поля `wallToShort`/`coverToShort`/`areas`/`cap`/`cuts`/`rooms` из документа перечислены в исходнике в точности (перепроверено по `plt*`, `plb*`, `mc*`, `title`, `conf`, `pm:''`, `control:0`).
- Продуктовые баги (запись в `data.objects[i]` вместо `objectsData[i]` на 15098-15107; `z: sceneObject.z` без negation в groups на 15027) — подтверждены.
- Preview JPEG в 4 вьюерах (46737/47738/48324/61031), 5-секундный/60-секундный интервалы, gate `getProjectId() && wasChanged() && userKey==getProjectUserKey()` — все точно на месте.

### 11-floorplan-import-align.md
**Drift:**
- 11-floorplan-import-align.md L48: `setPlanAlignLength` → `setAlignerValue` заявлен 68041; body на 68041 корректно; public API bridge `planner.constr.setPlanAlignLength` на 741 — не упомянут (нюанс).
- 11-floorplan-import-align.md L58: `WC.StateAlignDrawingByArea.scaleDrawing` заявлен 68575 для `addScale`/`drawingScale *=`; реально `addScale` на 68577, `drawingScale *=` на 68578 (drift +2/+3).
- 11-floorplan-import-align.md L48: `alignerSizeListener` заявлен 58490; функция на 58486, comment-block 58488–58513 (drift −4, within tolerance).

**Notes:**
- `WC.DRAWING_ALIGNED = 'drawingChanged'` (60506) — event string collides with `WC.DRAWING_CHANGED`. Doc mentions the event by name but does not warn that subscribers to `DRAWING_CHANGED` will also receive `DRAWING_ALIGNED` dispatches (worth flagging for our re-impl, not a doc bug).
- Doc L28 "Defaults span (50,0)→(250,0) via `initValues` (67795)" is correct for `initValues` (67797/67799), but note constructor-time defaults at 67702–67703 are (50,0)/(150,0). Only matters for the very first frame before `initValues()` runs (which is called at 68308).
- `scaleDrawing` rotation math verified: `atan2(dx, dy) - PI/2` at 68236 (doc L130 correctly writes `atan2(dx,dy) - PI/2`; unusual order but matches source).
- 3D underlay opacity hard-coded `0.3` at 41257 — doc L141 CONFIRMED.
- Persistence: `getDrawingData` returns `{scale, rotation, source}` with no `drawingX/Y` or `drawingPosition` — CONFIRMED at 55308–55322; display persisted separately at 15664/15751 CONFIRMED.
- Base64 strip/re-attach path (15662 strip, 15543 prefix / 15541 makeURL) — all CONFIRMED verbatim.
- `drawingCorrect` returns `distanceH > 0 || drawingScale > 1` at 68301 — CONFIRMED.
- `dragLine` sub-state handling and `isDragging > 5` threshold at 67904 — CONFIRMED.

### 12-catalog-assets.md
**Drift:**
- 12-catalog-assets.md L155: `updateGeometry()` заявлен 32598; сама функция объявлена выше, 32598 — середина else-ветки (лучше диапазон 32570-32625).
- 12-catalog-assets.md L157: `R2D.Tool.makeBufferGeometry` заявлен 28984 (совпадает); диапазон 28987-29004 смещён на 1 — реально 28987-29005.

**Notes:**
- Все анкеры ROOMTODO-парсера подтверждены точно: `parse` @26764, `parseMaterial` @26784, теги 10-15/20-23/30-31/60/61 совпали с телом на 26834-26915. `MARKER_ROOMTODO="ROOMTODO"` @26741. `type != 1 && type != 2` @26822 confirmed.
- `Pool3D` полностью верифицирован: 36011 (декларация), 36024 (`__loaderEventHandler`), 36055 (`__GLTFLoadListener`), 36066 (`obj.position.y=0` на traverse), 36088 (`__checkLoad`), 36126-36134 (glTF vs XHR ветка), 36143 (`isLoaded`), 36149 (`load`), 36172 (`getData`), 36175 (`clearData`).
- `R2D.ProductType` (17836-17868) и коды 1-5 подтверждены дословно.
- `R2D.Pool.loadProductData` @17957 + in-flight dedup через `isLoaderProductData` (17959-17961) — подтверждено. `loadProductDataByTagsArr` @17979.
- Header write в `ProductPackageCreator.Model` (71685-71786): tag=2, version=3, порядок BEGIN/vertices(20)/uvs(21)/normals(22)/indices(23,uint32)/md5(30,32 chars)/END — подтверждён дословно.
- `URL_UPLOAD_FILE` fetch с `x-lang:"en"` @40706-40711 confirmed; поле `models.zip` @40704.
- `R2D.Creator.makeSceneObject` @18035, `makeFromLoadedData` @18178 confirmed.
- `WCT.makeContour` определён @74272, используется @75032-75033 в ModelCreator save-пути (не 75037-75046 как в доке, но это ссылка на «captures the resulting bytes» — соседняя область; drift несущественный).
- `productIsLoaded` @32630 подтверждён; ветки `meshReplace` (32636), `isGLTF` (32666), else (custom-binary, начиная 32763 — по гриду поиск `parseModel` не показал явного номера, но структура совпадает).

### 13-uploads-ai-render-export.md
**Drift:**
- 13-uploads-ai-render-export.md L53: `R2D.CustomUploader (plannercore.js:249-598)` — реально класс + все `.UPLOAD_*` статики на 249-599 (последний `UPLOAD_MODEL_MATERIAL='7'` на 599; off-by-one, в пределах ±5).

**Notes:**
- Все проверенные анкера в plannercore.js точны в пределах ±3 строк: `R2D.ModelUploader@19173`, `R2D.CustomUploader@249`, `R2D.ModelAIUploader@21256`, `createNewModel@21262-21298`, `checkStatus@21300-21330`, `R2D.RenderUpdater@10202-10260`, `R2D.RenderFrame@10624-10711` (getData возвращает ровно `{screenWidth, screenHeight, frameWidth, frameHeight, ratioWidth:16, ratioHeight:9}` — точное совпадение).
- FormData в `save()` (`plannercore.js:20306-20343`) содержит ровно заявленные поля: `preview=prev.png`, `source=scene.glb`, опц. `svg=scene.svg`, `svg_outline=scene_outline.svg`, `metaZip=meta.zip`. Заголовки `x-token`+`x-lang`, `withCredentials=true` — CONFIRMED (20350-20353).
- `R2D.MaterialUploaderPreview3d@21353+` — 400×250 стена и 180 см силуэт человека (`manHeight=180`, 21361) — CONFIRMED дословно.
- `R2D.LogoEditor@18323` — все параметры (`pixPerCm=10`, `maxLogoSize=1000`, `minLogoSize=2`, дефолт `{kx:0.5,ky:0.5,logoIndex:'transp'}`), `sendLogoToServer` шлёт `logoImg` через fetch с `x-token`/`x-lang` на `URL_UPLOAD_FILE` — CONFIRMED (18424-18447).
- Anchor L136 «LogoEditor 18323-18930» — сам класс кончается на ~18925 (следующий `};` на 18925), верхняя граница 18930 в пределах drift.
- Большая часть «мяса» док-а (рендер-пайплайн, история рендеров, туры, экспорт, PDF, кредиты) вычитана из user.js/React и явно вне области валидации — оставлены как UNVERIFIABLE out-of-scope, не оспариваются.

### deep-dives/01-triangulation-core.md
**Drift:** —
**Notes:**
- The core "cdt2d + clean-pslg, not poly2tri" claim is CONFIRMED by tris.js:1911–1922 (browserify bundle wrapping `require('cdt2d')` and `require('clean-pslg')`), plus zero occurrences of `poly2tri`/`SweepContext` in either file. The user's note (poly2tri→cdt2d) is baked into the doc correctly.
- All cited plannercore.js line numbers verified exact: `TR.triangulate` @50632, `imported_triangulate` @50635, `TR.createStructure` @50640, `groupTriangles` @50692, `checkTriangle` @50709, `contoursFromGroup` @50738, `clearDict` @50792, `filterContours` @50913, `triangulateContours` @50926, `addSeg` closure @50932-50965, `resplitSegments` @50272, `imported_clean_graph` @50983, sliver guard @51001, `if(!trForCenter)` @51010 with `continue` @51013, `pointInContours` @51021, boolean-op logic 51024–51076, `rebuildContours` @51094, `indicesToPoints` @51189.
- Epsilons verified exact: `TR.L_EPS = 1e-8` @49482, `TR.B_EPS = 1e-4` @49483, `EPS = 0.000001` in `pointInContour` @49633, `minLen = 0.1` in `triangleIsNarrow` @49746, `minLen = 5` in `clearContour` @50402, `MIN_CONTOUR_AREA = 50` / `MIN_SP_RATIO = 1` @49470–49471, `Point.match` defaults to `L_EPS` @49554, `pointOnLine`/`pointOnContour` default to `B_EPS` @49579/49605.
- `exterior` grep confirmed exactly 4 hits (14594 render, 46203/46798 furniture material, 50635 triangulate) — doc's "appears exactly once in triangulation context" claim holds.
- `roundCoord` sites verified: doc cites 53448, 53510, 53871, 59556 (primary) and 53516, 57698, 59563 (also); grep returns exactly those 7 sites plus the definition @50554. Zero missed.
- `triangulateContours` call sites verified: doc cites 60466 as cover-triangulation call — confirmed (`TR.triangulateContours([cover.points], holeContours, [], [], [])[0]`). All 8 external call sites present (51115, 52413, 53147, 53185, 54546, 54552, 55522, 60466).
- Recursion claim: `checkTriangle` @50709 recurses without depth guard — confirmed by reading 50709–50733 (recursive calls @50724, 50728, no `try` or stack cap). `indicesToPoints` @51189 self-recurses @51202 — confirmed.
- Doc's algorithmic characterization of cdt2d ("sweep + monotone + edge-flip constrained Delaunay") is acknowledged as public-doc based (doc L119), not from bundle audit — this framing is honest and non-fabricated.

### deep-dives/02-wall-mitering.md
**Drift:**
- deep-02-wall-mitering.md L201: table cell "trailing-point drop (57980)" — реально `contour = inputCont.slice(0, -1)` на 57982; 57980 — length-check guard (drift +2).
- deep-02-wall-mitering.md L184: "plug data is built at 52053" (`WC.DataPlug`) — ctor body 52053–52068 (52053 — signature, fields 52058–52066); в пределах tolerance, plug mesh формируется в `createPlug3D` @54507–54508.

**Notes:**
- All numeric thresholds confirmed at exact cited lines: `L_EPS=1e-8` @49482, `B_EPS=1e-4` @49483, `recalcAng=Math.PI*0.75` @57924, `parallelBox` maxAngle default `0.05` @54835, `parallelLines` maxAngle default `0.05` @50254, `maxConnectorLength=40` @54384, `MAX_WALL_WIDTH=80` @54379, `MIN_WALL_LENGTH=15` @54380.
- Function anchors all match: `blocksFromContour` @57922, `perpendicularPoint` @50196, `lineIntersectLine` @49874, `pointInBounds` @50167, `parallelBox` @54833, `boxFromWalls` @54822, `boxCenterSeg` @54911, `rightOriented` @54922, `findAxes` @55362, `createConnectors` @54382, `createPlug3D` @54495, `DataPlug` @52053, `findNearSegments` @57227, `projectionPointOnLine` @50128, `pointOnLine` @49576, `faceRight` assignment @54140.
- Algorithm claims verified line-by-line in blocksFromContour: `d = -wallsWidth` @57930, guards @57926–57927, per-vertex L0/L01/L12/L2 setup @58029–58036, miter intersect @58039–58040, null-guard fallback to L01/R01 @58041–58042, angle test with pointInBounds @58046, flat-cap re-start `A = L12; B = R12` @58055–58056, closed-branch WITHOUT pointInBounds guard @58106, quad emit `[A,C,D,B]` @58061 / @58114 — matches doc description exactly (including "single-sided band" claim: `D` and `R*` are raw centerline points, doc L77–80 correct).
- Rebuild-path claims verified: `parallelBox` four-case overlap @54851–54901, collapse-reject @54903, `boxCenterSeg` MAX_WALL_WIDTH/MIN_WALL_LENGTH gates @54913–54914, `rightOriented` XOR parity table @54933–54939, `createConnectors` skip conditions (length @54408, wall-match @54413–54414, endpoint-on-line @54420–54432, wall-cross via lineIntersectLine @54434, cut duplication @54443–54454), `createPlug3D` emits exactly two triangles via `findTriWall` @54507–54508.
- Wall-width claim (doc L269–273) verified: only `me.wallsWidth = 10` at 65571 and 65864, no per-wall width in offset path — doc's "per-wall width not supported" is CONFIRMED.
- `blocksFromContour` open-vs-closed detection via `inputCont[0].match(inputCont[inputCont.length-1])` — confirmed at 57977; closed branch pushes `contour[1], contour[2]` at 58081 for wrap-around — confirmed.

### deep-dives/03-contour-tracing.md
**Drift:** —
**Notes:**
- All TR.* anchors verified verbatim: rebuildContours 51094; triangulateContours 50926; resplitSegments 50272; rebuildGroup 50348; createStructure 50640; groupTriangles 50692; checkTriangle 50709 (direct recursion, no explicit stack — confirmed); contoursFromGroup 50738; clearDict 50792 with dead-end pruning loop through 50829; getOneContour 50832 with min-X seed 50836-50845 and virtual prev [x-10,y] at 50875; nextPt 50869 with `if (CW) return maxPtIndex; else return minPtIndex` at 50909; angleBetweenLines 49754 (atan2 diff normalized to [0,2π)); clearContour 50398 (minLen = 5 at 50402); contourValid 50525 (MIN_CONTOUR_AREA=50 at 49470, MIN_SP_RATIO=1 at 49471); compareContoursByArea 49963 (setSize=10, ptsInAB>0 → INTERSECT at 49998); compareContours 50001; contoursAdjacent 51161; constants at 49473-49480; L_EPS 49482, B_EPS 49483.
- Cite `res.length > pointsNum → return null` at 50856, `var CW = !(inner && res.length == 0)` at 50858, `if (! neighbIndices || neighbIndices.length <= 1) return -1` at 50883 — all exact.
- Bundle claim (imported_triangulate / imported_clean_graph as cdt2d + clean-pslg) verified in tris.js:1912-1921 exactly.
- Room re-attach flow (arrRooms=[] at 59633; compareContoursByArea test at 59695) and cover re-attach (59862, 59983) verified verbatim, including the `ceiling` deep-copy in the cover branch.
- Minor imprecision (not scored as WRONG): doc L99-100 characterises 51147-51156 as "cross-group holes dedup via contoursAdjacent". In source, `contoursAdjacent(outline, totalOutline)` skips only holes whose outline coincides with the *total* outer outline (i.e. hole = whole-plan boundary), not arbitrary cross-group dedup. Consider tightening the wording.
- Doc L58 "true for covers" is accurate but indirect: rebuildContours passes through `separateContacting`; the actual `true` originates in findAutoCovers 59745 and rebuildCovers 59942. Optional to add these anchors.

### deep-dives/04-3d-mesh-uv.md
**Drift:**
- deep-04-3d-mesh-uv.md L66: `findTriCover` заявлен 52655; определение — 52564 (drift +91; 52655 внутри тела). Доc называет тот же символ 52564 на L22 и 52593–52640 на L149 — L66 inconsistent.
- deep-04-3d-mesh-uv.md L20: `TR.triangulateContours` заявлен 50926; реально 50926 (exact, kept for record).

**Notes:**
- `WC.findTriWall` (52463), `WC.findTriCover` (52564), `WC.findTriWallTile` (52677), `WC.findPlinthSegment` (52318), `WC.createFrame3D` (54606), `WC.generateIndices` (52311), `WC.Part` (52441), `WC.Part.addNullData` (52454), `WC.azimuth` (54798), `sortByAngle` (54809) — all confirmed exact.
- `DataWall.build3D` body: `A/B/C/D` construction (53111–53114), `me.v1..v4` with `z = -y` (53093–53096), `shiftVal = 0.1 / -0.1` with `faceRight` (53098–53103), `triangulateContours` outer-rect + holes (53185), `findTriWallTile` tile branch (53161–53163), `findTriWall` fallback + remainder `part.id = -1` (53181, 53202) — all confirmed at the cited lines.
- `R2D.Tool.makeBufferGeometry` (28984) → `computeVertexNormals()` (28999); `R2D.Tool.flipGeometryByZ` (29079) with index swap `[1]↔[2]` (29112–29116); `updateGeometry` (31119) → `flipGeometryByZ` at 31129, `mesh.num = part.id` at 31134; `updateMaterial` (31093); `scope.getObject3d(num)` (31171); `R2D.Tool.makeTextureMap` (29326) sets `wrapS/wrapT = RepeatWrapping` at 29330–29331 and `texture.repeat.set(repeatX, repeatY)` at 29339 — all confirmed. Doc's phrasing "wrapS/wrapT = RepeatWrapping (29330)" and "makeTextureMap L29339" are both accurate (29330 = wrapS line; 29339 = repeat.set line).
- Scalable-material branch `ObjectViewer3DMaterial` (32115 declaration; scalability branch 32199–32208 with `repeatU/V = scaleX/scaleY` vs `(1,1)` + `userData.scaleX/Y`) — confirmed exact. Preview clone-hack `MaterialCreator.MaterialScene.cloneMap` `repeat.set(1,1)` at 73601 (inside `cloneMaterial` 73595) with `geometryTile.scale(...)` at 73620 — confirmed; the doc's correction to the previous version stands.
- `DataFrame` at 51889; `DataFrame.build3D` at 52013 with `uvsDef` rotate-about-center 52023–52047 — confirmed. `createFrame3D` `bottomHeight = 2` at 54608, sill test `P.y > maxY - bottomHeight` at 54681, per-edge `V1..V4` with `±depth/2` at 54654–54671, UV emission at 54673–54676 — all confirmed. `frameB` uses `materialBottom*`, `frameT` uses `materialFrame*` (54713–54723) — confirmed.
- `DataPlinth.build3D` at 51505; gap-split calls at 51554/51560/51566 — confirmed. `Vs = V + sqrt(Δd² + Δh²) / pixPerMeter` at 52369; end-cap `triangulateContours([cont1], …)` at 52413; `findTriWall` per end-cap tri at 52427 — confirmed. `WC.DataPlug` at 52053 (class), `WC.createPlug3D` at 54495 with two `findTriWall` calls at 54507–54508 — confirmed (doc says "plug builder's `findTriWall` call-site is 54507–54508" — correct; the class line 52053 is also correct).
- Three.js version indicator: `sRGBEncoding` used at plannercore.js:5969 (GLTFLoader-embedded, sets `material.map.encoding = THREE.sRGBEncoding`) and `LinearEncoding` at 36069 — confirmed. The doc's "r134-era" inference is API-based only; no version string in file.

### deep-dives/05-cover-build3d.md
**Drift:**
- deep-05-cover-build3d.md L49: `ELEMENT_CREATE` cover заявлен 55506, реально 55508; ceiling заявлен 55507, реально 55509 (drift +2); `checkCeilingVisible` doc:55508, actual:55510.
- deep-05-cover-build3d.md L60: `findAreasTriangles` заявлен 60079–60088, реально 60072–60100 (block-drift ~7).
- deep-05-cover-build3d.md L266: `outerCovers.reverse()` заявлен 60425, реально 60426; `CONTAIN` заявлен 60435, реально 60437; удаление осиротевших 60443–60446, реально 60444–60447 (drift +1..+2).
- deep-05-cover-build3d.md L224: `dispatchUpdate` заявлен 51343, реально 51345 (drift +2).

**Notes:**
- Все крупные заявленные якоря классов и функций подтверждены на строку в строку: `WC.DataObject` 51212, `DataArea` 51617, `DataCover` 51725, `DataCeiling` 51789, `DataCap` 51838, `WallsData` 55010, `CContour` 56890, `CCover` 56965, `CArea` 57027; `createCover3D` 54529, `findContourCover` 54779, `findTriCover` 52564, `generateIndices` 52311, `addNullData` 51397, `checkCeilingVisible` 55763, `setStructure` 55088, `getStructure` 61611 (док: 61616 — drift +5, на грани), `findRoomsForCovers` 55324, `sortByArea` 59492, `findCoverHoles` 60406, `findAllCoverTriangles` 60450, `findCoverTriangles` 60458, `triangulateContours` 50926, `pointInContour` 49629, `triangleCenter` 49734, `triangleArea` 49739, `compareContours` 50001, `compareContoursOnePoint` 49810.
- Формула активного центрового трансформа UV (52631–52641) и старой закомментированной версии (52619–52629) подтверждена построчно; `_currPoints.sort(sortByAngle)` на 52584, `reverse` на 52585, `pixPerMeter=100` на 52573, `kr` на 52614–52615 (док: 52616–52617, drift ≤2). `u=-x` при reverse — 52606 подтверждено (52606: `uA = -a.x`).
- `WC.DEFAULT_WALLS_HEIGHT = 280` @59320 и `WC.DEFAULT_AREA_HEIGHT = 100` @59321 — точно. `CArea.height = 100` @57033 — точно.
- Полный диспатч `build3D` в `WallsData` (55475+): walls/cuts/plinths (55477–55498), `me.ceilings = []` (55500), цикл covers (55502–55509), сброс `areas[i].triangles=[]` (55516), сбор `cutPairs` (55519–55520), `triangulateContours` (55522), раздача по центрам треугольников (55527–55553), `me.cap.build3D()` (55571), cap-`ELEMENT_CREATE` под условием (55573) — весь порядок совпадает.
- `elementUpdateEventHandler` находится на 31141 (док: 31142–31151, drift +1); `makeBufferGeometry` 28984 с ветвью `computeVertexNormals()` 28999 — подтверждено.
- Итог: документ технически надёжен; исправлять содержательно нечего, косметически можно подтянуть строчные ссылки в перечисленных точках дрейфа.

### deep-dives/06-opening-holes.md
**Drift:**
- deep-06-opening-holes.md L90: `elevation — высота подоконника (sceneObject.y, 14772)` — реально `elevation: sceneObject.y` на 14773; 14772 — `y: sceneObject.z`.
- deep-06-opening-holes.md L98: `addSeg ... 50936–50965` — реально 50932–50965 (заголовок на 50932).
- deep-06-opening-holes.md L179: `lineIntersectLine в режиме сегментов, 50020` — реально 50019.
- deep-06-opening-holes.md L294: `setDepth(depth + 1)` (14795–14796) — реально одна строка 14796; 14795 — `rotationY`.
- deep-06-opening-holes.md L348: «модель получает новый `depth` (55199)» — реально `modelData.depth = axis.depth` на 55197; 55199 — `materialBottom`.

**Notes:**
- Ключевые якоря — все в точку: `getHoles` 52990, `findContourWall` 54755, `createFrame3D` 54606, `compareAndRebuildContours` 54944, `createFramesForAxis` 55677, `TR.rebuildContours` 51094, `TR.triangulateContours` 50926 (вызовы 53147/53185 — точно), `TR.compareContours` 50001, `checkContact` 49942, `SubEditor.getStructure` 61611, цикл пере-дропа 61975–62000 (61995 порог 5, 61997–61998 пересчёт xy), `updatePositionObjectsForWall` 13189, `radiusDropElement = 10` 13092, `dispatchModelsReset` 55797.
- Квирки, заявленные доком, — реальные: дубль `axis.wall1.changed` (55223–55224 — обе строки одинаковые), in-place `cont2d.reverse()` в `findContourWall` (54762), `new Array(contourGroups)` вместо `.length` в `compareAndRebuildContours` (54973), `remade[0][0]` (54989), «мёртвое» условие `y > maxY` в `createFrame3D` после апдейта `maxY` (54622–54623).
- Формулы `getHoles` для parallel/встречной ветки (53012–53043) и `createFrame3D` (54646–54710) сходятся с текстом дока построчно; split top/bottom условие `P1.y > maxY - bottomHeight && P2.y > maxY - bottomHeight` (54681) — точно.
- `compareContours` завершается на 50126 (док — 50127); в пределах ±5, не считаем drift.
- `stopRotateMaterial` (53247–53251) с `me.build3D()` на 53251 — совпадает.

### deep-dives/07-wall-axes-pipeline.md
**Drift:**
- deep-07-wall-axes-pipeline.md L229: `axis.point1/2 обновляются in-place (61988–61989; ang = atan2(...) 61989)` — реально `axis.point1/2` на 61986–61987, `ang = atan2(...)` на 61989.
- deep-07-wall-axes-pipeline.md L269: `pickElement(id)` (55241–55272) — реально функция кончается на 55274.
- deep-07-wall-axes-pipeline.md L172: `cut.walls ... 55591–55613` — реально loop 55589–55610 (start off by 2).
- deep-07-wall-axes-pipeline.md L249: fallback `13241–13245` — реально `while` начинается на 13242 (start сдвинут на 1).
- deep-07-wall-axes-pipeline.md L179: `dispatchModelsReset (55798–55800)` — функция объявлена 55797, тело 55798–55800.
- deep-07-wall-axes-pipeline.md L164: `TR.rebuildContours ... (59630) → ... цикл с 59694` — matching-цикл фактически 59690–59701 (сама проверка на 59695).

**Notes:**
- Все ключевые якоря `findAxes` (55362–55407), `boxFromWalls/parallelBox/boxCenterSeg/rightOriented`, `getStructure` savedWalls/newModelsData/`len−5`/push, `updatePositionObjectsForWall`, `createFramesForAxis`, `getHoles`, `findPlinthGaps`, `createConnectors`, `DataPlug` — совпадают построчно. Формулировки про «свап только угла, не point1/point2» и про O(n²) без индекса верны по 55389–55406 и структуре двух `for`.
- Доковая метка «`me.frames` getter (55866–55869)» — формально это внутренний loop в `me.getObjects()` (55863–55881), а `me.frames = []` (55035) больше не пополняется. Строки правильные, но термин «getter» неточен; смысла (концентрирует рамы со всех осей) это не меняет.
- Доковый диапазон `parallelBox (54833–54908)` реально `54833–54909` — в пределах ±5, не заношу в drift.
- Диапазон `DataPlug ... 54480–54484` реально loop на 54482–54485 (создание plugs) — в пределах ±5.
- Все внешние триггеры `setStructureToWallsData` (62327, 62344, 15645, 15739, 62766, 39925) подтверждены grep'ом; RESET_MODELS-подписка на 14298 CONFIRMED.

### deep-dives/08-geometry-predicates.md
**Drift:**
- deep-08-geometry-predicates.md L20: `parallelBox` заявлен @54833, реально @54833 (сама функция) OK, но `maxAngle` default в теле @54835 (drift ~2).
- deep-08-geometry-predicates.md L92: `pointInBounds` пост-фильтр @53310-53311, реально @53309-53310.
- deep-08-geometry-predicates.md L104: `perpendicularPoint(A,B,d)` в mitering @58029, реально `L0/L01` @58031-58033 (drift ~2-4).
- deep-08-geometry-predicates.md L131: `bisectorPoint` возврат `null` @50189, реально @50191.
- deep-08-geometry-predicates.md L280-281: mitering angle recalcAng сравнение @58045, реально @58046. Аналогично @58105→@58106.
- deep-08-geometry-predicates.md L426 (таблица): `projectionPointOnLine` «оси стен @53014», реально ближайший вызов @53012-53013; `parallelBox @54839`, реально `TR.projectionPointOnLine(C,A,B,false)` @54837 (drift 2).

**Notes:**
- Все ключевые константы, эпсилоны, номера строк для функций TR-namespace §2–§7 подтверждены построчно: L_EPS/B_EPS/MIN_CONTOUR_AREA/MIN_SP_RATIO @49470-49483, 8 исходов @49473-49480, `pointsMatch` @49560, `pointOnLine` @49576, `pointInContour` @49629 (включая EPS=1e-6@49633, ptsOnRay@49639, y-straddle @49699-49700, mixed edge k @49724-49725), `lineIntersectLine` @49874 (denom @49898, snap @49902-49903, manhDist @49907-49910), `segmentsOverlay` @49917 (dist@49919, eps=-L_EPS@49926, ось @49928), `checkContact` @49942 (B_EPS@49948/49954, вызов segmentsOverlay @49956), `compareContours` @50001 (полный алгоритм 50003-50125 — верифицирован), `compareContoursByArea` @49963 (setSize=10@49965), `compareContoursOnePoint` @49810, `angleBetweenLines` @49754, `projectionPointOnLine` @50128 (B_EPS хак @50141-50143), `perpendicularPoint` @50196, `contourValid` @50525-50530, `roundCoord` @50554 (×1000), `sortByArea` @59492-59521 (eps=10@59494), `triangulateContours` @51021-51026, `addSeg` @50932 (дедуп L_EPS @50939-50940).
- `WC.rightOriented` @54922 подтверждён (ang range @54925, LR cross @54927 — доk называет @54929, реально @54927, drift 2; не выделяю в drift-таблицу, потому что якорь функции точный).
- Комментарий доки L79 «coerce true → 1 в accuracy» подтверждён на @54427: signature — `pointOnLine(point, a, b, accuracy)`, 5-й аргумент игнорируется, 4-й `true` действительно попадает в accuracy.
- `contourArea` формула (∮y dx, знак CW-в-y-up) @49515-49525 — подтверждена; клиенты (`contourValid @50527`, `sortByArea @59495-59496`) берут `Math.abs`.
- `outerCovers.reverse() // o -> O` @60425 — точное совпадение с цитатой доки.

### deep-dives/09-wall-snap-internals.md
**Drift:**
- deep-09-wall-snap-internals.md L156: `CPoint.contour` set by `CRoom.addPoint`/`CRawContour.addPoint`, заявлен 57064/57172; реально `CRoom.addPoint` пишет на 56903 и 56909, `CRawContour.addPoint` — на 57175 и 57187. 57172 близко к 57175 (в пределах ±5); 57064 драйф ~161 строка (реально CRoom addPoint 56903).
- deep-09-wall-snap-internals.md L218–219: mouseUp черчения `new WC.CPoint(WC.snapPos.x, WC.snapPos.y)` (66043–66044); реально 66072 (drift ~29). На 66043–66046 — `signSide` в calcStart.
- deep-09-wall-snap-internals.md L228 (пайплайн): mouseMove кладёт `currentPt.x = WC.snapPos.x; currentPt.y = WC.snapPos.y` (66001–66002); реально 66010–66011 (drift ~9).

**Notes:**
- Ядро дока (snapX/snapY/snapPerpendicular/bisectorSnap/getSnapPoint 57346–57701) верифицировано построчно: константы `L_EPS=1e-8` @49482, `B_EPS=1e-4` @49483, `manhDist` @49490, `bisectorPoint` @50175, `roundCoord` @50554 (`Math.round(x*1000)/1000`), `distanceBetweenPointAndLine` @49567, `realToView` @61394, `SNAP_DIST=10` @60604 — все точны.
- Дефолты флагов `pointsSnap/pointsAlign/orthoAlign/bisectorAlign` @57563–57566 — совпадают (true, true, false, true).
- Лесенка приоритетов getSnapPoint (ветки 1–8 с якорями 57629/57633/57637/57650/57663/57679/57683/57687) — все точны построчно; финал `roundCoord + return [resTarget, alignerX, alignerY, alignerD, alignersX, alignersY]` @57698–57700 подтверждён.
- Все 10 call-site'ов `getSnapPoint` (63136/63976/64073/64347/64463/65362/65945/66406/66690/68477) верифицированы grep'ом — точны до строки.
- Бага рулетки `WC.aligners = [snapRes[1..3]]` при `snapRes` = `GEOM.Point` (StateMakingRuler:68725, StateDraggingRuler:68888) — подтверждён по коду; findSnap-функции начинаются на 68721/68884, snapPolygon-вызовы на 68723/68886.
- Идентичность полигонных дубликатов 57704/57771 оригиналам 9807/9742 не переверифицирована диффом в этой сверке — по чтению структура функций совпадает, но байтовая идентичность оставлена доверием к источнику дока.
- Мелкий off-by-3 в цитате «фильтры кандидатов на 57366»: сам `for` начинается на 57366, а строка с exceptPoints/pointInFrame — 57369; в пределах ±5, drift не помечен.

### deep-dives/10-furniture-stacking.md
**Drift:**
- deep-10-furniture-stacking.md L34: `exclude.children.includes(obj)` заявлен 36521, реально 36522 (drift +1).
- deep-10-furniture-stacking.md L153: диапазон клампов заявлен 11293–11300, реально 11292–11300.
- deep-10-furniture-stacking.md L173: `volume` геттер заявлен 11355–11357, реально 11356–11361.
- deep-10-furniture-stacking.md L179: раст по `constructorWalls` заявлен 44504, реально 44505 (drift +1).
- deep-10-furniture-stacking.md L180: закомментированная `sceneObject.y = positionPoint.y` заявлена 44526, реально 44528 (drift +2).
- deep-10-furniture-stacking.md L232: `stopChangingModelSizes → saveState` заявлен 43005–43008, реально 43001–43004 (drift −4; def 43001, saveState 43003).
- deep-10-furniture-stacking.md L307: moving-плоскость `PlaneBufferGeometry(50000,50000)` заявлена 37939, реально 37940 (drift +1).
- deep-10-furniture-stacking.md L327: `maxMoveDist` заявлен 44589, реально 44586 (drift −3).
- deep-10-furniture-stacking.md L362: групповой драг 45648 регион / `snapPolygon 45667–45679`, реально `moveGroupHorizontal` начинается на 45645, snap-блок ~45671–45683.

**Notes:**
- Ядро (shiftVectors@9280, getVectorsSides@31685, moveObjectSmart@44036/44465, moveObjectSmartFromCatalog@44502, moveObjectHorizontal@43952/44390, moveObjectStraight@44076, checkAsSmartMoving@43940+44378) — всё CONFIRMED построчно.
- Пороги/константы (`OBJECT_Y_MIN/MAX=0/1000` @11468–11469, `TERRAIN_SIZE=50000` @38221, terrain y=-0.2 @37910, moving y=-100 @37954, `maxMoveDist=5`, snap `updateDistance(15)` @41668, Snap2D дефолт 10 @9477, `moveElement(...,20)` @43989, `dropElement(...,10)` @43890, `findFreeSpace margin=1.5` @10096, `moveInFrontOfLines deltaAngle=π·0.2` @10046) — всё CONFIRMED.
- Событийные константы `OBJECT_SMART_MOVE` @838 и `OBJECT_DRAG_OUT_OF_WALL` @839 — CONFIRMED (dispatch @44073 и @43907).
- Утверждения о `APPOINTMENT_SCENE/WALL` @11473–11474 и отсутствии `APPOINTMENT_CEILING` — CONFIRMED (grep `ceiling` даёт только конструктор потолков помещения).
- Все drift'ы — в диапазоне 1–4 строк; ни один не задевает содержательный факт (обычно один комментарий/лишняя пустая строка между анкером и целевым выражением).
