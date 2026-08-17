# 04 — Расстановка и манипуляции с мебелью (RoomToDo)

> **Что это.** Поведенческая спека расстановки и трансформации товаров/мебели в редакторе-конкуренте, вычитанная из не минифицированного `plannercore.js`. Своими словами, с ссылками на реальные имена классов/функций и номера строк как доказательство. Код не копируем.
>
> **Единицы.** Внутренние координаты и размеры — **сантиметры**. Экранные пороги — **пиксели**. Плоскость плана: `sceneObject.x` = мир X, `sceneObject.z` = мир Z (в 2D-снаппинге подаётся как `y`), `sceneObject.y` = высота/элевация.
>
> **Смежные секции.** Гизмо-выбор, quick-panels, группы и копипейст вынесены в `05-selection-transform-grouping.md`. Здесь — модель товара, драг из каталога, три режима перемещения, снаппинг мебели, привязка настенных элементов, стекинг. 3D-гизмо вращения и коалесинг undo при ресайзе описаны здесь, т.к. живут внутри `R2D.MIH` и `SceneObject`.

---

## 0. Модель товара (Data model)

### Иерархия SceneObject

Базовый класс `R2D.SceneObject` (**11230**) наследует `EventDispatcher`. Фабрика `R2D.Creator.makeSceneObject(productData, color)` (**18035**) по `productData.type` выбирает подкласс:

| type     | Класс                                                                                        | 3D-viewer (`ObjectViewer3D.make`, 31864)    |
| -------- | -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| MATERIAL | `R2D.SceneObjectMaterial` (11541) — **не** наследник SceneObject, только id/type/color       | `null` (материал не имеет своего меша)      |
| MODEL    | `R2D.SceneObjectModel` (11575)                                                               | `ObjectViewer3DModel`                       |
| POSTER   | `R2D.SceneObjectPoster` (12064) — но если пакет `.glb`, создаётся `SceneObjectModel` (18047) | `ObjectViewer3DPoster` или Model, если glTF |
| CARPET   | `R2D.SceneObjectCarpet` (11832)                                                              | `ObjectViewer3DCarpet`                      |

Три подкласса (`Model`/`Carpet`/`Poster`) вызывают `R2D.SceneObject.call(this, ...)` и добавляют слой материалов (рамка/дно, `setMaterialFrameData`/`setMaterialBottomData`) и геттер `forWall`.

### Поля размещённого товара (`SceneObject`, 11247–11282)

- **Позиция**: `x, y, z` (см). При создании умышленно ставятся в «спавн» `x=3000, y=-200, z=3000` (11247) — это флаг «ещё не сброшен на сцену»; при отпускании драга объект, оставшийся на спавне, удаляется как отменённый.
- **Вращение**: `rotationX/Y/Z` (градусы). Для мебели на полу значим только `rotationY`.
- **Масштаб**: `scaleX/Y/Z` (безразмерный множитель к `defaultWidth/Height/Depth`).
- **Отражение**: `flipX/Y/Z` (bool).
- **Параметрика**: `isParametric`, `updateParametric` — у параметрических товаров ресайз меняет геометрию, а не масштаб.
- **Прочее**: `visible`, `partialVisible`, `isLockedOnScene` (блокирует выбор/драг), `scaleDir` ("All"/"X"/"Y"/"Z" — направление ресайза для UV-перекладки), `isAddScaleChanged`, `needUpdateLogo`.

### Параметрический размер (Parametric size)

`get width()/height()/depth()` (**11343–11354**) = `default* × scale*`. Сеттеры (`setWidth/Height/Depth`, `setSize`, 11384–11444) переводят абсолютный размер в scale через деление на дефолт. Для параметрики (`isParametric`) сеттер не меняет UV/логику масштаба меша, а выставляет `updateParametric=true` (11386) — при следующем рендере `updateScaleParametric` → `R2D.Tool.ps.configurate(viewer)` (31547–31552) перестраивает геометрию.

### Границы значений (клэмпинг)

`checkValues()` (11288) при каждом `update()` проверяет координаты и высоту. Клэмп по X/Z фактически **no-op**: `OBJECT_X_MIN/MAX` и `OBJECT_Z_MIN/MAX` = `±Infinity` (11466–11471). Высота (11294–11300): `y < −3` → сброс в исходный `position.y`; `−3 ≤ y < 0` → `y = 0`; `y > 1000` → **сброс в исходную позицию** (не клэмп в 1000; сами константы 0/1000 верны). Масштаб корректируется так, чтобы линейный размер попадал в **`OBJECT_SIZE_MIN=1` … `OBJECT_SIZE_MAX=1000` см** (`__getCorrectScale`, 11478). Т.е. любой товар нельзя сделать меньше 1 см или больше 10 м по стороне.

