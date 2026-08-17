# 02 — Проёмы: двери и окна

> Реверс из `plannercore.js` (не минифицирован). Проёмы — это **каталожные модели, натягиваемые на стену**, а не рисуемые. Дверь от окна отличается **не типом, а высотой подоконника** (`elevation`). См. `00-overview.md`.

## Interaction & placement

Проём = каталожная модель, перетаскиваемая на стену. 3D-сцена зовёт `constructor.dropElement(dataForWall, radiusDropElement)` с `radiusDropElement = 10` см (`R2D.Scene`, 13092). Интерактивный драг/move использует шире (20 в ряде мест; UI-слой `Snap2D` — 15).

**`WallsData.dropElement(dataObj, snapDist=10, sceneObject)` (55172):**

1. `center = (dataObj.x, dataObj.y)`.
2. `axis = getAxis(center, snapDist)` (55338) — ближайшая **ось стены** (центральная линия между двумя параллельными гранями): перебирает `me.axes`, берёт ось с наименьшим `distanceBetweenPointAndLine`, **но только если проекция попадает на сегмент** (`projectionPointOnLine(..., true)`) и `minDist ≤ snapDist`. Иначе `null` → **дроп отклонён** (элемент отскакивает).
3. Проецирует `center` на ось; строит `modelData`: `{x, y = projection, rotation = axis.angle, scaleX, scaleY, flipX, flipY, contour (из строки, зеркалится по X через scalePoints(-1,1)), elevation (подоконник), depth = axis.depth, materialBottom/Frame + rotations/offsets}`.
4. Пишет **позицию** двумя способами: абсолютно `axisPos = dist(axis.p1, model)` и нормализованно `pos = axisPos / axisLength` в `axis.positions[]`. Регистрирует в `dictModelAxis[id]`, пушит в `axis.models[]`/`modelIDs[]`.
5. `createFramesForAxis(axis)` пересобирает рамы, затем `createWall3D` на обеих гранях (`wall1`, `wall2`), обновляет разрывы плинтуса, диспатчит апдейты.

`moveElement` (55154) — та же проекция, но возвращает только снапнутые `{x, y, rotation, depth}` для live-драга (`rotation = π + axisAngle`). `pickElement(id)` (55241) снимает модель с оси и пересобирает обе стены — так проём удаляется/переставляется.

## Модель DataCut / DataFrame / DataPlug

Нюанс, который скрыт за названиями — есть **два разных представления «проёма»**:

- **Каталожная модель на `Axis`** — это и есть реальная дверь/окно. `Axis` (≈52086) держит `wall1`/`wall2` (две грани), центральную линию `point1`/`point2`, `depth` (толщина стены) и параллельные массивы `models[] / modelIDs[] / positions[] / frames[]`. Каждый `models[i]` несёт 2D-силуэт `contour`, `elevation` (подоконник), `scaleX/scaleY`, `flipX/flipY`, материалы рамы/низа.
- **`DataCut` (51682)** — **band-регион стены** (откос/облицовка или частичная секция стены): `point1/point2`, `low` (низ), `height` (верх); `area = length × (height − low)`. Регенерится `resetCuts` (60188) из сторон `arrAreas`, **не** из дропа двери. Сериализуется как `{id, pa, pb, m, addM, mr, mx, my}` (53531) по ID точек.
- **`DataFrame(top, materialParams)` (51889)** — **откосы/лутка проёма**: `topFrame` (верх + косяки выше `bottomHeight = 2` см, 54608) и `bottomFrame` (облицовка подоконника), каждая со своим материалом из `model.materialFrame` / `model.materialBottom`. **Дверь vs окно — не флаг типа, а геометрия:** `elevation` (подоконник) > 0 ⇒ окно; `elevation = 0` ⇒ дверь.
- **`DataPlug(pt1, pt2, axis, height)` (52053)** — **соединитель-перемычка** (`type:'plug'`, 52066): создаётся **только** в `createConnectors` (54382) как перемычка между торцами пар стен короче `maxConnectorLength = 40` (54384). К розеткам отношения не имеет.

## Positioning & snapping вдоль стены

- Горизонтальная позиция — `axis.positions[i]` (**нормализованная 0..1** вдоль оси) + абсолютная `axisPos`.
- Вертикальная — `elevation` (высота подоконника, см), применяется как `P.y = elevation − contourY` при проекции силуэта на грань.
- Снап при скольжении — на слое дропа/move через единственный тест `getAxis` (ближайшая ось в `snapDist`, проекция на сегменте). Внутри `dropElement` **нет** отдельного снапа к центру / к другим проёмам / к углам. Магнетизм вдоль стены к стенам/элементам — из общего `SNAP.Snap2D` (9476) с `updateDistance(15)` (15 см) при манипуляции в плане. Перекрытие двух проёмов на одной оси **сливается** (`compareAndRebuildContours`), не отклоняется.

