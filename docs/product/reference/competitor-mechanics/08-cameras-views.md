# 08 — Камеры и режимы просмотра (viewers)

> Реверс из `plannercore.js` (не минифицирован, 81 349 строк). Namespace: `R2D` (viewers, renderer, scene), `WC` (конструктор стен на Canvas-2D). Единицы мира — см; экранные пороги — px. Углы в state хранятся в **радианах**, но при сериализации переводятся в **градусы**. См. `00-overview.md`.

Ключевая архитектура: **один общий `THREE.WebGLRenderer`** (`R2D.sharedRenderer`, стр. 66) рисует **одну общую 3D-сцену** (`R2D.scene3d`, стр. 65). Три из четырёх viewer'ов — это просто **разные камеры-обёртки** над этим общим рендерером; переключение вида = смена того, какая обёртка последней вызвала `updateCamera3d`. Четвёртый (конструктор) — отдельный Canvas-2D редактор, к THREE не относится.

---

## 1. Четыре viewer'а (`R2D.Viewers`)

Регистрируются в фиксированном порядке `R2D.Viewers.add(...)` (стр. 202–205); индекс в массиве = идентичность вида. Дефолт при старте: `enableViewer(!isCurrDeviceAPhone ? 0 : 2)` (стр. 207) — **десктоп стартует с конструктора (0), телефон — с 3D (2)**.

| Idx   | Инстанс           | Класс / фабрика                                       | `getType()`     | Камера                           | useZoom / useToCenter |
| ----- | ----------------- | ----------------------------------------------------- | --------------- | -------------------------------- | --------------------- |
| **0** | `viewConstructor` | `WC.WallsEditor.init` (стр. 71; класс стр. 60521)     | `"constructor"` | Canvas-2D, без THREE             | true / true           |
| **1** | `view2d`          | `R2D.ViewerScene2D.init` (стр. 72; класс стр. 47216)  | `"2d"`          | `OrthographicCamera` top-down    | true / true           |
| **2** | `view3d`          | `new R2D.ViewerScene3D` (стр. 74; класс стр. 46157)   | `"3d"`          | `PerspectiveCamera` орбита       | true / true           |
| **3** | `viewWalk`        | `new R2D.ViewerSceneWalk` (стр. 76; класс стр. 47901) | `"walk"`        | `PerspectiveCamera` от 1-го лица | false / false         |

**Что чем управляет:**

- **Конструктор (0)** — редактор стен: рисование контуров, размеры, снап. Отдельный `<canvas id="canvasConstructor">` 1000×600 c `WC.context = getContext('2d')` (стр. 60601). Детали рисования/снапа — в `01-walls.md`; здесь важно лишь, что это **не** камера над `scene3d`, а самостоятельный 2D-редактор со своим дискретным зумом (`scaleVaues[]`, 41 шаг 0.05×…10.11×, центр индекс 20 = 1.0×, стр. 60571–60576).
- **2D-план (1)** — та же 3D-сцена сверху вниз через ортокамеру; только pan + zoom, орбиты нет (tilt залочен на `π/2`).
- **3D-орбита (2)** — перспективная орбита вокруг anchor'а.
- **Walk (3)** — от первого лица, высота глаз ~150 см.

**Публичная привязка** (стр. 612–658): `planner.view3d/view2d/viewWalk.activate()` → `enableViewer(2/1/3)`, `planner.constr.activate()` → `enableViewer(0)`; `.isActive()` = сравнение с `getCurrentViewer()`. `planner.zoomIn/zoomOut/toCenter` **особо кейсят 2D и конструктор** (дёргают напрямую `WC.wallsEditor` и `R2D.ViewerScene2D._instance`, минуя `clickOnButton`, стр. 631–656), иначе идут через `clickOnButton`.

### 1a. Базовый класс `R2D.Viewer` (стр. 16569)

Абстрактный шаблон на `EventDispatcher`. Конструктор `(type, data, scene, useZoom, useToCenter)`; хранит DTO `R2D.ViewerData(icon, domElement, hintKey)` (стр. 16562) — иконка левой панели, корневой `<div>`, i18n-ключ подсказки. **Все поведенческие методы в базе `console.error`-ят «must be overridden»** (`enable`/`disable`/`setSize`/`toCenter`/`makeScreenShot`/`getViewStateData`/`getCameraData`/…): логики в базе нет, всё в 4 подклассах. Константы: `CAMERA_POSITION_UPDATE = "cameraPositionUpdate"` (стр. 16751), `CAMERA_HEIGHT_RATIO=3`, `SCREENSHOT_W=1280`, `SCREENSHOT_H=720`.

---

## 2. Переключение видов и состояние камеры

### 2a. `enableViewer(i)` — сам свитч (стр. 16950)

1. Чистит инлайн-стили всех `.left_bar_btn`.
2. Если `viewer === currentViewer` → `viewer.reset(type)` и выход (повторный клик по активному виду просто ресетит его).
3. Иначе, если есть текущий: запоминает `prevViewerType = currentViewer.getType()`, зовёт `currentViewer.disable()`, снимает его DOM.
4. `currentViewer = viewer`.
5. `currentViewer.enable(prevViewerType)` — **передаётся строка типа** (`"2d"`/`"3d"`/…), не объект, несмотря на имя параметра `previousViewer`.
6. `setSize(w,h)`, добавляет DOM, диспатчит `Event.CHANGE`.

**Анимации/твина на свитче нет** — это немедленный teardown/rebuild (disable старого → снять DOM → enable нового → добавить DOM). Любая «плавность» — от восстановления камеры внутри `enable` конкретного viewer'а. **Edge/баг конкурента:** `getCurrentViewerName()` (стр. 16851) маппит только 3 имени и трактует walk как `viewConstructor` — не копировать.

### 2b. Что переносится между видами

- **Выделение** (в `enable` 2D, стр. 47433+): читает `savedCurrentSceneObject`/`savedCurrentGroup`, ре-резолвит объект/группу в новом viewer'е, ре-селектит, чистит сохранённые ссылки. То есть **выбранный продукт/группа переживают смену вида**.
- **Состояние камеры** через `getViewStateData()`/`setViewStateData(data)`.