### Footprint для снаппинга/бокса

`get2DRectPoints()` (**11489**) — 4 угла прямоугольника `w×d` вокруг центра. `get2DBounds` (11501) — AABB с учётом `rotationY`. Именно rotated-rect кормит и `SNAP.Box`, и снаппинг при драге.

---

## 1. Interaction (state machine)

`R2D.MouseInteractionHelper` (**41556**) — конечный автомат-EventDispatcher. Экземпляры состояний создаются один раз (**41925–41933**), стартовое — `stateMain` (41935). Три листенера (`leftMouseDownListener` 41938 / `…MoveListener` 41950 / `…UpListener` 41960 + touch-аналоги 41975) роутят событие в **текущее** состояние: `state.mouseDown/Move/Up(e)`. Пробел или `buttons==2` перехватывают ввод под панораму камеры.

Переходы — только через `changeState(state)` (**42050**): `old.stop()` → set → `new.start()` → рендер → событие `STATE_CHANGED` (`'MIHStateChanged'`, 43484) с `oldState`/`newState`. Особый случай (42066): выход из каталог-драга в `stateMain` шлёт `ESTIMATION_SEND` (пересчёт цены). `BaseState` (43487) — абстрактный с пустыми хендлерами.

| Состояние                                                       | Назначение                                              | start / stop                                                                                   | Выходы                                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **stateMain** (43532)                                           | Простой/хит-тест под выбор                              | —                                                                                              | клик по товару → `stateSelectedProduct`; по группе → `stateSelectedGroup`; по конструкции → `stateSelectedConstr`        |
| **stateSelectedProduct** (44583)                                | Товар выбран; хостит 3D-гизмо вращения, инициирует драг | start: сброс `downPos`/`downObjectData` (~44660); `isClicked=false` ставится в mouseUp (44981) | драг тела → `stateDraggingProduct`; Ctrl-клик другого товара → группа → `stateSelectedGroup`; клик пустоты → `stateMain` |
| **stateDraggingProduct** (43774)                                | Перемещение уже стоящего товара                         | start: `updateSnap2d`, гасит титулы/линейки, `.active` на canvas                               | mouseUp → `stateSelectedProduct`                                                                                         |
| **stateDraggingProdFromCatalog** (44260)                        | Размещение только что брошенного из каталога            | start: `view3DObject=null`, `updateSnap2d`, гасит титулы/линейки                               | mouseUp → `stateMain`                                                                                                    |
| **stateDraggingMaterial** (44160)                               | Перетаскивание свотча материала на поверхность          | гасит титулы/линейки                                                                           | drop → возврат в `prevState`                                                                                             |
| **stateSelectedGroup** / **stateDraggingGroup** (45320 / 45564) | Выбор/перемещение группы                                | как у товара                                                                                   | см. `05-*`                                                                                                               |
| **stateCreatingRuler** (43716)                                  | Расстановка точек линейки                               | `RULLER_ACTIVE`                                                                                | см. `07-*`                                                                                                               |

---

## 2. Placement — драг товара из каталога

Вход — `sceneObjectDragListener` (**41999**), срабатывает когда UI каталога бросает payload:

1. **MATERIAL** (42003): строит DOM-превью драга, запоминает `draggingMaterialId`, `changeState(stateDraggingMaterial)` — материал кладётся на поверхность, а не как объект.
2. **Товар (MODEL/POSTER/CARPET)** (42018): SceneObject уже пришёл в `event.data`; сразу `scene.add(sceneObj)` (42022) → находится соответствующий `view3DObject`; вспомогательной плоскости `_object3DMoving` выставляют Y в полувысоту товара (42034); `unsetActiveObject()`; `changeState(stateDraggingProdFromCatalog)` и `state.view3DObject = view3DObj` (42041).

### Вычисление точки сброса (в `moveProduct` → по типу)

- **POSTER или «smart-объект»** → `moveObjectSmart` (стекинг на поверхность, см. §5).
  - Тест «smart» (43940 / 44378): `max(w,h,d)/min(w,h,d) < 15 && volume < 30000`. Т.е. компактные некрупные объекты приклеиваются к поверхностям других предметов.
