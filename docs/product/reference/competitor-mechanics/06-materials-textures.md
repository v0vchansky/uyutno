# 06 — Materials & Textures (competitor mechanics)

Reverse-engineered from the un-minified `plannercore.js`. Two namespaces are relevant:

- **`R2D`** — the main scene/3D layer: material registry (`PoolMaterials`), material→THREE.Material loaders, the drag-a-material interaction, and the constructor-element 3D view that owns meshes.
- **`WC`** — the wall/room _data_ model (`WC.DataObject` subclasses for walls, covers, ceilings, plinths, frames; `WC.Part`) that stores material IDs and generates vertices+UVs. Feeds `R2D.ObjectConstructor3D` view objects.
- **`TConf`** — a separate _tile configurator_ sub-editor (areas/delimiters), noted where relevant.

All IDs are catalog product IDs (strings). A material can also be a **color**, distinguished purely by a leading `#` (hex). Line numbers cite `plannercore.js`.

---

## 1. Interaction — drag a material onto a surface

**Entry (drag start).** When a catalog item of type `R2D.ProductType.MATERIAL` is dragged over the canvas, `sceneObjectDragListener` (≈L41999) builds a floating preview and switches the mouse-interaction handler (MIH) into `R2D.MIH.StateDraggingMaterial` (L42003–42017). It decides material-vs-finish here:

- `event.data.productMaterialColor` present → `draggingMaterialId = productMaterialColor`, `draggingAddMaterialId = productId` (L42008–42010). So a color-carrying drag maps the **color** to the base `materialID` and the **finish/texture** to `addMaterialID`.
- otherwise → `draggingMaterialId = productId`, no add-material (L42012).

**Preview.** `R2D.MaterialDragPreview` (L10467) renders a 28px thumbnail that follows the cursor (`setPosition`, updated in `mouseMove`/`touchMove`, L44189/44226). `updatePreview(productId, color)` (L10485): if id contains `#` it draws a color swatch; if a color is supplied it renders a combined swatch via `R2D.Tool.getMatPrevFromMatIdAndColor`; else it draws the catalog texture (L10501–10519).

**Drop / apply (`R2D.MIH.StateDraggingMaterial`, L44160).** On `mouseUp`/`touchEnd` (L44192 / L44229):

1. Ray-pick the object under the cursor via `Renderer3D.getMousePointForPicker` + `scene3d.objectUnderCursor` against `interactiveObjects` (L44194–44195).
2. Resolve the picked THREE object back to a constructor view via `_constructorHelper.findObjectView3DByObject3D` (L44196).
3. Read the **part number** from the picked mesh: `partNum = objectUnderCursor.object.num` (L44197–44198). This `num` was stamped onto each mesh at build time as `mesh.num = parts[i].id` (L31134) — that is the bridge from picker → part.
4. Apply: `constructorObject3d.setMaterial(draggingMaterialId, partNum)` then `setAddMaterial(draggingAddMaterialId || "", partNum)` (L44200–44201), then `update()`, `history.saveState()`, renderer update, and dispatch `HISTORY_UNDO_REDO` (L44205–44208).
5. Reset `draggingAddMaterialId = ""`, remove the preview, restore the previous MIH state (L44203/44211/44213).

**Acceptance rule.** A drop only applies when a constructor view is found AND `me.isPlaceMaterialAllowed` is true — but the check exists only in `mouseUp` (L44199); the `touchEnd` path (guard L44237, `setAddMaterial` call L44240) has **no** `isPlaceMaterialAllowed` guard (quirk: на таче материал применяется и там, где мышиный drop запрещён). If the ray misses any interactive surface, nothing happens (the state still reverts). There is no per-surface-type rejection — any pickable constructor face accepts any material; the _part_ it lands on is whatever mesh the ray hit.

**TConf variant.** In the tile configurator, `TConf.StateDraggingMaterial` (L81019) resolves the drop to an **area** via `field.getAreaByPoint(realPos)` and calls `field.autoFill(area, material)` + `history.save()` (L81045–81051). Its `setDefaultMaterial(matID, addMatID)` (L78119) shows the same color rule: `matID.startsWith('#')` → `area.color`, else `area.matID`; empty falls back to matID `'2013'`.

---

## 2. Data model

### 2.1 Per-element material fields (`WC.DataObject` subclasses)

