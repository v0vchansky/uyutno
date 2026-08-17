# 05 — Выделение, гизмо‑трансформы, quick‑панели, группировка, copy/paste

> Реверс из `plannercore.js` (не минифицирован, 81349 стр.). Единицы сцены — см; экранные пороги — px. Две независимые подсистемы взаимодействия:
>
> - **`R2D.MIH`** (`MouseInteractionHelper`) — 3D/перспектива/2D‑план: продукты, конструктив (стены/пол/потолок как материалоносители), группы. Конечный автомат состояний `stateMain → stateSelected* → stateDragging*`.
> - **`WC.wallsEditor`** — 2D‑редактор контуров: выделение точек/стен/комнат/зон (см. `01-walls.md`).
>
> Общий шаблон: обработчик мыши/тача **возвращает** дескриптор `{state, type?, quickPanel?}` (это читает UI‑слой, чтобы отрисовать нужную панель), а параллельно **диспатчит** события в `apiScene` (`EventDispatcher`, создан на стр. 602, у MIH — `mih.api`). Позиция панели = сырые экранные координаты курсора, не проекция мира. См. `00-overview.md`.

---

## 1. Selection (MIH: продукты / конструктив / группы)

### Хит‑тест и приоритет

`mih.find3DObject(mx, my)` (стр. 42076) — единственная точка пиккинга:

1. Переводит экран → NDC через `Renderer3D.getMousePointForPicker`.
2. Райкастит `_scene3d.objectUnderCursor(...)` по разным наборам: `interactiveObjects` (когда активен `constructorSelection`, т.е. режим правки конструктива) **или** `productObjects` (иначе). То есть режим определяет, кликается ли стена/пол или мебель — они не конкурируют в одном райкасте.
3. По `object3d` находит вьюху: `productHelper.findObjectView3DByObject3D(...) || constructorHelper.findObjectView3DByObject3D(...)`.
4. Возвращает `{point, distance, view3DObject, partNum}` (для многосоставных мешей `partNum = object.num`). Первый по расстоянию хит (сортировка внутри `objectUnderCursor`) — победитель; отдельного приоритета «группа > продукт > стена» нет, разведение идёт по набору объектов и по полю `view3DObject.group`.

### Идле‑хаб `stateMain` (диспетчер выделения)

`StateMain.mouseUp` (стр. 43572) при клике (сдвиг ≤ `maxMoveDist`, см. ниже) читает `objectData.view3DObject`:

- `objectType == "product"`:
  - есть `.group` и группа `visible` → `setActiveGroup(group, x, y)`, `changeState(stateSelectedGroup)`, возврат `{state:"stateSelectedGroup", quickPanel:{x,y}}` (43597).
  - иначе, если `sceneObject.visible` → `setActiveObjectProduct(view, x, y, objectData)`, `changeState(stateSelectedProduct)`, возврат `{state:"stateSelectedProduct", quickPanel:{x,y}}` (43610).
- `objectType == "constructor"` → `setActiveObjectConstructor(view, x, y, objectData)` (сама возвращает дескриптор), `changeState(stateSelectedConstr)`.
- Клик по пустому → остаётся в `stateMain`.

Тач‑ветки `StateMain.touchEnd` (43644) зеркальны.

### Представление состояния выделения

Выделение хранится **не в дескрипторе**, а в полях сцены (устанавливаются в сеттерах):

- `setActiveObjectProduct` (42138): `scene.currentView3DObject`, `scene.currentSceneObject = view.sceneObject`; подписывается на `Event.UPDATE` объекта; зовёт `currentViewer.selectedObject(view)` (включает обводку — см. §2); строит 3D‑линейки (`_ruler3d`). Ранний выход, если объект `isLockedOnScene`/`partialVisible`.
- `setActiveObjectConstructor` (42230): `currentView3DObject`, `currentPartNum`, `currentConstructorElementData`; дополнительно семплит `find3DObject` в точках `(mx+1, my)` и `(mx, my+1)` (42236–42237), чтобы получить `vectorsForMatMove` (базис для сдвига материала стрелками). Возвращает `{state:"stateSelectedConstr", type: view.getType(), quickPanel:{x:mx, y:my-30}}`.
- `setActiveGroup` (42108): `scene.currentGroup = group`; линейки строятся вокруг группы.
- Снятие: `unsetActiveObjectProduct` (42170) зовёт `currentViewer.unselectedObject(...)`, чистит линейки, обнуляет `currentView3DObject/SceneObject`; `unsetActiveGroup` (42123); `unsetActiveObjectConstructor` (42251). `unsetActiveObject` (42259) диспатчит по текущему состоянию и переводит в `stateMain`.

### Single vs multi‑select