### 2c. Сериализуемое состояние камеры — два формата

**Формат 1 — компактный `{state, camera:{px,py,pz,tilt,pan,zoom}}`** (для свитча вида и сохранения проекта под `scene.viewState`, стр. 13911). 3D-версия `getViewStateData` (стр. 46664–46679):

- `px/py/pz` = `anchor.x/y/z` (сырые единицы; несмотря на имя `p*`, это anchor, не позиция);
- `tilt` = `toDeg(tilt.current)` — **градусы**;
- `pan` = `toDeg(pan)` — **градусы**;
- `zoom` = `(distance.current − distance.min) / (distance.max − distance.min)` — **нормализованный 0..1**.

Restore `setViewStateData` (стр. 46680–46708) — точная инверсия: `toRad` для углов, `distance = (max−min)*zoom + min`. Отклоняет payload, у которого `state` не совпадает с типом viewer'а; на неактивном viewer'е просто запоминает данные до `enable()`. По видам: 2D → `{state:"2d", camera:{…, tilt:deg, pan:deg, zoom}}` (стр. 47672), walk → `{state:"walk", …, zoom:1}` (стр. 48268), конструктор — фикс-заглушка `{state:"2d", camera:{px:0,py:0,pz:0,tilt:90,pan:0,zoom:0.1}}`.

`R2D.Viewers.setViewState(data)` (стр. 16981) перебирает все viewer'ы, зовёт `setViewStateData`; **первый вернувший `true`** авто-активируется через `enableViewer(i)`. Так восстановление проекта выбирает нужный вид. **Edge:** и 2D, и конструктор рапортуют `state:"2d"` → конструктор (индекс 0) выигрывает цикл.

**Формат 2 — сырой полный `getCameraData()`** (стр. 46751): `{type:"perspective", fov, pan, tilt, distance, position, anchor, rotation, clipping}` (всё в радианах/сырое). Через него `R2D.Viewers.saveCameraData()` снапшотит все три сцен-viewer'а разом (`structuredClone`, стр. 17075–17079); `getSavedCameraData`/`clearSavedCameraData` (стр. 17072/17107) работают по view3d + viewWalk.

### 2d. Каноническая математика орбиты (`R2D.OrbitController`, стр. 27563)

Сферические→декартовы, `update()` (стр. 27613–27615):

```
position.y = anchor.y + distance * sin(tilt)
position.x = anchor.x + distance * cos(tilt) * sin(pan)
position.z = anchor.z + distance * cos(tilt) * cos(pan)
rotation.y =  pan ;  rotation.x = -tilt          // euler order 'YXZ'
```

`tilt` = вертикальный угол (elevation), `pan` = азимут. `setTilt` жёстко клампит в `[minTilt,maxTilt]`; `setDistance` — `min(max(dist,min),max)`. **`setPan` НЕ клампит и не заворачивает** (стр. 27599) — азимут копится неограниченно. Инверсия `updatePositionChange` (стр. 27622) — пересчёт anchor'а из фиксированной позиции (для вертикальных перемещений). **Инерции/демпфинга нигде нет** — маппинг дельт 1:1.

> ⚠️ В файле есть второй, легаси-класс `R2D.CameraOrbitController` (стр. 27722) со своими лимитами (`distanceMin=500`, `distanceMax=2000`, шаг зума `0.05`, right-drag pan — заглушка `TODO`). Живые viewer'ы его **не используют** — они держат `OrbitController` внутри своей рендер-обёртки. Копировать нужно живой путь (см. ниже), не легаси.

### 2e. Живые сенситивности и лимиты (перспектива, стр. 36945–36948)

```
sensitivePan  = 0.01   // рад на px горизонтального драга
sensitiveTilt = 0.01   // рад на px вертикального драга
sensitiveZoom = 0.005  // десктоп-колесо
sensitiveMobileZoom = 0.001  // iOS/Android
```

Ортографическая обёртка (2D) использует другой `sensitiveZoom = 0.05` (стр. 37581). Убедиться, какой viewer зеркалишь.

- **`cameraRotate(dx,dy)`** (стр. 37277): `pan -= dx*0.01; tilt += dy*0.01`. Если `tilt<0 && lookUp` — поднимает anchor.y до `cameraMinHeight + distance*sin(-tilt)` (чтобы камера «смотрела снизу вверх», удерживая горизонт).
- **`cameraMove(dx,dy)`** (стр. 37292): pan-relative трансляция anchor'а в плоскости XZ; чувствительность `getSensitiveMove() = max(distance/1200, 0.1)` (стр. 37041) — pan быстрее при отдалении. anchor.y не меняется (pan только горизонтальный).
- **`cameraMoveY(dy)`** — двигает камеру по Y напрямую, back-solve anchor'а.

### 2f. Зум — дискретная таблица, не линейный шаг (стр. 37208–37234)

Живой `cameraZoom(delta)` шагает по фикс-таблице `scaleValues[]` (41 неравномерная запись 1.0→0.0, гуще у 0, стр. 36961), `scalePointer` стартует с 20 (→ curZoom 0.1). Колесо-in: `scalePointer--` (min 0 → ближайший), колесо-out: `scalePointer++` (max 40 → максимально далеко); `distance = minDistance + distInterval*curZoom`. `percentageOfZoom` ±5 за шаг, 0..200. Есть анимированный `cameraZoomSmooth(delta, animTime=200мс)` (стр. 37180) на `setInterval` 60fps — **единственная анимация движения камеры; орбита/pan не анимируются**. Плюс `zoomToMax`/`zoomToMin`/`zoomToOptimal(box3)`.

### 2g. События камеры