Every wall/cover/ceiling/plinth/frame data object carries a flat material block (defaults set per type, e.g. L52764–52765 wall (`WC.DataWall`), L51623–51624 area (`WC.DataArea`), L51730–51731 cover, L51843–51844 cap (`materialID`/`addMaterialID`), L51894 wall-frame):

| Field                    | Meaning                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `materialID`             | primary material (catalog id, or `#hex` color). `0`/`"0"` = none.                                                                        |
| `addMaterialID`          | secondary **finish** overlaid on the base (often the texture when base is a color, or a color tint when base is a texture). `""` = none. |
| `materialRotation`       | UV rotation in radians (a.k.a. serialized `mr`).                                                                                         |
| `materialX`, `materialY` | UV offset in **pixels** (serialized `mx`, `my`).                                                                                         |

Serialization mapping is explicit: `DC.materialRotation = parseFloat(ci.mr)`, `materialX = parseFloat(ci.mx)`, `materialY = parseFloat(ci.my)` (L53771–53773; same for axis `ai.*` at L53970–53972; clipboard paste `mx`/`my` at L69289–69290). Defaults come from `R2D.default.getDefaultMaterialByKey(type)` / `getDefaultAddMaterialByKey(type)` keyed by `wall|cover|ceiling|cap|plinth|molding` (registry L18988–18989; `clearMaterial` resets to these, L51300–51305 / L52868–52869).

### 2.2 Parts (`WC.Part`, L52441)

A surface is decomposed into **parts**, each carrying its own geometry + material:

```
// ctor (L52441–52462) инициализирует только:
me.materialID = 0; me.addMaterialID = "";
me.vertices=[]; me.uvs=[]; me.indices=[]; me.triangles=[]; me.area=0;
// навешиваются владельцем поверх (не в конструкторе):
me.id            // set by owner; -1 is the "remainder"
me.materialRotation / materialX / materialY   // per-part UV transform
```

- The **default/remainder** part is `id = -1` and holds the element's own `materialID/addMaterialID` (L53180–53184). Simple elements keep a single `parts[0]` and proxy `vertices/uvs/indices/area/triangles` getters straight onto it (L51232–51275).
- **Tiled/patterned** walls create one part per pattern entry (`part.id = pattern[i].id`, with its own `materialID/addMaterialID/tiles`) plus the `-1` remainder part (L53129–53184).
- `addNullData()` (L52454) writes a degenerate triangle (`[-1,-1,-1…]`, uvs 0) when a part has no geometry, so buffers are never empty.

### 2.3 Part-aware setters (multi-part elements, e.g. cover/tiled wall)

`setMaterial(matID, partNum)` (L52821) routes by part:

- `partNum` undefined or `'-1'` → set element `materialID` and the `-1` part (whole surface). Unwraps `matID.id ? matID.id : matID` so it accepts either a raw id or a material record.
- else → delegate to `configData.setMaterialByID(matID, partNum)`; on success also set that part via `getPartByID(partNum)` (L52832–52839).

`setAddMaterial(addMatID, partNum)` mirrors this (L52844). `getPartByID(id)` is a linear scan of `parts` (L52874). Both set `me.changed = true`.

Simple elements (single-part wall, plinth, frame) ignore `partNum` and always write `parts[0]` (`setMaterial` L51277 / L51942; `setAddMaterial` L51289 / L51964).

### 2.4 Products / models (`R2D.SceneObjectModel`, L11575)

A furniture model stores **two independent finishes** — a top _frame_ and a _bottom_ — each a full material block:
`materialFrame / addMaterialFrame / materialFrameRotation / materialFrameX / materialFrameY` and the `…Bottom` equivalents, with setters `setMaterialFrameData / setMaterialFrame / setAddMaterialFrame / setMaterialFrameRotation / setMaterialFramePosition` (and Bottom variants), L11602–11663. GLTF models instead carry a per-child `materials[]` array keyed by geometry `hash` / `md5`, each entry `{current, addMaterial, hash}` (applied in `R2D.ObjectViewer3DModel`, L32480–32560).

### 2.5 `R2D.SceneObjectMaterial` (L11541)

A thin, read-only value object for a _material as a scene product_: exposes `objectId`, `type`, `productId`, `productMaterialColor`, `productData`. This is what a catalog material item is at the scene level; `productMaterialColor` is the color half that becomes `draggingMaterialId` during drag.

### 2.6 Private / user materials