- **MODEL, не настенный** → `moveObjectSmartFromCatalog` (44502): NDC из курсора (`getMousePointForPicker`) → `Raycaster` по `constructorWalls`.
  - **Нет попадания в стену** → `setDefaultRotation` (ориентация по квадранту панорамы камеры, 44549) + фолбэк `moveObjectHorizontal` (сброс на плоскость пола).
  - **Попадание в стену** → точка + нормаль грани (повёрнутая на Y-rotation стены), сдвиг на полуразмеры (`shiftVectors`) чтобы стоять вплотную, `rotationY = radToDeg(atan2(normal.x, normal.z))` — лицом от стены.
- **Настенный элемент** → `moveObjectHorizontal` с привязкой к стене через `moveElement(pos, 20)`.

`moveObjectHorizontal` (**43952 / 44390**): рейкаст по невидимой горизонтальной плоскости `_object3DMoving` → мировая точка; применяется дельта относительно точки захвата: `position = intersection.point + oldPosition − pointIntersect` (43982), чтобы сохранить «зацеп» под курсором. Далее ветвление:

- настенный MODEL → `_constructor.moveElement(position, 20)` (снап к оси стены на 20 см; при смене найденной стены пересчитывает от чистой точки, 43991);
- обычный MODEL и `useSnap` → снап через `_snap2d.snapPolygon(...)` (см. §3);
- иначе — просто `x = position.x, z = position.y`.

`useSnap` (43935) = **Ctrl/Cmd НЕ зажат** (на Mac — `!metaKey`, иначе `!ctrlKey`). Т.е. зажатый Ctrl/Cmd **отключает** магнетизм.

### Финализация сброса — `stopDraggingProduct` (43864 / 44318)

- Настенный: `getObjectDataForWallElement` → `dropElement(dropData, 10)`; влез → `setDropDataToWallElement`; не влез → объект удаляется из сцены + `OBJECT_DRAG_OUT_OF_WALL`.
- Если объект остался на спавне `x==3000 && z==3000` (44349) — удаляется как отменённый сброс.
- `history.saveState()` + `HISTORY_UNDO_REDO`; переход в `stateSelectedProduct` (для стоящего) или `stateMain` (для каталог-драга).

### Параметрика при размещении

Флаг `isParametric` ставится при загрузке glTF (32697: `R2D.Tool.ps.isModelParametric`) или из сохранёнки (18104). Размещается/двигается так же; отличается только выбор под-меша: `setActiveMesh` (42189) объединяет все меши с одинаковым material-hash в `meshesContainer`, чтобы правка материала шла по всему коалесцированному набору.

---

## 3. Snapping & constraints (числовые пороги)

Движок `SNAP.Snap2D` (**9476**) — stateful, единицы **см**. Поля: `_distance` (порог), `_points` (углы стен), `_lines` (сегменты стен), `_boxes` (`SNAP.Box` — footprint других товаров/групп). Кандидаты пересобираются целиком на каждый драг в `updateSnap2d` (**41626**):

- стены `constructor.getLines()` → `GEOM.Line` + оба конца в `_points` (41633–41640);
- каждый **другой** MODEL → `new SNAP.Box(rotatedRectPoints, getHeight())` (41653); текущий/группируемый/каталог-драг объект исключаются (41645);
- группы → тоже `SNAP.Box` (41663);
- `updateDistance(15)` — **порог снаппинга 15 см** (41668; дефолт конструктора — 10, 9477).

### Алгоритм (`snapPolygon`, 10007)

Вход — footprint двигаемого товара (уже в «сырой» позиции) + аккумулятор `shift`. Возврат — вектор сдвига; вызывающий делает `x = position.x − shift.x`, `z = position.y − shift.y` (44015). Т.е. вектор указывает **от снапнутой позиции к сырой** — вычитание сажает объект на цель.

- **Стадия A** — снап к ближайшей стене `snapPolygonToNearestLine` (9742): проекция вершин footprint на линии; **side-test** `distanceBetweenPointAndLine < 0 → skip` (только «своя» сторона стены, не сквозь неё); отбрасывается если `minDist > 15` (9798). Если стена не снапнулась и не `linesOnly` — фолбэк `snapPolygonToBox` (снап угла к углу соседнего товара, 10013).
- **Стадия B** — перпендикулярный доснап `snapPolygonToNearestLineInOneDirection` (9807): движение ограничено направлением уже снапнутой стены; фильтр параллельности **0.2 рад (~11.5°)** отбрасывает стены, параллельные первой (9846). Итог — **угол комнаты защёлкивает по обеим стенам сразу**.