## Параметрический размер, поворот, флип

- Ширина/высота — `scaleX`/`scaleY` модели (дефолты из каталога, не хардкод). Подоконник — `elevation`. Правка любого зовёт `createFramesForAxis`, который **переливает** все рамы и ре-триангулирует обе грани — отдельного пути ресайза нет.
- **Флип/сторона навески:** `flipX` зеркалит силуэт по горизонтали (`x *= scaleX * (flipX?−1:1)`) — меняет сторону петель и направление открывания; `flipY` в данных проёма — **не** вертикальный флип: `getObjectDataForWallElement` заполняет его из `sceneObject.flipZ` (`flipY: sceneObject.flipZ`, plannercore.js:14777), т.е. это зеркало по глубине стены (внутрь/наружу): 3D-геометрия — `flipGeometriesByZ` (32611), 2D-символ — `ctx.scale(flipX, flipZ)` (63823/72333). Силуэт дырки и лутки читают только `flipX` (53010, 55694). Настоящий `sceneObject.flipY` нигде не рендерится — только копируется и сериализуется как `fy` (14893); UI-тумблеры зеркала — только `flipCurrentModelX` / `flipCurrentModelZ` (42411/42425). Направление открывания закодировано в контуре + флипе, не отдельным enum'ом.
- 2D-символы плана — свои процедуры (`drawDoor14`/`drawDoor15`, 34669/34725): **дуга открывания** радиусом ≈ ширине проёма (полуширина для двустворки), из угла-петли, по `angle` модели. Окна — параллельные линии подоконника (без дуги).

### `ObjectViewer3DModelPlane` — как 2D-символ живёт в сцене (L33522)

2D-иконка двери/окна на плане — это **не отдельный оверлей канваса, а плоский меш в самой THREE-сцене**, показываемый только в 2D. Реализация:

- **Иконка рисуется в offscreen-canvas** и становится текстурой. `imgMakersMap` (33525) — таблица `imgId → drawFn`: `window_01…window_11`, `door_01…door_21` (`door_13` переиспользует `drawWindow09`) плюс `default_for_wall`. По `imgId` берётся процедура (`this.updateTexture = imgMakersMap[imgId]`, 35139), которая пишет в `this.canvas` (`ctx`, цвета `fill:#e6e6e6/stroke:black`, `k=5` для качества). Размер canvas = `sceneObject.width × depth`.
- **Два меша в одном `Object3D`** (35173–35193): `plane` — видимый quad (`MeshBasicMaterial{transparent:true}`) с текстурой-иконкой, масштабируется по `(canvasWidth-1)/planeSize` с учётом `flipX/flipZ`; `planeForClick` — **прозрачный хитбокс** (`opacity:0`, `y=1` поверх), масштабируется по реальным `sceneObject.width/depth` (не по картинке) — по нему идёт пик/выбор проёма (используется как цель клика: 32721, 47359, 47483). `planeSize = 100` — базовый размер quad'а.
- **Сектор открывания распашной двери** — `angle = angleMap[imgId] || 90` и `offset = offsetMap[imgId] || 0` (35150–35151; таблицы `angleMap`/`offsetMap` на 33585/33571). `angleMap` содержит единственную запись `door_03: 20` — все остальные двери открываются на 90°. `offsetMap` — **не** смещение петли, а вынос дуги открывания **за толщину стены** для расчёта размера canvas (комментарий в коде: `// виступ за основну товщину`, 33572); петля всегда в углу проёма (в `drawDoor14` дуга идёт из угла-петли). Механика: `calcTotalSizesOneSwing` (35098) считает `offset = newR·sin(angle) − th/2`, а `calcTotalSize` (35124) раздувает `canvasHeight` на `mainThickness + offset·2`. `totalSizesMap` (33562) — переопределение расчёта габаритов на модель.
- **Только 2D:** `updateObject()` (35260) делает ранний `return`, если `R2D.Viewers.getCurrentViewerType() === "3d"` — в 3D этот символ не строится/не обновляется; в 3D работает настоящая перфорированная геометрия из `getHoles` (см. ниже). То есть план и 3D — два разных визуальных представления одного проёма.

## Geometry rebuild — как делается дырка