**Gap:** no `private_material` / `isPrivate` / `userMaterial` token exists in this build. The closest concept is _ownership_: a `user_key` / `isOwner()` check gating whether an owned material is counted (reported by the data-model agent around L17317–17338). Treat "private/user material" as an ownership flag on the catalog record, not a distinct planner-side type.

---

## 3. Material catalog asset → THREE.Material

### 3.1 Registry (`R2D.PoolMaterials`, L36182)

A global cache `__materials{}` keyed by id. `getMaterial(productId, addMaterial)` (L36232):

- `productId == 0|"0"` → `null` (no material).
- If an `addMaterial` (finish) id is given and already cached, it **applies the color** to that cached viewer via `setColor(productId)` and returns it (L36236–36238) — i.e. base color layered onto an existing texture material. Otherwise it creates one.
- `create(productId, initMaterialId, materialType)` (L36192): a leading `#` → `ObjectViewerColorMaterial`; else `ObjectViewer3DMaterial`.
- `remove()` (L36210) disposes every map (`map, normalMap, bumpMap, specularMap, envMap, aoMap, …`) then the material — proper GPU cleanup.

### 3.2 Color material (`R2D.ObjectViewerColorMaterial`, L32390)

Trivial: `new THREE.MeshPhongMaterial({ color: productId, side: DoubleSide })`, always `isReady()`. A "color" is thus just a Phong material with a hex color and no maps.

### 3.3 Texture/package material (`R2D.ObjectViewer3DMaterial`, L32115)

- Starts as a grey placeholder `MeshPhongMaterial({color:0x999999}), side=DoubleSide` (L32134), then async-loads the package via `R2D.Pool3D.load(productId)` (L32305).
- **GLTF path** (`.glb`, L32149): grabs the first Mesh's `material`; optionally downscales every map to `512 × TEXTURE_MULTIPLIER` (÷4 on phones) via `getDownscaledImageFromMap` (L32160–32184); adds a metal env-map when `roughness < 0.5 || metalness > 0.1` (L32187–32190).
- **Package path** (`ProductPackageParser.parseMaterial`, L26784 → `raw`): binary TLV format yielding `scaleX/scaleY/scalability, transparent, gloss/metal + intensities, materialType/reflectivity, diffuseData/normalData/specularData` (fields L26786–26808). Mapping to THREE (L32194–32291):
  - repeat = `scalability ? (scaleX, scaleY) : (1,1)`; when non-scalable, raw scales are stashed in `userData.scaleX/Y` (L32199–32208).
  - `diffuseData` → sets `color = 0xffffff` and builds `map` (L32215–32226).
  - `normalData` → `normalMap`; `specularData` → `specularMap` (L32228–32251).
  - `materialType`/`metal`/`gloss` → `envMap = EnvironmentMetal.getTexture()` + `reflectivity = EnvironmentMetal.getReflectivity(intensity)` (L32253–32285).
  - `transparent` copied through; a supplied `color` overrides via `new THREE.Color(color)` (L32287–32288).
- **Texture creation** (`R2D.Tool.makeTextureMap`, L29326): `THREE.Texture` with `anisotropy = Renderer3D.maxAnisotropy`, `wrapS/wrapT = RepeatWrapping`, `flipY = false`, `repeat.set(repeatX, repeatY)`, `needsUpdate = true` (L29327–29344).
- **getMaterial()** (L32337) returns `material.clone()` when a color override is set, else the shared instance — so tinting a texture doesn't mutate the cached base.

### 3.4 sRGB / color-space handling

This build uses legacy three.js encodings, and — важно — **их обработка glTF-цвета содержит баг**. Внутри `GLTFLoader` диффуз получает `map.encoding = THREE.sRGBEncoding` (L5969, `emissiveMap` тоже). Но сразу после парса **`R2D.Pool3D.__GLTFLoadListener` безусловно перетирает это на Linear для КАЖДОЙ каталожной GLB-модели**: `obj.material.map.encoding = THREE.LinearEncoding` (L36069), `normalMap` тоже (L36071) — этот листенер выполняется позже лоадера и до попадания модели в пул (L36081/36084). **Итоговое (нетто) цвет-пространство диффуза каталожных моделей — Linear, а не sRGB.** Практически это значит: их каталожные GLB отрисовываются с недо-гамма-коррекцией (блёкло/грязновато) — это легаси-баг, а НЕ спека к копированию. (В том же обходе для `POSTER` обнуляется `metalness`, L36072–36077.) Package-текстуры (`makeTextureMap`) явного per-texture флага не имеют и полагаются на output-encoding рендерера. Цвета применяются как `new THREE.Color(hex)` напрямую (без ручного `convertSRGBToLinear`).