Мультивыделение реализовано **только через группы** (нет «списка выделенных»). **Ctrl/Cmd‑клик** по другому продукту, находясь в `stateSelectedProduct` (`mouseUp`, 45028): создаёт новую группу (`_productHelper.addGroup(false)` — не «merged»), добавляет туда текущий объект и кликнутый, снимает продукт‑выделение, переходит в `stateSelectedGroup`, диспатчит `STATE_SELECTED_GROUP {pos:{x,y}}`. Ctrl‑клик в `stateSelectedGroup` (45411) — добавляет/убирает объект из текущей группы (toggle); при уменьшении группы до 1 объекта — авто‑роспуск (см. §4).

### Уведомление UI (apiScene‑события)

Константы имён — стр. 824–872. Реально диспатчатся при выделении:

- `SET_ACTIVE_PRODUCT="setActiveProduct"` payload `{model}` (стр. 14452, при **paste** одиночного продукта, только если это не пришло из глоб. буфера).
- `SET_ACTIVE_GROUP="setActiveGroup"` payload `{group}` (14409, при paste группы).
- `STATE_SELECTED_GROUP` payload `{pos:{x,y}}` (45055, при Ctrl‑слиянии).
- `SHOW_OBJECT_QUICK_PANEL` / `HIDE_OBJECT_QUICK_PANEL` (пустой payload) — показать/скрыть панель после жеста вращения / при старте драга (45017, 44683).
- `QUICK_PANELS_HIDE` (пустой) — «скрыть всё» при клике по пустоте/линейке (43589 и др.).
- Событий `SET_ACTIVE_WALL/ROOM` нет. ⚠️ Регистрации `NEEDS_ACTIVE_WALL/ROOM/FILL/FLOOR/...` (58454–58472) и их обработчик `pageConstructionListener` (58615) лежат внутри **закомментированного блока** — в `plannercore.js` это мёртвый код; реальный механизм правой панели живёт в UI‑слое (`react.js`) и по ядру не восстанавливается (см. Confidence & gaps).

---

## 2. Transform‑гизмо, хендлы, обводка

### Обводка выделения — `OutlineFilter`

`OutlineFilter` (стр. 76049) — пост‑процесс на трёх проходах: `DepthPass` → `OutlinePass` (контуры по глубине) → `OverlayPass` (наложение). Создаётся при инициализации рендера (`new OutlineFilter()`, 36607/19798) и настраивается: `setInsideColor(1,1,1,0)`, `setOutsideColor(1,1,1,0)`, **`setStrokeColor(1.0, 0.7, 0.0, 1.0)`** (36623/19801) — жёлто‑оранжевая обводка (RGBA 255/178/0). Рендерится в петле (36679–36746) для каждого выделенного объекта: `filterSelect.setComponents(sceneSelect, camera, renderer); filterSelect.render()`. Т.е. «хайлайт» — это обводка контура, а не bounding‑box гизмо.

### Move (перетаскивание) — click‑vs‑drag порог

- **Порог клика/драга: `maxMoveDist = 5` px** (объявлен в каждом `stateSelected*`, напр. 44589). Ниже 5px евклидовых (`TR.euclDistP(up,down)`) — это клик; выше — драг/ничего.
- Старт драга происходит уже при **сдвиге ≥ 1 px** в `stateSelectedProduct.mouseMove` (44959): если под курсором тот же `currentView3DObject`, зовётся `stateDraggingProduct.startDraggingProduct(...)` и `changeState(stateDraggingProduct)` (возврат `{state:"stateDraggingProduct", quickPanel:{x,y}}`). Заблокировано для `isLockedOnScene`/`partialVisible` и при активном лого‑редакторе.
- `StateDraggingProduct` (43774): `moveProduct → moveObjectHorizontal(view, mx, my, useSnap)` (43952). Дельта считается как `intersection.point + oldPosition − pointIntersect` (интерсект с горизонтальной плоскостью `_object3DMoving` на высоте объекта). Настенные объекты (`getForWall()`) прилипают к стенам через `_constructor.moveElement(pos, 20)`; на дропе — `dropElement(...,10)`.
- На `mouseUp` — `stopDraggingProduct` (43864): восстанавливает контроллеры, для настенных пересчитывает `dropElement`, `history.saveState()`, `changeState(stateSelectedProduct)`, диспатч `HISTORY_UNDO_REDO`.

### Rotate — 3D‑кольца (гизмо вращения)

Только когда `scene.isRotation3dActive`. `StateSelectedProduct` управляет кольцами `rings3d` (объекты `ringX/ringY/ringZ` + `sphereRings`, имена вроде `planeX/planeY/planeZ`):