**Не CSG.** `DataWall.build3D` → `getHoles()` (52990) обходит все оси, касающиеся стены, и для каждой модели проецирует силуэт `contour` в локальные (длина, высота):

```
P.x = contourX * scaleX * (flipX?-1:1) + positions[i]*axisLength + axisShift
P.y = elevation - contourY
```

Эти полигоны-дырки передаются как **внутренние контуры** в `TR.triangulateContours([[A,B,C,D]], partContours.concat(holes), …)` (53185) — грань стены триангулируется _вокруг_ дырок при пересборке (предвычислено; движок — `cdt2d` (constrained Delaunay) + `clean-pslg` из `tris.js`: `window.cdt2d = require('cdt2d')`, tris.js:1912). `createFramesForAxis` (55677) отдельно строит геометрию `topFrame`/`bottomFrame` через `WC.createFrame3D` с теми же сдвинутыми контурами и `axis.depth`. Каждая пересборка стены регенерит: (а) перфорированные грани, (б) меши рамы/лутки, (в) разрывы плинтуса под проёмом.

## Serialization

Проёмы хранятся как **список моделей на ось** (материалы `materialFrame`/`materialBottom` + rotations/offsets, `elevation`, `scale`, `flip`, `axisPos`) со ссылкой из записи области `{id, name, walls:[ids], cuts:[ids], h, ch, …}` (53602); `DataCut` — записи по ID точек (53531). Сам силуэт **не хранится** — пере-запрашивается из каталога по ID модели и ре-проецируется на загрузке.

## Edge cases

- Дроп отклонён, если нет оси в `snapDist` или проекция падает за концы сегмента (неявный мин. отступ от угла — проекция обязана лежать на оси).
- Несколько перекрывающихся проёмов на оси сливаются (`compareAndRebuildContours`), не отклоняются.
- Тест `parallel` в `getHoles` ориентирует силуэт правильно для той грани, что строится (зеркалит X и инвертит позицию для дальней грани).
- `bottomHeight = 2` см отделяет облицовку подоконника от верха/косяков — материалы могут различаться.
- Удаление проёма (`pickElement`) пересобирает обе грани и разрывы плинтуса — стена чисто закрывается.

## Confidence & gaps

- **Точно из кода:** `dropElement/moveElement/getAxis` (snapDist=10, проекция-на-сегменте), Axis/model-представление, математика `getHoles`, поля `DataCut`/`DataFrame`; `DataPlug` — соединитель-перемычка (`type:'plug'` на 52053, создаётся только в `createConnectors`, 54382, порог 40); split `bottomHeight=2`, триангуляция-с-дырками (не CSG; `cdt2d` + `clean-pslg`, tris.js:1912), формат сериализации.
- **Inferred (средняя):** дверь-vs-окно чисто по `elevation`; магнетизм вдоль стены из `SNAP.Snap2D`, а не оконного снаппера.
- **Не удалось пришпилить / под правку:** дефолтные размеры дверей/окон (в JSON каталога, не в этом файле); явного мин. отступа от угла при дропе не найдено (только тест проекции-на-сегменте), но в пути пере-дропа моделей при перестройке стен есть краевой отступ 5 см (`if (model.axisPos > axisLength − 5) continue`, 61995).

**Чего не хватает для реализации** (гэпы валидации; закрытое поздними дайвами — по ссылкам):

- Закрыто дайвами: построение осей (`findAxes`, `boxFromWalls`/`boxCenterSeg`) и поведение проёмов при перестройке стен (пере-дроп, краевой отступ 5 см) → [dd07](deep-dives/07-wall-axes-pipeline.md); выбор триангулятора с дырками → [dd01](deep-dives/01-triangulation-core.md) + [dd08](deep-dives/08-geometry-predicates.md); алгоритм `compareAndRebuildContours`, внутренности `getHoles` и UV/split-логика лутки (`createFrame3D`) → [dd06](deep-dives/06-opening-holes.md).
- Формат каталожного контура: весь механизм висит на `source.body.contourCut` + парсере `GEOM.P.contourFromString`; свой формат 2D-силуэта проёма (точки в см, origin, направление обхода, правило зеркалирования `scalePoints(-1,1)`) — решение за нами.
- 2D-символы: механизм (offscreen canvas → texture на quad) описан, но самих ~32 процедур рисования нет; для нас — либо спеки каждого символа, либо SVG-спрайты/InstancedMesh.
- Сериализация со стороны сцены: construction не хранит модели проёмов — они восстанавливаются пере-дропом scene-объектов; единый источник истины (`axisId` + нормализованный `pos` + `elevation` vs «мировые координаты + re-drop при загрузке») — решение за нами.