- **`CAMERA_MOVE = "cameraMove"`** — константа и на `planner.constr` (стр. 697), и на `planner.scene` (стр. 775). Диспатчится мышиным контроллером на move: `apiDispatcher.dispatchEvent(new Event(CAMERA_MOVE, {x: dx, y: dy}))` (стр. 41779); прямой инлайн-вызов `currentViewer.cameraMove` **закомментирован** (стр. 41778) — pan идёт через шину событий. Аналогично `WHEEL_ZOOM` (стр. 41784).
- **`Renderer3D*.CAMERA_POSITION_UDPATE = "cameraPositionUpdate"`** (опечатка «UDPATE» в оригинале; стр. 37558 перспектива, 37856 орто). Диспатчится из `orbitControllerUpdateEventHandler` на каждый апдейт орбиты; тот же хендлер выравнивает горизонт фонового градиента, проецируя дальнюю точку в экран.
- Viewer-уровень 3D дополнительно шлёт API-события `CAMERA_ROTATE {degrees, position}` (стр. 46564), `UPDATE_ZOOM_INPUT` + `CAMERA_ZOOM {position}` (стр. 46612).

### 2h. `setSize(w,h)` — параметры игнорируются (стр. 17005)

Пересчитывает `width = window.innerWidth − getOffsetWidthDueToOpenedPanels()`, `height = window.innerHeight`. Оффсет = `(dynamicPanel? 310/190 : 0) + (categoryTree? width : 0) + (controlPanel? 40 : 0)` (стр. 16843). При `isRenderMakeActive` клампит в 16:9-леттербокс. Триггерится на resize окна (стр. 239). Панели (dynamic/categoryTree/control) влияют на макет только через этот оффсет; сам менеджер их DOM не рисует.

---

## 3. 3D-орбита (`R2D.ViewerScene3D`, стр. 46157)

- **Камера** (стр. 46185): `new THREE.PerspectiveCamera(40, 800/600, 5.0, 40000.0)` → **fov 40°, near 5, far 40000**. Обёртка `Renderer3DPerspective(sharedRenderer, camera3d, scene3d)` (стр. 46186). `getCameraFOV`/`setCameraFOV`, `setCameraFOVDefault()`=40 (стр. 46833–46841).
- **Каноническое `cameraState`** (стр. 46248–46266): `anchor {x:0, y:110, z:0, default:110}` (110 = мин-высота look-target), `distance {min:10, max:30000, current:3000}`, `tilt {min:-0.8, max:1.57, current:1.25}` рад (≈ −45.8°…+89.95°, старт 71.6°, смотрит вниз), `pan:0`. Бэйндится в orbitController на `enable()` через `setCameraDistanceBounds/TiltBounds` — это **runtime-лимиты, перекрывающие дефолты OrbitController**.
- **`enable(prev)`** (стр. 46377): восстанавливает выделение, бэйндит helpers на `camera3d`, `renderer.enable()` + `setupRendererData()`, применяет bounds, `setCameraMinHeight(110)`, `setCameraLookUp(true)`, `updateCameraViewPosition(...)` — **восстанавливает камеру из `cameraState`**, синхронит конструкторскую камеру, вешает слушатели (scene UPDATE, `CAMERA_POSITION_UDPATE`, 4× SceneHistory UNDO/REDO), lights → `modeMain()`. `disable()` — зеркальный teardown. `reset()` = disable+enable.
- **`toCenter()`** (стр. 46640): по `getSceneBox3()`; пустая сцена → anchor `(0,110,0)`; иначе `updateCameraViewPosition(center.x, 110, center.z, distance.max, π/4, π/4)` (**изометрия 45°/45° на макс-дистанции**) + `zoomToOptimal(box3)`. `findOptimalCamDist(w,h,d)` (стр. 37424) фитит бокс по fov/aspect; замечен множитель `height*2` (Y трактуется с 2× — деталь неразрешена).
- **Экстра:** авто-вращение `startAutoRotation(speed=0.002)` (стр. 47150, `setInterval` 60fps, инкремент pan); `cameraJump(params)` (стр. 37443) — анимация anchor/distance/pan/tilt с `easeInOutCubic`, `animTime=1000мс`, 60fps, shortest-arc; режим «модель как anchor» (`modelAsAnchorParams {minDist:20,maxDist:500,step:20}`, стр. 37507) с гардом `camY>0`.
- **Скриншот** `makeScreenShot(prev)` (стр. 46718): `prev` → `ProjectPreviewSize` + SSAO off (превью), иначе **1280×720**; `sharedRenderer.render()` → `canvas.toDataURL("image/jpeg")` → восстановление размера/SSAO. `makeRenderScreenShot()` (стр. 46709) — без ресайза, текущий вьюпорт. PDF-метода у 3D нет (он на 2D).

### 3a. Сечение / clipping-плоскость (3D + walk)

Поля (стр. 47078): `defaultDist=20`, `distFromCameraToPlane=defaultDist`. `onClipping()` (стр. 47082) создаёт `new THREE.Plane(...)`, ставит `webGLRenderer.clippingPlanes=[plane]`; `offClipping()` (стр. 47089) — `[]`. `updateClipPlane()` (стр. 47111): нормаль = нормализованное `anchor − position`, `constant` размещает сечение на `distFromCameraToPlane` перед камерой вдоль взгляда. Все clip-операции отключены при `renderMakeType=='topView'`. Vertical-angle API: `getCameraVerAngle()` = `radToDeg(renderer.getCameraTilt())` (стр. 46849), `setCameraVerAngleRad(rad)` → `updateCameraTiltRenderMake` (стр. 46851). Клиппинг-дистанция берётся из viewWalk при `viewMode=='viewWalk'`, иначе из view3d (стр. 1001–1003).

---

## 4. 2D-план (`R2D.ViewerScene2D`, стр. 47216)