- `mouseDown` (44665): райкаст в `curPlane`; по имени плоскости выбирает ось (`curDir = x|y|z`), вычисляет `startAngle = atan2(...)`, показывает соответствующее кольцо, ставит сферу‑хендл, `START_ROTATING_OBJECT {axis}`.
- `mouseMove` (44754): пересчитывает `angle`, `findAngles()` разрешает переход через ±π (аккумулирует `curAngle`), крутит `currObj3d.rotateOnWorldAxis(axisVec, dRot)`. Радиус клампится `rMax = 300`.
- `mouseUp` (44987): фиксирует `rotationX/Y/Z = round(toDeg(...))`, `STOP_ROTATING_OBJECT`, затем `SHOW_OBJECT_QUICK_PANEL`.
- В 2D‑плане поворот и кнопки — через `objectButtonsUpdate()`.

### Scale / ресайз — 2D‑оверлей `R2D.ProductTransform2D` (стр. 77330)

В самом MIH scale‑гизмо нет, но **на канвасе (в 2D‑плане) есть отдельный оверлей ресайза** `R2D.ProductTransform2D` (77330) — он живёт вне MIH, управляется `ProductTransform2DHelper` (41416), привязан к выделенному продукту (`updateProduct` 47554/47557).

- **4 рёберных грипа** R/B/L/T на серединах сторон повёрнутого бокса (`buttonR/B/L/T.update`, 77358–77366); каждый грип — div `size=7` px (`R2D.ProductTransform2DButton`, 77158/77163; в файле рядом лежит закомментированная SVG‑polygon версия с `size=10`, 77215–77326 в блоке `/* … */` — не действует). Углового/поворотного/move‑хендла нет.
- **Односоставный ресайз** (одна ось за раз, без сохранения пропорций): `leftMouseMove` меряет дистанцию от **противоположного** грипа вдоль оси объекта и сдвигает центр на половину дельты (77368–77384). Минимум — `minRealSize = 2` см (77350/77355/77381), максимума нет.
- **Пишет обратно в `sceneObject`**: на прогрессе `width/depth` живьём (41485–41488), на финише — `setWidth`/`setDepth` + `history.saveState()` (41502–41508).
- **Когда показывается**: только когда у объекта выключен fixed‑size (`getIsFixedSizeEnabled()===false`, 41529/41541); `useButtons(r,b,l,t)` (41443): во время вращения — ни одного; настенный MODEL — только L+R (ширина); иначе все 4.

Масштаб как множитель также живёт в `sx/sy/sz` и правится числами из UI‑панели (пропорционально — `changeSizesByRatio` 42888) — но это дополнение к канвас‑грипам, а не единственный путь.

### Клавиатура: нудж и удаление

**Нудж** (`R2D.KeyboardController` + `keyboardControllerEvent`, 45804): стрелки/WASD.

- Базовый шаг `dist = 1`; **Shift** → 10; **Shift+Ctrl/Cmd** → 0.1 (единицы см; в имперской системе — дюймы/футы через `DimensionSystem`).
- Диспатч по типу выделения: `moveSelectedObject` (продукт), `moveSelectedMaterial` (конструктив — двигает материал по грани через `vectorsForMatMove`), `moveSelectedGroup` (группа). Если ничего не выделено — те же стрелки двигают камеру.
- `keyUp` для WASD в не‑`stateMain` вызывает `history.saveState()` + `HISTORY_UNDO_REDO` (`keyUpEventHandler`, 28564–28567).

**Удаление** (keydown‑листенер, 46029): `Delete`/`Backspace` (не в `input`) → `unsetActiveMesh()`, диспатч `HISTORY_UNDO_REDO {removeQuickPanel:true}`, `scene.removeCurrentObject()`.
**Esc** (46049): по состоянию — снять продукт/распустить группу/снять конструктив, вернуться в `stateMain`, диспатч `RETURN_TO_DEFAULT_MODE`.
**Undo/Redo**: Ctrl/Cmd+Z, Shift+Z и Ctrl+Y (46001–46028) → `scene.history.undo/redo` + `HISTORY_UNDO_REDO`.
**Copy/Paste**: Ctrl/Cmd+C → `scene.copy()`; Ctrl/Cmd+V → `scene.paste()` (46037–46048). Всё гейтится `KeyboardInteractionHelper.keysBlocked`.

---

## 3. Quick‑панели (плавающие контекстные тулбары)

**Позиция панели = экранные координаты курсора, а не проекция 3D‑точки.** UI‑слой получает якорь `quickPanel:{x,y}` в дескрипторе и сам рисует тулбар.

- **MIH‑объекты (продукт/группа):** `quickPanel:{x: e.clientX, y: e.clientY}` — панель просто у курсора (43617/43603/45056/45060 и тач‑аналоги).
- **MIH‑конструктив:** единственный вертикальный офсет — `quickPanel:{x: mx, y: my − 30}` (42248), панель на 30px выше курсора.
- **2D walls‑editor:** `quickPanel:{x: WC.viewPos.x + offsetWidth + 5, y: WC.viewPos.y − 30}` (напр. 65028/65036/65082/65091), где `WC.viewPos` — канвас‑координата клика (из `e.offsetX/offsetY`), `offsetWidth = Viewers._instance.getOffsetWidthDueToOpenedPanels()` — сдвиг вправо на ширину открытых боковых панелей. Панель удаления стены диспатчит `QUICK_PANEL_SHOW {type:'delete', quickPanel:{x: viewPos.x+offsetWidth, y: viewPos.y−30}, addType:'deleteSplittedWall'}` (80276) и скрывается `QUICK_PANEL_HIDE {type:'delete'}` (80293).