### Снап товар-к-товару (`snapPolygonToBox`, 9937)

Вершина footprint → ближайший угол чужого бокса, порог те же 15 см (9982). **Гейты соразмерности**: пропускаем бокс если `height/box.height > 5` (9966) **или** `area/box.area > 25` (9967) — крупное не липнет к сильно мелкому.

### Клиренс и «свободное место» (`findFreeSpace`, 10094)

Для 4 сторон footprint считает дистанцию до ближайшего препятствия — стены (`_lines`) **и** рёбра боксов других товаров (10113), `margin=1.5`. Это **измерительная** система (кормит линейки `_ruler3d.distances` → `page.setFreeSpace`, 41616), а **не жёсткий коллизионный блокер**: перекрытие объектов не запрещается, движок лишь показывает зазоры. `moveInFrontOfLines` (10038–10092) — камеро-зависимая корректировка (выталкивание объекта из-за видимых стен к камере), но это **dead code**: единственное вхождение по всей roomtodo-src — строка определения, вызовов нет; локальная `deltaAngle = π·0.2` (10046) внутри не используется, единственный рабочий угловой порог там — `π·0.4` (10068). В продукте поведение не проявляется.

| Порог                        | Значение              | Строка       | Смысл                                    |
| ---------------------------- | --------------------- | ------------ | ---------------------------------------- |
| `_snap2d` дистанция          | **15 см** (дефолт 10) | 41668 / 9477 | магнетизм к стене/боксу/точке            |
| Настенный `moveElement` снап | **20 см**             | 43989        | привязка настенного при драге            |
| `dropElement` радиус         | **10 см**             | 43890, 14038 | привязка к оси стены при сбросе          |
| Параллельность               | **0.2 рад**           | 9846         | отсев параллельных стен в перпенд.-снапе |
| Height-гейт бокса            | **5×**                | 9966         | не липнуть к сильно ниже                 |
| Area-гейт бокса              | **25×**               | 9967         | не липнуть к сильно меньше по площади    |
| `findFreeSpace` margin       | **1.5**               | 10096        | допуск пересечения при замере            |
| click-vs-drag                | **5 px**              | 43537        | выбор vs драг                            |
| start-drag                   | **≥1 px**             | 44959        | старт перемещения выбранного             |

---

## 4. Manipulation — перемещение, вращение, ресайз

### Перемещение (`stateDraggingProduct`, 43774)

Инициируется **из выбора**, не из mousedown: `stateSelectedProduct.mouseMove` при сдвиге `≥1px` (44959) уходит в драг. `startDraggingProduct` (43838) снимает `oldPosition`, снимает настенный объект с оси (`pickElement`), гасит контроллеры камеры. `moveProduct` (43922) ветвится:

- **Shift зажат** (и не настенный) → `moveObjectStraight` (44076): движение по доминирующей оси (сравнение |Δx| vs |Δz|, вторая координата фиксируется, 44119). Для POSTER — по X/Y.
- **POSTER / smart** → `moveObjectSmart` (стекинг, §5).
- **иначе** → `moveObjectHorizontal` с `useSnap = !Ctrl/!Cmd`.

`stopDraggingProduct` (43864): настенный — ре-дроп через `dropElement`; вернуть контроллеры; `createRings()` (пересбор гизмо); `stateSelectedProduct`; `history.saveState()`.

### Вращение — 3D-гизмо колец (`stateSelectedProduct`, только при `scene.isRotation3dActive`)

Три кольца `ringX/Y/Z` + `sphereRings` строит `createRings3D` (43264), радиус клэмпится `rMax=300` (44612).

- **mouseDown** (44665): рейкаст в плоскость активного кольца; ось из `object.name` (`planeX/Y/Z` → `curDir`); `startAngle = atan2(...)`; прячет прочие кольца; `START_ROTATING_OBJECT`.
- **mouseMove** (44770): `angle = atan2(...)`; `findAngles` (44621) даёт инкремент `dRot` с обработкой перехода через ±π; `object3d.rotateOnWorldAxis(axis, dRot)` (44801); в `rotationX/Y/Z` пишутся округлённые градусы; `ROTATING_OBJECT`.
- **hover** без драга (44853): подсветка кольца под курсором + позиция сферы.
- **mouseUp** (44987): фиксация, все кольца видимы, `STOP_ROTATING_OBJECT`, `SHOW_OBJECT_QUICK_PANEL`.