- **Камера** (стр. 47231): `new THREE.OrthographicCamera(-400, 400, -300, 300, 1, 1300)` (near 1, far 1300) через `Renderer3DOrthographic(sharedRenderer, camera2d)` (класс стр. 37562). **Смотрит строго вниз**: `cameraState.tilt = π/2` и tilt залочен `setCameraTiltBounds(tilt,tilt)`; `distance = 1200` тоже залочена. Орбиты нет — только pan (anchor XZ) + zoom.
- **Проекция от зума** (стр. 37612): видимая область = `sharedRenderer.width/height * (1 − cameraZoomCurrent)` — зум масштабирует объём ортофрустума, не дистанцию.
- **Zoom-лимиты (авторитетно)**: `cameraState.zoom = {min:-20.0, max:1.0, current:0}` (стр. 47272). Дискретно: указатель в 41-элементной таблице `scaleVaues` (`-19…0…0.9`, стр. 37565), `scalePointer` старт 20 (значение 0). `cameraZoom(delta)` шагает указатель ±1, клампит, `percentageOfZoom` ±5 в [0,200]. `zoomToOptimal(box3)`: `scale = max(sizeX/rendererW, sizeZ/rendererH)`, указатель = `1 − scale`.
- **Pan**: right-drag ИЛИ Space+left-drag = pan (left-drag = rotate, но здесь no-op из-за лока tilt). `renderer.cameraMove(dx,dy)` (стр. 37760) в мир через `pan` и `getSensitiveMove() = (1−r)*20` (быстрее при отдалении). Клавиатура: стрелки/WASD → `cameraMove(±5,0)/(0,±5)`, шаг `moveNum=5`, ×5 с Shift.
- **`toCenter()`** (стр. 47647): центрирует anchor по `getSceneBox3()` + `zoomToOptimal`.
- **`enable`** (стр. 47422): `useContourFilter=true` (контурный «планный» вид), прячет плинтусы, дашед-контур на террейн, lights → `modeUniform()` (плоский свет), показывает `view2DObjects`-плоскости / прячет их 3D-виды. `disable()` — реверс.
- **Скриншоты/PDF**: `makeScreenShot(prev)` (стр. 47717) — превью в `ProjectPreviewSize`, иначе 1280×720. **`makeScreenShotForPDF(w,h,q,showTerText)`** (стр. 47747): опц. снимает текстуру террейна, `toCenter()`, размер `width*q × height*q` (q = множитель качества/DPI), `setCameraBounds(w,h)` (мировой фрустум в см → план в реальном масштабе), JPEG. Так делается масштабный план для PDF.
- Синглтон: `_instance` (стр. 47891), `init(...)` (стр. 47893). `getUseRulers()` = true; собственной сетки 2D-viewer не рисует — переиспользует рулетки/сетку конструктора.

---

## 5. Walkthrough (`R2D.ViewerSceneWalk`, стр. 47901)

- **Камера** (стр. 47912): `new THREE.PerspectiveCamera(60, 800/600, 5.0, 6000.0)` → **fov 60°, near 5.0, far 6000.0** через `Renderer3DPerspective`. FOV-пресеты Ctrl/Cmd+Alt+F циклят `[60,70,80,90,100]` (стр. 48586); `setCameraFOVDefault()`=60.
- **Высота глаз = 150 см**: `cameraState.anchor {y:150, default:150}` (стр. 47977), `renderer.setCameraMinHeight(150)` (стр. 48067), `cameraMinHeightResetToDef()`→150. **От первого лица, не орбита**: `distance {min:1, max:1, current:1}` (стр. 47984) — камера сидит ~1 ед. от anchor'а на высоте глаз, pan/tilt крутят взгляд на месте. `tilt {min:-1, max:1.45}` рад (≈ −57°…+83°).
- **Обзор (mouse-look)**: left-drag → `ROTATE` → `cameraRotate(dx,dy)`, сенситивность 0.01/0.01. Курсор прячется на драге (`hideCursor()`/`showCursor()`, стр. 48126) — **Pointer Lock API не используется**, обычный драг.
- **Движение — click-to-walk («jump»), не зажатый WASD**: left-click (mouseUp в пределах `maxMoveDist`) рейкастит сцену; при попадании → `cameraJump(point.x, point.z)`. **`cameraJump(x,y)`** (стр. 48215): анимация anchor'а `animTime=500мс`, `stepsNum=100`, easing `sin(t·π/2)`; идёт лишь на **80%** пути (`*0.8`), игнорит прыжки < `minDist=40`, кап одного прыжка **±500** ед./ось. WASD/стрелки тоже панят anchor: `cameraMove(±5,0)/(0,±5)`, `getSensitiveMove()` при `distance≈1` упирается в пол **0.1**. Колесо репрупозировано в **dolly вперёд/назад**: `cameraMove(0, ∓30)` (стр. 48200) — 30 ед. фор/афт, не FOV.
- **`enable`** (стр. 48052): чистит выделение, бэйндит helpers, `renderer.enable()`, ставит камеру на высоту глаз, `setCameraMinHeight`, `setCameraFOVDefault()`=60, `checkSkybox()`, `showCursor()`, lights → `modeMain()`. **Без pointer-lock.** Старт anchor `(0,150,0)`, если не восстановлен из `setViewStateData` (стр. 48281); Y намеренно НЕ восстанавливается (стр. 48285 закомм.) — высота глаз фиксирована.
- **Скриншот** `makeScreenShot(prev)` (стр. 48306): размер из `getRenderFrameData().frameWidth/Height`; превью → **265×150** + SSAO off.

### ⚠️ 5a. Коллизия со стенами — ОТСУТСТВУЕТ в этом файле

В коде движения **нет проверки коллизий/рейкаст-буфера со стенами**. `cameraMove` (стр. 37292) и `cameraJump` (стр. 48215) свободно ставят anchor; ни радиуса, ни теста стен. Grep по `collision|collide|wall`-радиусу в движении — пусто. Единственные пространственные гарды: высота глаз залочена на 150 (`cameraMinHeight`), кламп tilt, и кап прыжка (±500) / мин-хоп (40). Движение — фактически free-fly на фикс-высоте: **сквозь стены пройти можно**. Модель click-to-jump смягчает это на практике (цели — видимые поверхности), но это не коллизия. Clipping-плоскость (`onClipping`, стр. 48637, `defaultDist=20`) — рендер-клип для «просвечивания», **не** коллизия движения. **Если нужно «нельзя сквозь стены» — конкурент этого здесь не делает** (любая коллизия жила бы в отдельном бандле — не подключён).