Старый DOM‑класс `R2D.QuickPanel` с `setPosition(x,y)` (58396–58433) **закомментирован** — позиционирование целиком делегировано UI по событиям.

Истинная проекция мир→экран (`.project(camera3d)`, NDC→px: `x = w/2·ndc.x + w/2`, `y = h/2·(−ndc.y) + h/2`, стр. 39239) используется **не** для объектных панелей, а для якорей линеек/выравнивателей.

---

## 4. Группировка

### Класс группы — `R2D.ObjectViewer3DGroup` (стр. 35313)

- `objectType='group'`. Хранит `objViews[]` (мемберы), `container` (`THREE.Object3D`), `bbox` (`THREE.Box3`). Трансформ‑поля: `_x/_y/_z`, `_rotation`, `_fx/_fz` (флипы), `_sx/_sy/_sz` (масштаб), плюс `isLockedOnScene`, `visible`, `partialVisible`, **`merged`** (по умолчанию `true`).
- **Пивот = центр bbox по XZ, низ по Y.** В `add(objView)` (35382): временно отвязывает объекты в мировое пространство, считает общий `Box3`, ставит `_x=(minX+maxX)/2`, `_z=(minZ+maxZ)/2`, `_y=minY` (клампится ≥ 0), `container.position.set(_x,_y,_z)`, затем `container.attach(...)` — т.е. объекты становятся детьми контейнера и наследуют его трансформ.
- `addUnchanged`/`removeUnchanged` (35341/35360) — добавить/убрать без пересчёта пивота и без наследования трансформа (для загрузки/paste/undo): переносят `object3d` между `productObjects` и `container`, ставят/снимают `objView.group`.
- `add`/`remove` (35382/35454) — «умные»: при входе/выходе переносят флип/поворот/масштаб группы на `sceneObject` члена (напр. `sceneObject.rotationY -= k·floor(toDeg(_rotation))`, ширина / `_sx`), чтобы объект унаследовал/сбросил трансформ группы. Back‑pointers: `objView.group = me`, `objView.object3d.group = container` — по ним везде определяется членство.
- `validSceneObject(obj)` (35849): группируются только `type ∈ {'2','3','4'}` и **не** `forWall` — настенные объекты в группу не берутся.
- `setWidth/setHeight/setDepth` (`setHeight` 35790, `setWidth` 35800, `setDepth` 35811): резайз группы через **множитель масштаба** (`_sx *= val/oldWidth`) на `container.scale`, не по‑объектно.

### Трансформы группы

Все сеттеры двигают `container` и диспатчат `Event.UPDATE` (объекты едут как дети):

- `setX/setY/setZ` (35586–35608) + геттеры/сеттеры `x/y/z` (`Object.defineProperties`, 35610).
- `setRotation(r)` (35722): `container.rotation.set(0, r, 0)`, пересчёт bbox.
- `flipX/flipZ` (35732/35740): инвертируют `container.scale.x`/`.z` и `_fx`/`_fz`.
- `get2DRectPoints()` (35560): 4 угла bbox **относительно** позиции контейнера (для снапа при драге).
- `getGeomBox()` (35571): `GEOM.Box` по центру/размерам.
- `update()` (35748): прокидывает `update()` во все `sceneObject` мемберов.

### Хелперы `ProductSceneHelper` (40472+)

- `addGroup(merged=true)` (40472): `new ObjectViewer3DGroup()`, пушит в `scene.groups`, добавляет контейнер в `productObjects`.
- `addObjToGroup(obj, group?)` / `removeObjFromGroup` (40495/40502; последний используется в ctrl‑toggle, 45429).
- `removeGroup(group)` (40481): вынимает все объекты, убирает контейнер, чистит `scene.groups`.
- `removeGroupsWithOne()` (40510): подчищает вырожденные группы ≤ 1 объекта.

### Выделение и драг группы

- `StateSelectedGroup` (45320): `mouseDown` кэширует `find3DObject`; `mouseMove` (45359) при сдвиге ≥ 1px и если объект принадлежит `currentGroup` → `stateDraggingGroup.startDraggingProduct(...)`, `changeState(stateDraggingGroup)`. Драг заблокирован при Ctrl/Cmd (это режим add/remove) и для locked/partial.
- `StateDraggingGroup` (45564): `moveGroupHorizontal(group, mx, my, useSnap)` (45645) — та же дельта‑логика, что у продукта, но применяется `group.setX/setZ`. `useSnap` = **инверсия** Ctrl/Cmd (на Mac — `!metaKey`), т.е. по умолчанию снап включён, Ctrl отключает. Снап: `snap2d.snapPolygon(group.get2DRectPoints(), ...)`. `startDraggingProduct` (45626) запоминает `oldPosition={x,y,z}` группы, глушит контроллеры мыши/тача. `stopDraggingGroup` (45697): `history.saveState()`, `changeState(stateSelectedGroup)`, `updateFreeSpace()`, `HISTORY_UNDO_REDO`.