> **Для нашего порта на r185** (см. [`../../architecture/threejs-r185-migration.md`](../../architecture/threejs-r185-migration.md) §1): albedo/`map` → `SRGBColorSpace`, data-карты (normal/rough/metal/AO) → `NoColorSpace`. **Не повторять** их force-linear на диффузе — именно он даёт блёклый цвет.

---

## 4. Geometry rebuild (2D + 3D, UV)

### 4.1 Where UVs are generated

The **data** layer (`WC`) produces vertices+UVs per triangle; the **view** layer (`R2D.ObjectConstructor3D`) turns those into meshes. Full line-by-line UV/mesh math lives in [`deep-dives/04-3d-mesh-uv.md`](deep-dives/04-3d-mesh-uv.md). Key generators:

**Wall face — `WC.findTriWall(a,b,c, v1,v2, height, reverse, shiftX, shiftY, rotation, centerX, centerY)`** (L52463). Constant `pixPerMeter = 100`.

1. Flatten the triangle into wall-local 2D `(u,v)`; `reverse` (the **back side** = `faceRight`) mirrors U: `u = wallWidth - x` on front vs `u = x` on back (L52496–52517). This is how the two wall sides get independent, correctly-oriented UVs.
2. Apply offset + rotation about the material center:
   `transformed = TR.rotateXY(u - shiftX - centerX, v + shiftY + centerY, -rotation)` then add center back (L52519–52528).
3. Normalize to meters: `u /= 100; v /= 100` (L52530–52537).
4. World vertices are reconstructed from the wall azimuth (`Math.sin/cos(angle)` about `pivotPoint=v1`, L52542–52555).

**Floor / ceiling / cover — `WC.findTriCover(a,b,c, elevation, reverse, shiftX, shiftY, rotation, centerX, centerY)`** (L52564). Same `pixPerMeter=100`; UV = the triangle's own `(x, y)` (mirrored in `x` when `reverse`), transformed with the same rotate-about-center formula (using `kr = reverse ? -1 : 1`, L52616–52640), then ÷100. Vertices laid flat at `Y = elevation`, `Z = -y` (L52655–52668).

**True tile mode — `WC.findTriWallTile(...)`** (L52677): used when `tile.isTile`, mapping each triangle into an explicit tile UV quad `(uv00, uv10, uv01)` with per-tile `flip`/`rotation` instead of the continuous formula.

So the core UV transform (all surfaces) is: **translate by −(offset+center) → rotate by −materialRotation (cos/sin via `TR.rotateXY`) → translate back by +center → divide by 100 px/m.** Tiling density is then the texture's `repeat` (from package `scaleX/scaleY`, §3.3), not baked into these UVs.

### 4.2 build3D — data-side geometry rebuild

`build3D()` on each element rebuilds its part buffers. Single-part area/frame (`DataArea.build3D` L51635 / wall-frame L51895-region): copies `materialID/addMaterialID/materialRotation/materialX/materialY` into `parts[0]`, clears `vertices/uvs`, re-triangulates and re-runs `findTriWall`/`findTriCover` per triangle, then `parts[0].indices = WC.generateIndices(vertices.length/3)`. A wall (`WC.DataWall`) is always **multi-part** (build3D L53069–53214): rebuilds each pattern part (tiled → `findTriWallTile`, else `findTriWall`) accumulating `area`, then appends the `-1` remainder part with the element's material.

`rotateMaterial(angle[,partNum])` and `moveMaterial(shift)` write the new rotation/offset to the element **and** the target part, then call `build3D()` immediately (L51355–51385; multi-part variant L53221–53239 routes via `configData.setRotationByID`). So dragging the material rotate/move handle triggers a **targeted** rebuild of just that element.

### 4.3 build3D — 3D view rebuild (targeted vs full)

The view object (`R2D.ObjectConstructor3D`) listens for `WC.ELEMENT_UPDATE` (dispatched by `dispatchUpdate()`, L51347). `elementUpdateEventHandler` (L31141) runs two independent steps:

- `updateGeometry()` (L31119): dispose old meshes, and for each `parts[i]` build a fresh `BufferGeometry` from `flipGeometryByZ(part)` (indices/vertices/uvs) and stamp `mesh.num = parts[i].id` (L31129–31136).
- `updateMaterial()` (L31093): for each part, resolve `materialID` (+ `addMaterialID`, with a fallback to the element's `addMaterialID` for non-wall types, L31104) through `PoolMaterials.getMaterial(...)`, assign `meshes[i].material`, and subscribe to the viewer's async `UPDATE`/`MATERIAL_LOADED` so the mesh swaps in the real texture when the package finishes loading (L31106–31116). A partially-visible element is shown with the yellow `#FFFF00` material at reduced opacity (L31107–31110).

**Targeted vs full:** a _material-only_ edit follows `setMaterial → changed=true → dispatchUpdate → elementUpdateEventHandler`, which re-meshes and re-materials **only that element**; async texture load later swaps just that mesh's material in place (no re-triangulation). A **full rebuild** (`setStructure`, L55088; вторая реализация L61476; removeAll → findAxes → createPlinths → build3D → findRoomsForCovers) happens only when room topology changes (walls added/removed/moved), calling `build3D()` on every element. Undo/redo restores each object's material fields then calls `build3D()` + `dispatchUpdate()` on the affected objects (state restore path, ≈L12660–12687).

---

## 4a. Tile configurator (`TConf`) — раскладка плитки

`TConf` — **самостоятельный Canvas2D под-редактор** (не Three.js), открывается поверх плана (`appendCanvas`/`.tileConfig_canvas`, L77676; прячет вьюеры класс`canvas_hidden`). Верх — `TConf.TileConfig` (L77565), внутри `field` (`TConf.Field`, L77699) + `editor` (`TConf.Editor`, L79153). Единицы поля — сантиметры. Наружу отдаёт результат в том же shape-формате, что полы/стены (см. §4.1), через `getTiles` (мост ниже).

### 4a.1 Field / Area / Delimiter (рекурсивное деление)

Поверхность рубится **перегородками** `TConf.Delimiter` (L79116) на зоны `TConf.Area` (L78918). Делимитеры образуют граф: у каждого `parent1/parent2` (концы, к которым он примыкает) и `children` (делимитеры, стартующие от него), тип `Delimiter.HOR='h'` / `Delimiter.VER='v'` (L79150). У `Area` — четыре ссылки `delimiters.{top,bottom,left,right}` на ограничивающие её делимитеры; `calcAreas` пересобирает контуры зон из графа.

`splitArea(area, how)` (L78424) режет активную зону надвое, создавая один новый делимитер и одну новую `Area`; **имена инвертированы — не спутать**: `how == Delimiter.HOR` (⇄ `TConf.SPLIT_HOR`, L77562) создаёт **вертикальный** делимитер `new Delimiter(Delimiter.VER, …)` (L78436) — т.е. «горизонтальный сплит» рассекает по X и ставит вертикальную линию; симметрично `Delimiter.VER` ставит `Delimiter.HOR` (L78462). Порог — не режет зону тоньше 5 см (L78434/78460). Новая зона получает следующий `matID` из циклического `matIDs` + `addMatID = getDefaultAddMaterialByKey("cap")` (L78427–78429). Обратная операция — `mergeAreas(delimiter)` (L78283): удаляет делимитер и сливает две смежные зоны.

Каждая `Area` несёт свой материал/цвет и трансформ раскладки: `matID`, `color` (`#hex`), `matRotation`, `angle` (поворот сетки), `shiftX/shiftY` (сдвиг), `margin` (шов, дефолт **0.5 см** в конструкторе `Area`, L78929), `random`, `defMaterial`, `tiles[]` (L78934/78962).

### 4a.2 AutoFill (сетка + рандом + обрезка)

`autoFill(area, mat)` (L77865) заполняет зону плитками `TConf.Tile`: шаг `stepX = material.width + margin`, `stepY = material.height + margin` (L77884), сетка выравнивается по `Math.round(min/step)*step` (L77887) и генерится с запасом (`i,j ∈ [−n−2, n+2]`, L77897), затем `removeOutsideTiles(area)` (L77909) обрезает всё вне контура зоны. Если `area.random` — `randomRotate()` (L77912 → L78948) даёт каждой плитке случайный поворот/отражение (`Tile.randomRotate`, определение L79078; call-site L78951). `autoFillAll` (L77857) перезаливает все зоны с `defMaterial`. Каждая перезаливка шлёт `TConf.FIELD_CHANGED` (L77914).

### 4a.3 Snap (двухуровневый) и undo

`TConf.Snap` (L79477) используется **только** в `TConf.StateMakingTiles` — поштучная постановка новой плитки кликом (`getSnapPoint` в `mouseMove` L80566 и `touchMove` L80637, `createTile` в `mouseDown` L80578); состояния перетаскивания существующей плитки в TConf нет. Причём это недоступная из UI ветка: `stateMakingTiles`/`stateSelecting` создаются (L79189–79190), но ни один `changeState` в них не ведёт (`stateSelected` достижим лишь из `stateSelecting`, `stateShiftingArea` — только из закомментированного кода L79712–79755 / L80363–80380). Сам TConf существует только для стен (`runConfigurator(wall)` L56264, `DataWall.configData` L52790), для полов (`DataCover`) его нет. При постановке плитки `getSnapPoint` даёт двухфазную привязку: сначала `snapToBorder` (к границам активной зоны, с учётом полей `margin/2`, L79502), затем `snapToNeighbour` (к соседним плиткам с учётом шва) — до двух проходов соседа (L79486–79493); порог `snapDist`, epsilon `TR.B_EPS = 0.0001` (L49483).

Своя история — `TConf.History(field)` (L78832): стек **сериализованных снапшотов** `field.getData()` (не клон живого `Field`), `undo/redo` восстанавливают через `field.setData(stack[pointer])` (L78852–78868); при новом действии хвост за указателем отсекается (L78843). Стартовый снапшот сохраняется в конструкторе (L78850).

### 4a.4 Мост наружу — `Field.getTiles()`

`TileConfig.getTiles(h, w, faceRight)` → `field.getTiles(...)` (L77650 → L77917) конвертирует каждую плитку каждой зоны в объект **того же shape-формата, что полы/стены §4.1**: `{outerContours:[tileCont], innerContours:[], boundContours:[areaCont], materialID, addMaterialID, rotation, flip, fixUV:true, id:'disable'}` (L77957). Углы плитки переводятся `areaToReal` в координаты зоны, затем **зеркалятся под сторону стены** через `TR.flipPoints`: для `faceRight` — только по Y (L77948), иначе — по X и Y со сдвигом на `w` (L77952) — тот же back-face-mirror, что у `findTriWall` (§4.1). Так набор плиток встраивается в общий геометро-конвейер отделки без отдельного рендер-пути. (Дроп материала из каталога в зону — `field.getAreaByPoint` → `autoFill`, уже описан в §1 «TConf variant».)

---

## 5. Edge cases

- **id `0`/`"0"` = "no material":** `getMaterial` returns null (L36233); GLTF child loop skips `current == "0"` and restores the embedded material instead (L32482–32502); constructor skips `materialsIds[i] == "0"` (L32553).
- **Empty part:** `addNullData()` injects a degenerate tri so buffers/indices are never zero-length (L52454).
- **Color vs texture is a string test only:** leading `#` is the sole discriminator (L36201, L32393, L78123) — a texture id and a color id are never structurally typed.
- **Finish layering:** passing `addMaterial` to `getMaterial` mutates the cached finish viewer's color via `setColor` and returns it (L36236–36238); the base+finish combo is thus resolved at lookup time, not stored as a compound.
- **Clone-on-tint:** `getMaterial()` clones when a color is present (L32338) to avoid corrupting the shared cached material.
- **Back face UV mirroring:** `faceRight/reverse` flips U so the two wall sides read correctly; forgetting it mirrors text/patterns.
- **Non-scalable materials:** `scalability=false` forces `repeat=(1,1)` and stashes intended scale in `userData` (L32202–32208) — density then comes only from UV geometry.
- **Downscaling:** large GLTF maps are capped at 512·multiplier (÷4 on phones) to bound VRAM (L32160–32184).
- **Product materials aren't dirty-flagged:** `SceneObjectModel` frame/bottom setters just assign; there's no `changed` flag on them (they sync to axis data separately) — unlike `WC` elements which set `me.changed = true`.

---

## 6. Confidence & gaps

**High confidence** (read directly, with line numbers): the drag/drop interaction and material-vs-color split (`StateDraggingMaterial`, L44160/L42003); `WC.Part` and the `-1` remainder model (L52441/L53180); part-aware `setMaterial/setAddMaterial` routing and `getPartByID` (L52821–52880); the UV formulas in `findTriWall`/`findTriCover`/`findTriWallTile` (L52463/52564/52677) including the pixPerMeter=100 normalization and rotate-about-center transform; the catalog→THREE pipeline (`PoolMaterials` L36182, `ObjectViewer3DMaterial` L32115, `ProductPackageParser.parseMaterial` L26784, `makeTextureMap` L29326); the targeted-rebuild path (`elementUpdateEventHandler`/`updateGeometry`/`updateMaterial`, L31093–31151) and `mesh.num = part.id` picker bridge (L31134); `SceneObjectModel` frame/bottom fields (L11575); the default-material registry `getDefaultMaterialByKey`/`getDefaultAddMaterialByKey` (L18988–18989); the `setStructure` full-rebuild entry point (L55088; вторая реализация L61476).

**Medium confidence** (partly via sub-agents, not every line re-read by me): GLTF per-child hash/material-array binding details (L32480+).

**Gaps / unresolved:**

- **`private_material` does not exist** in this build. No `isPrivate`/`userMaterial` token; the nearest notion is catalog **ownership** via `user_key`/`isOwner()` (≈L17317). If the product spec needs "user/private materials," it is not modeled planner-side here.
- **sRGB handling is legacy and buggy (verified High):** `GLTFLoader` ставит `sRGBEncoding` на диффуз (L5969), но `Pool3D.__GLTFLoadListener` **перетирает на `LinearEncoding` для всех каталожных GLB** (L36069–36071, выполняется после лоадера) → нетто-диффуз каталожных моделей = **Linear** (недо-коррекция цвета — легаси-баг, не спека). Package-текстуры наследуют output-encoding рендерера без per-texture флага. No `SRGBColorSpace`/`convertSRGBToLinear` — старый three.js. При порте на r185 цвет-пространства задавать явно и НЕ копировать их force-linear.
- **`materialX/materialY` units**: pixels at 100 px/m; the `mx/my` serialized values are floats in the same pixel space (L53772–53773). Offsets are pre-rotation, about `rotatingCenter` (wall center L53115).
- **Tile-configurator (`TConf`)** — структура вскрыта в §4a: `Field`/`Area`/`Delimiter`-граф, `splitArea` (⚠️ инверсия SPLIT_HOR→VER, L78432), `autoFill` (сетка+рандом+обрезка, L77865), двухуровневый `Snap` (L79477), снапшот-undo `getData/setData` (L78832), мост `getTiles` в shape-формат отделки (L77917). Не разобрана построчно только математика `mergeAreas` (L78283) и per-tile `randomRotate` (L79078) — принцип ясен, точные формулы не перечитаны.

**Чего не хватает для реализации:**

- **Своя схема ассета материала**: albedo/normal/roughness (+metalness вместо Phong), `scaleX/Y` в метрах-на-повтор, `scalability`, `transparent`; маппинг Phong→`MeshStandardMaterial` проектировать самим.
- **Env-map**: `EnvironmentMetal` не разобран; в r185 — `scene.environment`/PMREM, свой дизайн.
- **Registry дефолтных материалов**: механика (`getDefault(Add)MaterialByKey`, L18988–18989) есть, конкретные каталожные ID и источник наполнения — нет.
- **configData (мост WC↔TConf)**: `setMaterialByID`/… (L78489/78505/78570) и `getData`/`setData` не разобраны — а это пер-парт плитка и её undo/persist.
- **Схема undo-снапшота материалов** — известна только косвенно через restore-путь (≈L12660–12687).
- **Пер-модельные материалы GLTF**: откуда `md5` у child-геометрий, формат `materialsObjects`, `restoreEmbeddedMaterial`.
- **r185-специфика порта**: `SRGBColorSpace`/`NoColorSpace` (не копировать force-linear баг), `MeshStandardMaterial`, merge партов через `BufferGeometryUtils` (identity-index расточителен), геометрический ±1 мм vs `polygonOffset`.
- Закрыто deep-dive'ами (сюда не дублируем): контракт `TR.triangulateContours` и триангулятор → [`deep-dives/01-triangulation-core.md`](deep-dives/01-triangulation-core.md) + [`deep-dives/08-geometry-predicates.md`](deep-dives/08-geometry-predicates.md); `getHoles()`/`WC.findContourWall` (проёмы → 2D-контуры дыр) → [`deep-dives/06-opening-holes.md`](deep-dives/06-opening-holes.md); `DataCover.build3D` целиком → [`deep-dives/05-cover-build3d.md`](deep-dives/05-cover-build3d.md).