---

## 6. 360 / панорамы / туры

**Это фоновый скайбокс-сфера, а не клиентский 360-захват и не тур.** `CubeCamera`/`WebGLCubeRenderTarget`/`equirect`/`cubemap`/`render360`/`makePano` во всём файле **отсутствуют** (grep по всем 81k строк).

- **Скайбокс** (`R2D.Scene`, стр. 14461): `THREE.SphereGeometry(6000, 60, 40)` + `.scale(-1,-1,1)` (нормали внутрь), `MeshBasicMaterial`, `Mesh`. Следует за камерой: `repositionSkybox()` = `skyboxMesh.position.set(cameraPos)` (стр. 14480) — читается как бесконечный фон. Эквиректангулярная проекция достигается **геометрически** (камера внутри вывернутой сферы), а не через `texture.mapping`.
- **Материал панорамы** — из каталога, тип `'pano'`: `R2D.PoolMaterials.create(skyboxId, '', 'pano')` (стр. 14515) → `matViewer.type = "skybox"` → `skyboxMesh.material`. Внутри `PoolMaterials.create` → `new R2D.ObjectViewer3DMaterial(id, '', 'pano')` (стр. 36205 / 32115); `'pano'` доходит до `loadProductData(id, 'pano')` и его единственный эффект — добавить **`&category_tag=skybox`** к URL каталога (стр. 22979, 47934). Спец-обработки `'pano'` в switch материала нет (стр. 32253 — только GLOSS/METAL env-map); эквирект-mapping не выставляется. Ротация: `setSkyboxRotation(r)` → `skyboxMesh.rotation.y = r·π/180` (стр. 14548).
- **Персистенс**: `scene.skybox = {id, r, tags}` (стр. 13081, 13911), id пушится в construction resource list; restore `setSkyboxMat(id)` + `setSkyboxRotation(r)` (стр. 12825). Дефолт `getDefaultPanoId()` (стр. 14766). `checkSkybox` (стр. 14588) тогглит видимость по типу viewer/render-make (скрыт в topView, показан в exterior/walk). `R2D.panorams` (стр. 82) заполняется извне через `planner.setPanorams` (стр. 670).
- **«Точки захвата панорамы» = render-make пресеты, а не тур-граф**: `renderMakeType ∈ {'exterior','interior','topView','walk'}` (стр. 46191). Каждый вид хранит `savedPanoData[renderMakeType] = {id, rotation, previewImgSrc}` (стр. 46791–46799); interior — отдельно в walk (`savedInteriorPanoData`, стр. 48355). Бандлятся с сохранённой камерой: `saveExteriorData(cameraData, panoData)` (стр. 46773), `saveTopViewData`, `saveInteriorData` (стр. 48353). Фасад: `Viewers.savePanoData`/`getSavedPanoData`/`clearSavedPanoData` (стр. 17097). То есть «360-вид» = выбор скайбокса под режим захвата; сама эквирект-картинка — **готовый ассет из каталога**; экспорт 360 полагался бы на `makeScreenShot` по точке, не на in-browser стичинг.

---

## 7. Слои рендера и render-on-demand

### 7a. `R2D.Scene3D` — трёхслойная сцена (стр. 36417)