### Создание / роспуск

- **Создание**: Ctrl/Cmd‑клик по второму продукту (45028 в `stateSelectedProduct`) — `addGroup(false)` + два `addObjToGroup`. Валидируется `ObjectViewer3DGroup.validSceneObject(...)`; forWall‑объекты в группу не берутся (45420).
- **Merge** (`mergeCurrentGroup`, 41718): ставит `group.merged = true` (склеенная группа не распускается при снятии выделения) + save.
- **Ungroup** (`ungroupCurrentGroup`, 41704): `unsetActiveGroup()`, `group.clear()` (возвращает всех в сцену), `removeGroup`, save, `stateMain`. Вызывается при клике по пустоте, если группа **не merged** (45460); merged‑группа при клике‑мимо просто снимается (`unsetActiveGroup`).
- **Ctrl‑toggle члена** (45411/45426): добавление `addObjToGroup`; при удалении, если осталось `getObjViews().length == 1` → распустить, вернуть последний объект как `stateSelectedProduct` (`removeGroupsWithOne`), save + `HISTORY_UNDO_REDO`; каждое изменение диспатчит `GROUP_COUNT_UPDATE`.
- `removeCurrentGroup` (41727): удаляет группу **вместе** с объектами (Delete по группе), чистит `hiddenElements`.
- **Трансформы активной группы из UI** (публичный API 885–934): `rotateCurrentGroup` (→ `group.setRotation`), `elevateCurrentGroup` (→ `group.y`), `flipCurrentGroupX/Z`, `duplicateCurrentGroup`, `merge/unmergeCurrentGroup`; геттеры `getCurrentGroup/Rotation/Elevation`, `currentGroupIsMerged`. Единого «толстого» дескриптора группы нет — UI тянет скаляры этими геттерами, авторитет — живой `scene.currentGroup`.
- `copyFrom(gr)` (35756) при дубле группы клонирует каждый `sceneObject`, `addUnchanged` в новую группу и сдвигает вбок: `x = gr.x + bbox.width`.

### Дескриптор состояния группы для UI

Как и у продукта, минимален: `{state:"stateSelectedGroup", quickPanel:{x,y}}`. Идентичность/состав группы UI берёт из `scene.currentGroup` (`.getObjViews()`, `.merged`, `.isLockedOnScene`), а не из дескриптора. Событие счётчика — `GROUP_COUNT_UPDATE`.

---

## 5. Copy / Paste / Clipboard — `R2D.CopyPaste` (стр. 69206)

Фасад над **однослотовым** JSON‑буфером в `R2D.Storage` под ключом `'r2d_clipboard'`. Каждая запись — дескриптор `{type, value}`, `type ∈ {material, logoMesh, constr, model, group}`. Всё пишется через `objToClipboard(obj)` (69214: `JSON.stringify → Storage.save → dispatch CHANGE`), читается `objFromClipboard()` (69221: `Storage.load → JSON.parse`, `null` на ошибке), чистится `clear()` (69208). Тяжёлая сериализация делегирована `Scene.makeSceneObjectData` (14862) и `Scene.makeSceneGroupData` (14992); реинстанс — `Creator.makeFromLoadedData` (18178).

### Что сериализуется

- **material** (`copyMaterial`, 69236): `{type:'material', value: val}`.
- **logoMesh** (`copyLogoMesh`, 69241): `{type:'logoMesh', value:{...getLogoParams(hash)}}` (пишется из `LogoEditor.copyLogo`, 18801).
- **constr** (`copyConstruction`, 69263): `{type:'constr', value:{m: materialID, mr, mx, my}}`; для стены с `configData` дописывает `obj.m = getMaterial(partNum)` и `obj.conf = configData.toData()`. ⚠️ `addM` не пишется, хотя paste его читает — всегда `undefined`.
- **model** (`copyModel`, 69318): `{type:'model', value: makeSceneObjectData(sceneObject)}`. `value`: `id, objid, type, x, y, z:-z, sx/sy/sz, rx, ry:-rotationY, rz, width, height, depth, isLockedOnScene, visible, partialVisible, plan, userKey, isOwner, externalData, isParametric` (+ опц. `configInfo`). Для `MODEL`: `fx/fy/fz` (флипы 0/1), `materials`, и для настенных — `forWall, mf/addMf/mfr/mfx/mfy` (рама) и `mb/addMb/mbr/mbx/mby` (низ); для света — `lightInfo`. ⚠️ **`z` и `rotationY` инвертируются** на сериализации.
- **group** (`copyGroup`, 69350): `{type:'group', value: makeSceneGroupData(group)}` (14992). `value`: `objects:[objid‑строки], objectsData:[полные снапшоты членов], x, y, z, r:toDeg(rotation), fx, fz (0/1), sx/sy/sz, isLockedOnScene, visible, partialVisible`. Каждый `objectsData[i]` (15021): `id(productId), objid, type, x/y/z, sx/sy/sz, rx/ry:-rotationY/rz, width, height, isLockedOnScene, fx/fy/fz`. Paste восстанавливает по совпадению `grData.objects[j] == view.sceneObject.objid` (14382), затем ре‑применяет трансформ группы и диспатчит `SET_ACTIVE_GROUP`.