В 2D/плане поворот задаётся неявно: лицом к нормали стены при сбросе, либо `setDefaultRotation` по квадранту камеры.

### Ресайз / масштаб

Внутри самого MIH scale-гизмо нет, но **на канвасе (в 2D-плане) ресайз-хендлы ЕСТЬ** — отдельный оверлей `R2D.ProductTransform2D` (**77330**, вне MIH, управляется `ProductTransform2DHelper` 41430+; полная механика — в `05-selection-transform-grouping.md` §2): **4 рёберных грипа** R/B/L/T (`size=7` px — div, `var size = 7` в `R2D.ProductTransform2DButton` (77158/77163), inline `width/height` 77167–77169; второе определение с SVG-polygon и `size=10` (77215/77223) целиком лежит внутри блочного комментария `/*` 77214 … `*/` 77326 и не исполняется, `setSize` кнопки нигде не вызывается), односоставный ресайз от противоположного грипа, минимум **`minRealSize=2` см**, пишет `width/depth` в `sceneObject` (progress 41485, finish 41502). Показывается в 2D при **выключенном** fixed-size (`getIsFixedSizeEnabled()===false`, 41529/41541); для настенного MODEL — только L+R (ширина). Ресайз также доступен **числами** через поля quick-/right-panel, дёргающие `sceneObject.setWidth/Height/Depth` (11384) и `history.saveState('productSizes')`. **Коалесинг undo** (**12351**): `if (label !== 'productSizes' || currentState.label !== 'productSizes') statesUndo.push(currentState)` — подряд идущие ресайз-коммиты с одной меткой `'productSizes'` **сливаются в одну запись undo** (быстрые правки размера не засоряют историю). `keepRatio` фиксирует `scaleDir="All"` (пропорц.), иначе только по одной оси; параметрика ставит `updateParametric=true`.

### Элевация / изменение высоты

`setCurrentModelElevation(vElevation, isMouseDown)` (**42878**): `sceneObject.y = vElevation`, обновляет линейки, `saveState()` только на mouseUp (не на каждый тик). `changeCurrentModelElevation(val)` (42993) — инкремент `y += val`. Высота проверяется в `checkValues` (11294–11300): `<0` → 0, `>1000` → откат в исходную позицию.

---

## 5. Стекинг / элевация на других предметах (`moveObjectSmart`, 44036)

«Умное» перемещение кладёт объект **на поверхность** предмета под курсором:

- рейкаст по `interactiveObjects` → точка `iPoint` + нормаль грани `iNormal` (повёрнутая на `rotationY` предмета-хоста);
- `shiftVectors(vectorPoint, vectorNormal, boundsPoints)` смещает объект на его полуразмеры вдоль нормали → объект садится **на** поверхность (44052–44057), пишет `x,y,z`;
- **POSTER** дополнительно ориентируется лицом к нормали (`rotationY = radToDeg(atan2(n.x, n.z))`, 44061) и сохраняет отступ по Y относительно захвата;
- шлёт `OBJECT_SMART_MOVE {elevation: y}` (44073) — UI показывает текущую высоту.

Именно так реализованы «постер на стене/потолке» и «мелкий предмет на столе»: элевация выводится из точки удара по мешу-хосту, а не задаётся отдельно.

---

## 6. Настенные vs напольные элементы (`forWall`)

`forWall` (геттер в подклассах, 11597 / 11857 / 12089) = `productData.property.appointment == APPOINTMENT_WALL` ("wall" vs "scene", 11474). Настенные MODEL проецируются на ближайшую **ось стены**:

- `scene.add` (14033): если `forWall`, сразу `getObjectDataForWallElement` → `dropElement(dataForWall, radiusDropElement=10, sceneObject)` (14038) → `setDropDataToWallElement`.
- `me.dropElement(dataObj, snapDist=10, sceneObject)` (сигнатура **55172**, дефолт `snapDist=10` на **55174**): центр `(x, z)` ищет ближайшую ось `getAxis(center, snapDist)` (55338) — минимум `|distanceBetweenPointAndLine|` по всем `axes`, **отказ если `minDist > snapDist`** (55357, возвращает `null` = отвергнуто). При успехе — проекция центра на ось (`projectionPointOnLine`, 55181), `modelData.rotation = axis.angle` (55186), `depth = axis.depth`, регистрация в `axis.models`, пересборка врезок/стен/плинтусов. Возвращает `{x, y, rotation, depth}`.
  - **Поворот двери/окна — две разные формулы для драга и врезки, не путать.** Во время ДРАГА (`moveElement`) в снап-объект кладётся `rotation = Math.PI + ang`, где `ang = -atan2(dy, dx)` по точкам оси (55164, 55168) — явный `+π`. При финальной ВРЕЗКЕ (`dropElement`) пишется `modelData.rotation = axis.angle` (55186), без явного `+π`. Разворот при этом всё равно получается: для **внешней** стены `axis.angle` считается по свопнутому порядку точек (55395–55404), и своп сам даёт π. То есть в драге поворот берётся из явного `+π`, а в дропе тот же π приходит через своп точек оси — **не сводить обе ветки к «rotation = axis.angle»**.
- `setDropDataToWallElement` (14791): пишет `x, z`, `rotationY` (если `updateRotation`), `setDepth(dropData.depth + 1)` — толщина элемента подгоняется под толщину стены + 1 см.
- Снятие: `remove`/drag-start вызывает `pickElement(id)` (55241) — убирает модель с оси и пересобирает стену.
- Отдельная 2D-проекция на плане: для настенных и для товаров со `svgRealName` создаётся `ObjectViewer3DModelPlane` (32716).

Ковры (`CARPET`) и постеры (`POSTER`) — отдельные подклассы; постер по умолчанию идёт по smart-пути (лицом к нормали), ковёр — плоско на полу (в `moveObjectStraight` при Shift ведёт себя как MODEL, 44116).

---

## 7. Geometry rebuild (2D + 3D)

**3D**: `R2D.ObjectViewer3D` (**31519**) держит `THREE.Object3D` + бокс-меш из `default*` размеров. `setupObject3d` (31595): если параметрика — `updatePosition/Rotations/updateScaleParametric` (перегенерация геометрии через `R2D.Tool.ps.configurate`); иначе — `updatePosition/updateScales/updateRotations/updateUV`. `updateScales` (31540) кладёт `scaleX/Y/Z` в `object3d.scale`. `updateUV` (31564) для MODEL при изменённом масштабе перекладывает UV по `scaleDir` (тайлинг текстуры не растягивается вместе с мешем).

**2D**: план — та же 3D-сцена сверху; для настенных/SVG-товаров рисуется отдельный `ObjectViewer3DModelPlane` (32716), хранится в `view2d.getObjectsViewers3dPlanes()`. Footprint для снаппинга/боксов — `get2DRectPoints` (11489), пересобирается на каждый `updateSnap2d`.

**Триггер пересборки**: `sceneObject.update()` → `checkValues()` + `Event.UPDATE`; вьюер слушает и перерисовывает. `updateParametric` — единственный флаг, ведущий к перестройке **геометрии** (не только трансформа).

### 7.1 Параметрический ресайз каталожных моделей (`ParametricScaler`, 30138)

`R2D.Tool.ps` — это класс `ParametricScaler` (**30138**), который перестраивает геометрию каталожной модели (мебель/двери/окна) под `width/height/depth` **без искажения деталей**: ножки/рамки/фурнитура держат свои размеры, тянется только «тело». Вызывается из `configurate(objectViewer3D)` (**30163**) при каждом ресайзе параметрического товара (тот самый `R2D.Tool.ps.configurate`, упомянутый в §7 и §0). Кэширует эталон в `pool[productId]` и пропускает пересчёт, если `width/height/depth` не изменились (`prevParamsMap`, объявление 30159, сравнение 30178).