**Три отдельных `THREE.Scene` (НЕ Group'ы)** (стр. 36419): `sceneBottom` (`"bottom"`), `sceneMiddle` (`"middle"`, дефолт), `sceneTop` (`"top"`). Константы стр. 36579–36581. Резолв `getScene(target)` (стр. 36432): `undefined`/`null`/`MIDDLE` → middle; неизвестный target → `console.error` + middle. `add(object, target)` → `getScene(target).add(object)`. Свет разнесён (стр. 36569): bottom = `lights.getBottom()`, middle = `getMiddle()` + `getLightsFromModels()`. Интент (по debug-боксам и порядку): BOTTOM = фон/земля, MIDDLE = основная геометрия, TOP = оверлеи/гизмо/рулетки. Пикинг: общий `raycaster` (стр. 36430), хелперы `objectUnderCursor`/`circlesUnderCursor` (ринги-гизмо)/`intersectWithObject`; `cameraChanged(...)` форвардит в `lights` (свет следит за камерой).

> **Confidence:** какой именно слой держит стены/пол vs продукты — инференс (свет + debug + порядок рендера). Продуктовая/комнатная геометрия добавляется через контейнеры `CommonSceneObject`/`view2DObjects`, рендерящиеся отдельно (см. ниже), а не явным `scene3d.add(..., MIDDLE)` в прочитанном диапазоне.

### 7b. `R2D.Renderer3D` — общий WebGL + слоёный пайплайн (стр. 36584)

**Один общий инстанс** `R2D.sharedRenderer` (стр. 66), передаётся во все viewer'ы (стр. 72/74/76). Настройка `WebGLRenderer` (стр. 36591): `logarithmicDepthBuffer: !phone`, `antialias:true`, `alpha:true`; `shadowMap.enabled=true`; post: **`autoClear=false`** (критично для мульти-пасса), `setClearColor(0xffffff)`, `setPixelRatio(devicePixelRatio)`, `maxAnisotropy = getMaxAnisotropy()` (стр. 36850). Тонмаппинг/output-encoding в конструкторе не выставляются (дефолты THREE или где-то ещё — gap).

**Порядок `render(useFilter, useBackground, updateFilter=true)`** (стр. 36629), с `clearDepth()` между пассами (т.к. `autoClear=false`), чтобы оверлеи рисовались поверх независимо от мирового Z:

1. `renderer.clear()`;
2. если `useBackground` → `filterBackground.render()` (градиент/фон);
3. `render(scene3d.bottom, camera3d)` — **BOTTOM**;
4. `render(scene3d.middle, camera3d)` — **MIDDLE** (общий depth с bottom, без clearDepth между 3 и 4);
5. `clearDepth()`;
6. опц. контур-пасс (`filterContours.render()`, прячет плоскости/террейн);
7. `clearDepth()`;
8. `render(view2DObjects, camera3d)` — 2D-план-оверлей (`commonSceneObject.view2DObjects`), затем `clearDepth()`;
9. selection-outline пасс (`filterSelect`) для currentGroup / currentMesh / currentView3DObject — на очищенном depth, поверх; каждый кейс завершается `clearDepth()`;
10. `render(scene3d.top, camera3d)` — **TOP** (гизмо/рулетки/оверлеи), всегда последним, финальный `clearDepth()`.

Итоговый порядок краски: background → bottom → middle → (contours) → view2DObjects → selection → top.

**Обёртки над общим рендерером**: обе (`Renderer3DPerspective` стр. 36939, `Renderer3DOrthographic` стр. 37562) держат свою камеру, но ставят её через `sharedRenderer.updateCamera3d(camera3d)` — и общий 3-слойный пайплайн отрабатывает идентично; отличается только проекция (перспектива 3D vs орто top-down). Переключение вида = смена того, чья обёртка последней вызвала `updateCamera3d`. `Renderer3DMouseController` (стр. 37860) — тонкий адаптер: `MouseController` → по `event.data.type` вызывает `cameraRotate`/`cameraMove`/`cameraZoom` (generic над обеими обёртками), пикингом сам не занимается.

### 7c. `R2D.RenderUpdater` — рендер по требованию (стр. 10202)

Экономия батареи/GPU — фикс бюджет кадров, без непрерывного RAF-лупа:

- дефолт **`frames = 5`** (стр. 10203), `frame` считает вниз;
- `needsUpdate()` (стр. 10231): любое взаимодействие «доливает» бюджет до N кадров; если луп не идёт — стартует `update()`;
- `update()` (стр. 10209): при `frame<=0` → `onFinish()` и **СТОП** (RAF не перепланируется); иначе `frame--`, `onProgress()`, `requestAnimationFrame(update)`. **Луп самозавершается через N кадров бездействия.**

**Десктоп vs мобайл** (стр. 36610–36613): `new RenderUpdater()` → десктоп **5 кадров**; `if (!R2D.config.isDesktop) updater.setFrames(2)` → мобайл **2 кадра**; там же SSAO off на мобайле. Гейт — `R2D.config.isDesktop` (не `isCurrDeviceAPhone`, который лишь выбирает дефолт-вид и ширину панели 310/190).

Wiring (стр. 36859): `onProgress = () => render(false, true)` — промежуточные кадры **без** дорогого фильтр/select-пасса; `onFinish = () => render(true, true)` — финальный кадр **с** фильтрами (SSAO/outline). Суть трюка: дешёвые кадры в движении, один качественный при остановке. `scope.update()` = `updater.needsUpdate()`; дёргается на `setSize` и на каждом scene-update viewer'а.

---

## 8. Оверлеи поверх сцены (свет и подписи комнат)

Два вспомогательных «вьюера» рисуют не камеру, а контент **в общей `scene3d`** и живут рядом с 3D-видом. Оба привязаны к `cameraState` view3d.

### 8a. Пользовательский свет в моделях-светильниках (`LightViewer3D`, стр. 48921)

Отдельный источник света **внутри модели-светильника**, которым управляет пользователь (вкл/выкл, цвет, яркость). Один инстанс на sceneObject-лампу; общий пул/лимит — статические поля класса.

- **Источник данных — ZIP модели.** `getDataFromPool()` (стр. 49163): фетчит `sceneObject.metaZipSrc`, `JSZip.loadAsync`, читает **`light.json`**, парсит и кэширует по `productId` в статический `LightViewer3D.pool` (`Map`). Повторное включение той же модели данные не перекачивает.
- **Три типа ламп** (`createLightWrap`, стр. 49202): `"Spot"` → `THREE.SpotLight` (угол `data.size/2`, penumbra=blend, `shadow.camera.far=5000`, bias −0.0001), `"Point"` → `THREE.PointLight` (bias −0.005), `"Area"` → `THREE.RectAreaLight` (ширина/высота из данных, во вложенном `Object3D`). Все кладутся в `wrap3d`, добавляются в сцену через `getLights().addLightToModelsLights(wrap3d)` (стр. 49300) — это тот же контейнер `getLightsFromModels()`, что рендерится в MIDDLE-слой (см. §7a). Оси лампы конвертируются `pos.set(x, z, -y)`, кватернион `(x, z, -y, w)` — та же remap-конвенция, что у рулеток/сериализации.
- **Лимит 9 источников на сцену.** `canLightOn()` (стр. 49147): обходит `getLightsObject3d()`, считает существующие Spot/Point/RectArea и **отклоняет включение**, если `count + lightData.length > LightViewer3D.maxLightCount (=9)`. `switchLight()` (стр. 49106) → `lightOn`/`lightOff` возвращают bool успеха.
- **UI цвета/яркости** (стр. 49381–49461): `setLightColor(hex)` красит все под-источники и обновляет эмиссию; `setLightPower(value)`/`getLightPower()` работают в **интерфейсной шкале 0–100** и мапят в физ. мощность по коэффициентам per-type — `blendPower = value/100 * 100`, затем `child[prop] = blendPower / coef`, где `coef`: **Spot 50, Point 20, Area 5** (`prop`=`power` у Spot/Point, `intensity` у RectArea; стр. 48922–48924). Ввод санитайзится (`,`→`.`, клип в 100).
- **Состояние сохраняется в `sceneObject.lightInfo`** (`getDataForSaving`, стр. 49194): `{isEnabled, color, power}` — пишется на каждый on/off/цвет/яркость. (Это то же `lightInfo`, что SceneHistory копит в снапшот, см. `09-undo-redo-history.md` §2.2.)
- **Глобальный тумблер теней.** Статический `LightViewer3D.isShadowEnabled` + `updateShadow()` (стр. 49039): при **любом** живом источнике включает `castShadow` на стенах и `receiveShadow` на продуктах разом; при нуле источников — выключает всё. Тени — свойство сцены целиком, не отдельной лампы.
- **Эмиссия «стекла лампы» + подмена стекла.** Материал с именем `ServiceNames.LAMP` при включённом свете получает `emissionInfo = {color: material.current, power: lightInfo.power * emissionCoef(=0.1)}` и `addMaterial = transpGlassMatId` — id прозрачного стекла зависит от хоста (`dev.roomtodo.com`→`32766`, `roomtodo.com`→`41838`; стр. 48927). Так «плафон» светится и становится прозрачным. `updateLampEmission()` (стр. 49345) синхронит `current`-цвет лампового материала с цветом света (hex) и дёргает `sceneObject.update()`. `makeLightsInfoForRender(products)` (стр. 48938) собирает финальный `lightInfo`-массив для рендера и попутно проставляет эту эмиссию по всем моделям с лампой.
- **Скейл лампы** (`update`, стр. 49304): позиции под-источников умножаются на `scaleX/Y/Z` sceneObject'а (RectArea пересчитывает width/height), чтобы свет ехал вместе с масштабированной моделью.

### 8b. Подписи комнат-плашки (`CoversTitleViewer3D`, стр. 48695)

Название комнаты + площадь как **billboard-плашка на полу**, видимая **только в 3D-режиме** (в 2D/конструкторе подписи рисует DOM-оверлей `R2D.TitlesTool`, см. `07-measurements-rulers.md` §B). Контейнер — `commonSceneObject.coversTitleObjects`.

- **Данные из конструктора** (`updateTitlesData`, стр. 48858): `scene.getConstructor().covers.map(...)` → на каждый cover `{title: cover.title, area: DimensionSystem.squareToString(cover.area), textLineArr}`. Текст берётся из `cover.title.text`, чистится от html-тегов (`<br>/<p>/<strong>/…`), бьётся на строки. Ковры без `title` отфильтровываются.
- **Текстура через offscreen-canvas** (`createPlaneTexture`, стр. 48784): рисует название (шрифт `loadedFont`, обводка белым по чёрному тексту для читаемости на любом полу) и площадь отдельной строкой мельче; чёткость через множитель `k=5`. Раздельные флаги видимости `title.visible.view3d` (название) и `title.areaVisible.view3d` (площадь). Шрифт `Roboto-Regular.ttf` грузится `FontFace` в конструкторе.
- **Плашка = `PlaneGeometry(100×100)`**, повёрнута `rotateX(-π/2)` (лежит на полу), `MeshBasicMaterial{transparent:true}`, позиция на `distToCover=1` над полом в `(title.x, title.y)`. Масштаб плашки подгоняется под ширину текста/число строк (`update3D`, стр. 48885).
- **Всегда лицом к камере** (billboard): `mesh.rotation.set(0, cameraData.pan, 0)` (стр. 48916) — плашка крутится по азимуту вслед за орбитой. Плюс `updateScale()` (стр. 48851) масштабирует текстуру от нормализованного зума (`scale = 1 + zoom*1.5`), чтобы подпись не мельчала при отдалении.
- **Жизненный цикл:** `enable()` строит меши, `disable()`/`remove3D()` диспоузят geometry+texture и чистят контейнер; `update(resetTexture)` перестраивает при смене ковров/зума. Диспоуз текстур обязателен — иначе утечка (как и у 3D-рулеток).

---

## Data model — сводка чисел (для реимплементации)

| Параметр                               | Значение                                                | Стр.          |
| -------------------------------------- | ------------------------------------------------------- | ------------- |
| 3D камера fov / near / far             | 40° / 5 / 40000                                         | 46185         |
| 3D anchor.y (мин-высота)               | 110 (default 110)                                       | 46248         |
| 3D distance min/max/current            | 10 / 30000 / 3000                                       | 46248         |
| 3D tilt min/max/current (рад)          | −0.8 / 1.57 / 1.25                                      | 46248         |
| Орбита-математика                      | `pos = anchor + dist·(sin t, cos t·sin p, cos t·cos p)` | 27613         |
| Живые сенситивности pan/tilt           | 0.01 / 0.01                                             | 36945         |
| sensitiveZoom десктоп/мобайл/2D        | 0.005 / 0.001 / 0.05                                    | 36947 / 37581 |
| Зум-таблица (перспектива)              | 41 шаг 1.0→0, указатель старт 20                        | 36961         |
| pan-move sens (персп)                  | `max(distance/1200, 0.1)`                               | 37041         |
| toCenter 3D                            | изометрия π/4, π/4, distance.max                        | 46640         |
| cameraJump 3D время/fps/easing         | 1000мс / 60fps / easeInOutCubic                         | 37443         |
| авто-вращение speed                    | 0.002 (60fps setInterval)                               | 47150         |
| 2D орто-фрустум / near / far           | (−400,400,−300,300) / 1 / 1300                          | 47231         |
| 2D залоч. distance / tilt              | 1200 / π/2                                              | 47269         |
| 2D zoom min/max                        | −20.0 / 1.0 (41-шаг таблица)                            | 47272         |
| 2D pan sens                            | `(1−r)·20`                                              | 37633         |
| Клавиша-move step (2D/walk)            | 5 (×5 Shift)                                            | 45858         |
| Walk fov / near / far                  | 60° / 5.0 / 6000.0                                      | 47912         |
| Walk высота глаз                       | 150 см (default 150)                                    | 47977         |
| Walk distance (1-е лицо)               | min 1 / max 1 / current 1                               | 47984         |
| Walk tilt min/max (рад)                | −1 / 1.45                                               | 47989         |
| Walk dolly (колесо)                    | ±30 ед.                                                 | 48200         |
| Walk jump: время/шаги/мин-хоп/доля/кап | 500мс / 100 / 40 / 0.8 / ±500                           | 48215         |
| Walk FOV-пресеты                       | 60,70,80,90,100                                         | 48586         |
| Clip-плоскость default dist            | 20                                                      | 47078 / 48637 |
| Скайбокс-сфера радиус/сегменты         | 6000 / 60×40, вывернута                                 | 14461         |
| RenderUpdater кадров десктоп/мобайл    | 5 / 2                                                   | 10203 / 36612 |
| Скриншот 3D / превью 3D / превью walk  | 1280×720 / ProjectPreviewSize / 265×150                 | 46718 / 48306 |
| Панели ширина: dynamic / control       | 310 (десктоп) / 190 (телефон) / 40                      | 63 / 16843    |

---

## Geometry rebuild (render pipeline)

- Смена камеры устанавливается в общий рендерер через `updateCamera3d(camera)` (rebind `filterContours` на `scene3d.middle`). Рендер-пасс — §7b: 3 слоя + view2DObjects + selection, с `clearDepth()` между.
- Перерисовка — не непрерывный луп, а dirty-flag: `updater.needsUpdate()` доливает N кадров; `onProgress` — черновой (без фильтров), `onFinish` — качественный (SSAO/outline).
- `updateCameraPosition()` (стр. 37004) на каждый апдейт орбиты пишет `camera.position/rotation`, зовёт `scene3d.cameraChanged(...)` (свет следит), `sharedRenderer.update()`, диспатчит `CAMERA_POSITION_UDPATE` и подстраивает горизонт фон-фильтра.

## Edge cases

- **Свитч без анимации**: `enableViewer` — немедленный disable→remove DOM→enable→add DOM; «плавность» только от восстановления камеры в `enable`.
- **`getCurrentViewerName()` баг**: маппит walk как `viewConstructor` (стр. 16851) — не копировать.
- **Конфликт `state:"2d"`**: и 2D, и конструктор рапортуют `state:"2d"` → в `setViewState` конструктор (idx 0) выигрывает цикл.
- **Pan-азимут не заворачивается** — растёт неограниченно (`setPan`, стр. 27599).
- **Pinch-to-zoom фактически не реализован** в `TouchController` (стр. 28091): радиус пинча считается, но `ZOOM`-диспатч закомментирован; 2 пальца = rotate (2D) / pan (3D), не zoom.
- **Walk сквозь стены** — коллизии нет (см. §5a).
- **Right-drag pan на уровне MouseController отключён** (wiring закомм., стр. 28036); pan идёт через Space+left или API-события `CAMERA_MOVE`.
- **Два зум-стека**: живой (`Renderer3DPerspective`, dist 10–30000, `scaleValues`) vs легаси `CameraOrbitController` (dist 500–2000, шаг 0.05) — зеркалить живой.
- **Множитель `height*2`** в `findOptimalCamDist`/`setCameraFromTopToBottom` — Y трактуется с 2×, конвенция не разрешена.
- **Лимит света = 9 источников** на сцену (`LightViewer3D.maxLightCount`, стр. 48926); тени — глобальный тумблер (любой источник → тени у всех стен/продуктов), не per-lamp. Данные лампы кэшируются в статический `pool` по `productId`.
- **Оси света и подписей** используют ту же remap `(x, z, -y)`, что рулетки/сериализация (2D-`y` ↔ 3D-`z`).
- **Плашки-подписи и 3D-рулетки** держат `THREE.Texture`/DOM — обязателен диспоуз на `disable`, иначе утечка.

---

## Confidence & gaps

**Высокая уверенность** (прямая проверка исходника + перекрёстная сверка): архитектура «один общий рендерер + одна сцена, 4 камеры-обёртки»; индексы и порядок регистрации viewer'ов; логика `enableViewer`; трёхслойный `clearDepth`-пайплайн (bottom/middle/(contours)/view2DObjects/selection/top); `autoClear=false`; орбита-математика; **все числа в таблице** (fov/near/far/eye-height/distance/tilt/зум-таблицы/frame-counts 5 vs 2); render-on-demand логика; сериализация camera-state (компакт `{px,py,pz,tilt°,pan°,zoom0..1}` + сырой `getCameraData`); скайбокс как вывернутая сфера r=6000 с pano-материалом из каталога (`&category_tag=skybox`).

**Пробелы / чего нет в core-файле:**

1. **`URL_CAMERA_VIEWS` не существует** — есть только event-имя `UPDATE_CAMERA_VIEWS="updateCameraViews"` (стр. 857) и per-render-mode saved-camera'ы (exterior/interior/topView/walk), но это одиночные камеры для восстановления render-сетапа, **не тур-граф и не URL-пресеты**. URL-round-trip (если есть) — вне этого файла.
2. **360-захват отсутствует** — нет `CubeCamera`/`WebGLCubeRenderTarget`/эквирект-рендера; панорамы = готовые ассеты каталога на фоновой сфере; реальная генерация 360 — в отдельном бандле/на сервере.
3. **Коллизия walk отсутствует** в этом файле — движение free-fly на фикс-высоте; проверять против живого приложения.
4. **Pinch-zoom — dead code** (радиус есть, диспатч закомментирован).
5. **Разбивка BOTTOM/MIDDLE/TOP по контенту** — инференс (свет + debug-боксы + порядок), не явные `scene3d.add(..., MIDDLE)` вызовы; продуктовая геометрия идёт через `CommonSceneObject`/`view2DObjects`.
6. **Тонмаппинг/output-encoding** в `Renderer3D` не выставлены явно — дефолты THREE либо конфиг вне конструктора.
7. **Версия THREE** — старая эпоха (классический `WebGLRenderer`, `PlaneBufferGeometry`, `SphereGeometry`); `logarithmicDepthBuffer` тогглится по устройству.
8. **Множитель `height*2`** в фит-математике не разрешён.
9. **Точное `getViewStateData` для 3D** и разделение near-идентичных 2D/3D-замыканий подтверждено частично (2D-версия на стр. 47672 возвращает `state:"2d"`).