**Две разные сериализации групп:** `makeSceneGroupData` (ID‑based, для copy и полного сохранения сцены) **против** `SceneHistory.makeGroupsStates` (13037, для undo/redo) — последняя хранит **живые ссылки** на `sceneObject` + `{position, rotation, flip:{x,z}, scale:{x,y,z}}`, а не ID.

`modelToData` (69355) — параллельный **лёгкий** сериализатор (без инверсий z/ry, без objid/размеров/владения); в живом пути copy не используется. `dataToModel` (69391) — **пустая заглушка** (реальный реинстанс — `Creator.makeFromLoadedData`).

### Оркестрация copy/paste

- `scope.copy` (14300): конструктив → `copyConstruction`; иначе `currentSceneObject` → `copyModel`; иначе `currentGroup` → `copyGroup`.
- `scope.paste` (14311, async): сначала `await checkGlobalClipboard()`; активный конструктив → `pasteConstructionTo` (материал/конфиг, без позиционирования); иначе `objFromClipboard()` → гейт премиум/владения (`PASTE_PREMIUM_PRODUCT_ERROR`, 14339) → `await pasteModel()`.

### Позиционирование и офсет при paste

Фиксированного «дубликат +delta» нет — объект кладётся в точку **райкаста от текущего курсора** на терен/интерактив: `model.x = point.x; model.z = point.z; model.y = value.y` (14349+). **Фолбэк без хита** (14418): `model.z = -value.z; model.x = value.x + value.width` — горизонтальный сдвиг на собственную ширину (чтобы не лечь ровно на оригинал; z ре‑инвертируется). В перспективе `rotationY` доснапливается к ближайшим 90° по пану камеры (14429). Для групп (14355–14405): новая группа создаётся **всегда** (`prodHelper.addGroup()`); дальше выбирается только **источник клонов**: если в `R2D.scene.groups` есть группа с тем же числом членов и тем же отсортированным мультимножеством product‑id (берётся первая подходящая, `break`), вызывается `group.copyFrom(existing)` (35756–35784: клонирует sceneObject'ы существующей группы в её текущем состоянии и ставит `x = gr.x + bbox.width`), а собранные из буфера модели **отбрасываются**; иначе модели из буфера добавляются в сцену и собираются в группу по `objectsData`. В обоих случаях позиция/поворот/флипы/масштаб затем перетираются точкой курсора и данными буфера (14392+). Это не дедуп, а подмена источника клона (ложные срабатывания на первой попавшейся группе с тем же набором продуктов + staleness). В конце — `history.saveState()`.

### Кросс‑проектный / глобальный буфер

`checkGlobalClipboard` (69405, async): пропускает, если текущий вьюер — `"constructor"`; иначе `navigator.clipboard.readText() → JSON.parse`. Если у объекта `action === "copy_to_clipboard"` — **очищает OS‑буфер** (`writeText("")`), переносит payload в локальный слот `objToClipboard({type:"model", value: obj.model})`, возвращает `true`. Импортирует **только model** (не группы/материалы). Это односторонний мост «внешний источник → планер»: сам планер в OS‑буфер **не пишет** — `copyModel`/`copyGroup`/`copyConstruction` кладут данные только в localStorage `r2d_clipboard_<key>` (69214/69318, `R2D.Storage` 17776), а `navigator.clipboard` используется исключительно на чтение здесь (69405–69420); ни один бандл roomtodo-src не пишет `{action:"copy_to_clipboard"}` в OS‑буфер. Кросс‑вкладочный/кросс‑проектный перенос в рамках origin обеспечивает уже сам localStorage‑слот; суффикс `<key>` — не идентификатор пользователя, а query‑параметр `key` из конфига `R2D.URL.URL_SIGN_IN` (`R2D.Storage.getKey`, 17761–17774), т.е. ключ инсталляции — тот же суффикс у `r2d_token` до логина (16334).

### Событие CHANGE

`CopyPaste.CHANGE='copyPasteChange'` (69403) на приватном `_dispatcher` (69396), подписка через `CopyPaste.addEventListener`. Диспатчится в `objToClipboard` и `clear`. Внутри `plannercore.js` подписчиков нет — хук для внешнего UI (доступность кнопки Paste).

---

## 6. Duplicate / Clone

Дублирование живёт **не** в CopyPaste, а на MIH (`planner.scene.duplicateCurrentModel/Group`, 887–888):

- **`duplicateCurrentModel`** (42306): `sceneObject.clone()` + **пространственный офсет** (в отличие от paste). Для настенных — пробует ±`getWidth()` (повёрнуто на `-rotationY`) и берёт сторону, которую принимает `moveElement`. Для свободностоящих — ищет свободную соседнюю ячейку по дистанциям линеек, офсет на `getWidth()`/`getDepth()`; иначе «Not enough space»/«Out of bounds». Копирует `lightInfo`, `scene.add(clone)`, save, `ESTIMATION_SEND`.
- **`duplicateCurrentGroup`** (42389): `addGroup()` + `newGroup.copyFrom(currentGroup)` (глубокий клон каждого `sceneObject.clone()` и `addUnchanged`, 35756), save, `ESTIMATION_SEND`. В самой функции (42389) офсета нет, но `copyFrom` (35756) сдвигает копию вбок на ширину bbox (`x = gr.x + bbox.width`, см. §4) — дубль ложится рядом, а не поверх оригинала.

Прочие `clone()` в файле — THREE.js/GEOM (геометрия/материалы/точки), к фиче copy/paste отношения не имеют.

---

## Data model (сводка полей)

| Сущность                       | Ключевые поля                                                                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Продукт (`currentSceneObject`) | `x,y,z`, `sx/sy/sz`, `rotationX/Y/Z`, `width/height/depth`, `flipX/flipZ`, `objectId`, `isLockedOnScene`, `visible`, `partialVisible`, `forWall`, `isParametric`, `isLight/lightInfo`, `materials` |
| Группа (`ObjectViewer3DGroup`) | `objViews[]`, `container`, `bbox`, `_x/_y/_z`, `_rotation`, `_fx/_fz`, `_sx/_sy/_sz`, `merged`, `isLockedOnScene`, `visible`, `partialVisible`                                                     |
| Дескриптор для UI              | `{state, type?, quickPanel:{x,y}?}`                                                                                                                                                                |
| Clipboard                      | `{type: material\|logoMesh\|constr\|model\|group, value}` в `Storage['r2d_clipboard']`                                                                                                             |
| Group‑serialize                | `{objects[], objectsData[], x,y,z, r, fx,fz, sx/sy/sz, isLockedOnScene, visible, partialVisible}`                                                                                                  |

## Geometry rebuild

- Продукт/группа при драге: дельта = `intersect.point + oldPosition − pointIntersect`; группа применяет к `container` (дети едут наследованием трансформа), продукт — к `sceneObject.x/z`.
- Группа пересчитывает `bbox` (`Box3.setFromObject(container)`) при каждом add/remove/rotation; пивот — центр XZ, низ Y.
- Настенные объекты re‑drop через `_constructor.dropElement(...,10)` на конце драга.
- Paste‑group: новая группа создаётся всегда; при совпадении мультимножества product‑id с существующей группой (первой подходящей) источником клонов становится она (`copyFrom`, 35756), модели из буфера отбрасываются; позиция/поворот затем перетираются курсором и данными буфера (14392). Не дедуп.

## Snapping & constraints (пороги)

- **Click‑vs‑drag: `maxMoveDist = 5` px** (евклидово, `TR.euclDistP`).
- **Старт драга: сдвиг ≥ 1 px** (продукт и группа).
- **Снап при драге (2D‑проекция): эффективно `15` см.** Конструктор `SNAP.Snap2D` ставит `_distance = 10` (9477), но `updateSnap2d()` на **каждом** старте драга вызывает `_snap2d.updateDistance(15)` (41668) — это единственный `updateDistance` в файле, так что 10 — лишь предзагрузочный дефолт, а рабочий радиус магнита = **15 см**. `snapPolygon` (10007): сначала к линиям стен (заодно доворачивает угол), потом к боксам предметов. Настенный re‑snap — `moveElement(...,20)` / `dropElement(...,10)`. (Не путать с `WC.SNAP_DIST=10` walls‑редактора — это отдельная подсистема.)
- **Нудж:** шаг 1 / Shift 10 / Shift+Ctrl 0.1 (см; имперская — дюймы/футы).
- **Rotate:** кламп радиуса `rMax = 300`; фиксация углов через `round(toDeg(...))`; снап `rotationY` к 90° при paste в перспективе.
- **Снап группы включён по умолчанию, Ctrl/Cmd его отключает** (инверсия).

## Edge cases

- `isLockedOnScene` / `partialVisible` блокируют выбор, драг, нудж, группировку почти во всех ветках.
- Ctrl‑удаление последнего второго члена группы → авто‑роспуск и возврат к продукту.
- Merged‑группа переживает клик‑мимо (только снимается), не‑merged — распускается.
- Paste без райкаст‑хита → офсет на собственную ширину; иначе paste точно под курсор (не дубль‑офсет).
- Глобальный буфер импортирует только `model` и деструктивно очищает OS‑clipboard.
- Настенные объекты не добавляются в группы.
- `copyConstruction` не пишет `addM`, `pasteConstructionTo` его читает → всегда `undefined`.
- `dataToModel` — мёртвая заглушка; `modelToData` — легаси, не в живом пути.
- Клавиатура игнорируется в `input`/`.sun-editor` и при `keysBlocked`.

## Confidence & gaps

**Высокая уверенность** (прочитано напрямую, с номерами строк): пороги click/drag (5px) и старта драга (1px), `OutlineFilter` цвет обводки (1.0,0.7,0.0), схема состояний MIH, дескриптор `{state,type,quickPanel}`, quickPanel = экранные координаты курсора (+`-30` для конструктива, `+offsetWidth+5/-30` для 2D), внутренности `ObjectViewer3DGroup` (пивот=центр XZ/низ Y, container‑наследование, copyFrom‑клон), логика создания/роспуска/merge групп, весь `R2D.CopyPaste` (формы `{type,value}`, инверсии z/ry, глобальный буфер, offset‑фолбэк на ширину), duplicate‑офсеты, клавиатура (нудж/delete/esc/undo/copy).

**Пробелы / средняя уверенность:**

- Pull‑модель правой панели для стен/комнат по ядру **не восстанавливается**: регистрации `NEEDS_ACTIVE_WALL/ROOM/...` (58454–58472) и обработчик `pageConstructionListener` (58615) лежат в закомментированном блоке (`/*` открывается в регионе 58454, закрывается ~58485) — в `plannercore.js` это мёртвый код. Факт «событий `SET_ACTIVE_WALL/ROOM` нет» остаётся верным; живой механизм — в UI‑слое (`react.js`), вне ядра.

- Ресайз на канвасе **найден и подтверждён** (`R2D.ProductTransform2D`, 77330, 4 рёберных грипа, min 2 см, пишет `width/depth`) — прочитан построчно (High). Это отдельный от MIH оверлей, показывается в 2D при выключенном fixed‑size.
- Точная отрисовка тулбар‑кнопок и их набор — в UI‑слое (вне `plannercore.js`); дескриптор несёт только `state`/`type`, без `id`/`buttons`.
- Внутренности `Scene.makeSceneObjectData`/`makeSceneGroupData`/`Creator.makeFromLoadedData` прочитаны через агентское резюме, не построчно целиком — набор полей достоверен, но крайние ветки (parametric/light configInfo) могли быть не полностью раскрыты.
- WC 2D‑редактор (точки/стены/комнаты/зоны/cover) покрыт по quickPanel и приоритету хит‑теста; полная механика правки — в `01-walls.md`.
- Payload‑поля некоторых apiScene‑событий (`ESTIMATION_SEND`, `GROUP_COUNT_UPDATE`) не раскрыты по содержимому — известно только имя и место диспатча.

**Чего не хватает для реализации:**

- **Шейдеры обводки**: GLSL/параметры `OutlineFilter` не раскрыты. Для r185 — `OutlinePass` из examples или свой edge-detect; копировать не нужно.
- **Модель выделения**: у конкурента размазана по полям + FSM. Нам — единый typed selection-store (discriminated union) с событиями.
- **Undo/redo групп**: `makeGroupsStates` хранит живые ссылки — хрупко; взять ID-based (как `makeSceneGroupData`) единообразно для истории и клипборда. Полной карты вызовов `saveState` нет.
- **Гизмо вращения**: геометрия колец (радиусы, сегменты, `updateRingsDirAndZoom`, масштаб от зума) не раскрыта — своё гизмо или `TransformControls` как база.
- **Raycast-детали**: сортировка/фильтрация/layers не разобраны.
- **Quick-панели**: состав кнопок/приоритеты — в `react.js`, не разобрано; контракт `{state, type?, quickPanel:{x,y}}` достаточен, UX — из скриншотов/фич-спеки.
- **Границы сцены**: `OBJECT_X/Z_MIN/MAX = ±Infinity` (клэмп — фактически no-op, см. `04-furniture-placement.md`) — свои лимиты задавать осознанно.
- **Тач-жесты**: long-press/двухпальцевые не покрыты.
- **`ProductTransform2D` привязан к пиксельной математике 2D-вьюера** — для нас: чистая screen-space overlay-система, формулы дословно не переносить.
- **`Creator.makeFromLoadedData`** (async-реинстанс при paste) не разобран — нужен свой фабричный слой.
- **`vectorsForMatMove`**: базис UV-сдвига по 3 точкам вывести самостоятельно.