- **Разметка мешей.** Модель параметрична, если у **каждого** меша в `userData` есть `scale` и `fix` (`isModelParametric`, 30691). `userData.scale ∈ {no, horizontal, vertical, all}` — какие оси меша тянутся; `userData.fix ∈ {left, right, top, bottom, topLeft/…, axis, topAxis, bottomAxis, no}` — где у меша якорь-anchor (что остаётся на месте при растяжении). Разметка приходит из самой glTF (кладётся дизайнером модели), собирается в `configInfoModel` (30242).
- **Три оси через `params/modelSize`.** `scaleX/Y/Z = params.{width,height,depth} / modelSize.{...}` (30503) — общий множитель модели; `deltaX/Y` (30507) — абсолютный прирост по X/Y. Глубина (`z`) у всех вершин всегда домножается на `scaleZ` (тело просто масштабируется в глубину). Ширина/высота считаются **по-меш**: `newMeshWidth = params.width − dists.left − dists.right` → `scaleX = newMeshWidth / size.width` (30591), где `dists` — зазоры меша до габаритов модели (30296). Так растягивается только внутренняя часть, а поля до краёв сохраняются.
- **«Шовные точки» (`commonPoints`, 30147).** Перед первым ресайзом `ParametricScaler` находит вершины, **общие** для смежных мешей (`isPointAtPointsList`, метод 30790, вызов 30369), и раскладывает их по бакетам `topLeftArr/topRightArr/bottomLeftArr/bottomRightArr/topAxisArr/bottomAxisArr/axisArr/leftArr/rightArr` через `scaleFixMap` (30319, ключ = комбинация `outerFix → innerScale → innerFix`). Вершина, попавшая в бакет, при ресайзе сдвигается **жёстко на `±deltaX/2` / `+deltaY`** синхронно с соседом (30517–30588), а не масштабируется — поэтому шов между двумя деталями не расходится.
- **UV-коррекция (`updateModelUV`, 30817).** После пересборки позиций UV правятся на `ratioUV = 0.01` от прироста вершины (`p.A.u ± deltaA·ratioUV`, 31013–31027), чтобы текстура не тянулась вместе с растянутым мешем (аналог `updateUV` по `scaleDir` для непараметрических, но точечно по вершинам).
- **Санитайзеры.** `chekMeshesScale` (30206): если у меша `scale.x > 90` (артефакт экспорта в мм/см), масштаб «запекается» в геометрию и обнуляется до 1. Геометрия переводится в non-indexed (`toNonIndexed`, 30287), чтобы поштучно двигать вершины.

Именно `ParametricScaler` объясняет, откуда у мебели и модульной мебели «умный» ресайз: `scaleX/Y/Z` из §0 — это множитель для **непараметрических**; у параметрических те же поля лишь считают целевой `width/height/depth`, а форму строит `ParametricScaler` по разметке `scale`/`fix`.

---

## 8. Edge cases

- **Отменённый сброс**: объект, не сдвинувшийся со спавна `x=3000,z=3000`, удаляется на mouseUp (44349).
- **Настенный не влез**: `dropElement` вернул `null` (нет оси в радиусе 10 см) → объект убирается из сцены + `OBJECT_DRAG_OUT_OF_WALL` (43907).
- **Ctrl/Cmd при драге**: отключает `snapPolygon` (43935) — свободное позиционирование без магнетизма.
- **Shift при драге**: осевая блокировка (`moveObjectStraight`), но игнорируется для настенных (43926).
- **Заблокированные объекты**: `isLockedOnScene` / `partialVisible` защищены от выбора/драга по всему коду.
- **Клэмпинг размера**: сторона всегда в [1, 1000] см (`__getCorrectScale`); высота: `y<−3` → откат в исходный `y`, `−3≤y<0` → 0, `y>1000` → откат в исходную позицию (11294–11300); клэмп по X/Z — no-op (`±Infinity`, 11466–11471).
- **glTF-постер**: если пакет `.glb`, постер трактуется как MODEL (18047) со всей модельной логикой.
- **Коалесинг undo**: серия ресайзов = одна undo-запись (12351); но первый ресайз после иного действия создаёт новую запись.
- **Смена стены у настенного при драге**: если найденная ось сменила поворот, позиция пересчитывается от чистой точки удара, чтобы не «прилипнуть» к старой оси (43991).
- **Коллизии не блокируются**: два товара могут перекрываться; `findFreeSpace` только измеряет зазоры, не запрещает.

---

## 9. Confidence & gaps

**Высокая уверенность (прямо вычитано из кода):**

- Иерархия `SceneObject`/подклассы/фабрика/вьюеры и поля объекта (11230–12291, 18035, 31864) — читано напрямую.
- Три режима перемещения (`moveObjectHorizontal`/`Smart`/`Straight`) и их ветвление по типу/модификаторам (43922–44152) — читано напрямую.
- Пороги: снап 15 см (41668), настенный 20 см (43989), dropElement 10 см (55174), click-vs-drag 5 px (43537), start-drag ≥1 px (44959), гейты бокса 5×/25× (9966/9967), параллельность 0.2 рад (9846) — числа из кода.
- Проекция настенного на ось (`dropElement`/`getAxis`, 55172–55360) и `setDropDataToWallElement` (14791) — читано напрямую.
- Коалесинг undo по метке `productSizes` (12351) — читано напрямую.
- Смарт-стекинг по нормали грани (44036–44074) — читано напрямую.
- Грип 2D-ресайза = **7 px** (div, `var size = 7`, 77158/77163, inline width/height 77167–77169); второе определение `ProductTransform2DButton` (SVG-polygon, `size=10`, 77215/77223) закомментировано целиком (`/*` 77214 … `*/` 77326) и не исполняется; клэмп X/Z — no-op (`±Infinity`, 11466–11471), ветвление высоты в `checkValues` (11294–11300) — перепроверено по исходнику.

**Средняя уверенность (частично через суб-агентов / соседний контекст):**

- Детали 3D-гизмо вращения (`createRings3D`, `findAngles`, `rotateOnWorldAxis`, `rMax=300`) — по отчёту суб-агента + подтверждено якорями 43264/44621/44801; сам блок `findAngles` целиком не перечитан построчно.
- `moveObjectSmartFromCatalog` (44502) и `setDefaultRotation` по квадранту камеры — по отчёту суб-агента; не перечитано построчно лично.
- Ветка `snapPolygonToIntersectLine` (9578) существует в движке, но, судя по `snapPolygon`, **не на живом пути драга** — помечено как API-complete/dead в текущем флоу.

**Пробелы / не проверено:**

- Точная математика `shiftVectors` / `getVectorsSides` (полуразмеры вдоль нормали при стекинге) — **закрыто**: разобрана построчно в [`deep-dives/10-furniture-stacking.md`](deep-dives/10-furniture-stacking.md).
- `R2D.Tool.ps.configurate` — вскрыт в §7.1 (`ParametricScaler`, 30138): разметка `scale`/`fix`, шовные точки `commonPoints`, UV-коррекция `ratioUV`. Не разобрана построчно только математика `axis/topAxis`-веток с `dists.toOY` (30596–30684) — общий принцип (якорь + по-меш `scaleX`) ясен, точная формула симметрии относительно OY не перечитана.
- Копипейст/дублирование и групповые трансформации — вынесены в `05-selection-transform-grouping.md`, здесь не покрывались.
- Поведение `moveElement(pos, 20)` для настенных (внутренняя реализация в конструкторе) — вызов и радиус подтверждены, тело не перечитано.
- Сетка (grid snap) как отдельный механизм не найдена: снаппинг идёт к стенам/боксам/углам, а не к регулярной сетке — если grid есть, он не в `SNAP.Snap2D`.

**Чего не хватает для реализации:**

- **Picking-инфраструктура**: `_object3DMoving` (невидимая плоскость), `getMousePointForPicker`, `interactiveObjects`/`constructorWalls` не специфицированы. Для нас: `Raycaster` + `ray.intersectPlane` вместо меша-плоскости.
- **Коллизии**: у конкурента их нет (только `findFreeSpace`-зазоры); если нужны — проектировать с нуля (SAT по rotated-rect footprint из `get2DRectPoints`).
- **Touch-жесты**: пороги/поведение не разобраны (41975+).
- **Группы**: снап-исключение «текущий объект + его группа» (41645–41647) закладывать сразу; детали — в `05-selection-transform-grouping.md`.
- **Протокол DOM-драга из каталога** (payload, превью, drop-зона) не описан и по plannercore не восстанавливается.
- **Undo-гранулярность**: label-based merge подтверждён только для `'productSizes'`; полный список label'ов не собран.
- Закрыто deep-dive'ами (сюда не дублируем): математика стекинга `G.shiftVectors`/`getVectorsSides` и взаимодействие снапа с элевацией (переход smart↔horizontal, сброс y) → [`deep-dives/10-furniture-stacking.md`](deep-dives/10-furniture-stacking.md); модель осей стен (`WC.Axis`: point1/point2/depth/angle/models, `boxFromWalls`, пересборка врезок после `dropElement`) → [`deep-dives/07-wall-axes-pipeline.md`](deep-dives/07-wall-axes-pipeline.md).
