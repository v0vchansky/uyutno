# Competitor mechanics — 10. Serialization / Save-Load Format

Reverse-engineered from the competitor's un-minified planner bundles:

- **Core** (`plannercore.js`): `R2D.SceneParser` (versioned load-time parser), `WC.convert` (structure ⇄ compact-wire converters), `R2D.SceneSaver` / `R2D.SceneLoader` (HTTP save/load), `R2D.CopyPaste` (clipboard).
- **API layer** (`user.js`): `R2D.UserCore` — autosave-metadata POST, share/copy/delete dispatch, urlencoded body helpers.

All line numbers below refer to those two files. This is a functional spec written in our own words; snippets are minimal and only where the exact text is load-bearing.

> **Terminology:** the wire format is a two-layer thing. (1) An _envelope_ `plan` object carries project metadata + `construction` + `scene`. (2) `construction` is a **normalized compact** graph produced by `WC.convert.structureToShort`: geometry points are stored **once with ids**, and everything else references those ids. This id-normalization is the single most important idea in the format.

---

## Interaction — save / load / autosave triggers

### Save (full scene → server)

- **`R2D.SceneSaver.save(data, autoSave)`** — `plannercore.js:23531`. Builds the body and POSTs:

  ```js
  var params = {json: encodeURIComponent(JSON.stringify(data))};
  if (autoSave) params.autoSave = 1;
  params = R2D.XHRLoader.makeParamsString(params);
  loader = R2D.XHRLoader.getPostLoader(R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_SAVE_PLAN), params, ...);
  ```
  - **Method/content-type:** `POST`, `application/x-www-form-urlencoded` (via `getPostLoader`), `withCredentials=true`.
  - **Body:** a single field `json=<urlencoded JSON.stringify(data)>`, plus `autoSave=1` when the save is a background autosave. `data` is `{plan: <planEnvelope>}` (see Data model).
  - Note the double-encoding: the JSON string is `encodeURIComponent`-ed here, and `makeParamsString` (`user.js:2946`) does **not** re-encode — so the value is encoded exactly once.

- **Envelope assembly** happens before `save` is called, in the controller's save promise (`plannercore.js:15640+`). Sequence:
  1. `scene.getSceneState()` builds the plan object (→ internally `R2D.Scene.getSceneState`, `plannercore.js:13878`, which assembles `res` at `13900`).
  2. A **preview screenshot** is taken (`R2D.Viewers.makePreviewScreenShot()`), base64, and the data-URI prefix is stripped: `sceneData.preview = preview.split(',')[1]`.
  3. Floorplan drawing source is likewise stripped of its data-URI prefix only when it changed (`WC.wallsEditor.floorPlanDrawingsChanged[0]`).
  4. `R2D.SceneParser.projectMissingDataCorrector.checkSceneDataBeforeSend(res)` runs a last-chance defaulting pass over walls/covers/areas (`plannercore.js:26315+`) so no `null`/`NaN` material fields go out.
  5. Wrapped as `planData = {plan: sceneData}` and handed to `sceneSaver.save(planData, autoSave)`.

- **Response validation** — `loaderEventHandler` inside `SceneSaver` (`plannercore.js:23469`): parse JSON → require `status` present → reject `status=='error'` (surfacing `error` message) → require `status=='success'` → **require `plan_id`**. On success dispatches `COMPLETE` with the whole object.

- **Post-save side effects** (`plannercore.js:15678+`): `R2D.scene.updateProjectId(data['plan_id'])`, `updateProjectHash(data['hash'])`, stores returned floorplan image `data.sources.drawing[0]`, and (if `enable_set_project`) postMessages `{action:"set_project", projectId: data.plan_id}` to the parent frame.

### Load (server → scene)

- **`R2D.SceneLoader.load(planId, asHash)`** — `plannercore.js:23412`. Two modes:
  - Own project: body `json={"plan_id": planId}`, endpoint `R2D.URL.URL_LOAD_PLAN`.
  - Shared project: body `json={"plan_hash": planId}`, endpoint `R2D.URL.URL_LOAD_SHARED_PLAN` (also mirrors the hash into a `?plan_hash=` query param).
  - Both `POST`, urlencoded, `withCredentials`.
- **`R2D.SceneLoader.loadFromString(strData)`** — `plannercore.js:23388`: same parse path for locally-cached/pasted JSON (used by localStorage recovery).
- **Response validation** — `sceneLoaderEventHandler` (`plannercore.js:23320`): parse → require `status`, require `status=='success'`, require `plan`, then `scope.sceneData = R2D.SceneParser.parse(jsonObject["plan"])`. If parse returns non-null, dispatches project view-status / name updates and kicks off async product-catalog loading (`loadProductsData`).

### Autosave (two distinct mechanisms — do not conflate)

1. **Full-scene autosave** = the same `SceneSaver.save(data, /*autoSave*/ true)` path, which just appends `autoSave=1` to the body. Same endpoint, same envelope.
2. **Autosave-metadata POST** = `R2D.UserCore.UserAutoSave.updateAutoSave(data)` — `user.js:2985`. A thin, **caller-driven** POST (no internal debounce/interval/event listener — the trigger and throttling live in the controller that calls `me.autoSaveUpdate(...)`, `user.js:220`). It sends the **raw** `JSON.stringify(data)` as the whole body (NOT wrapped as `json=`), to `R2D.URL.URL_AUTO_SAVE_UPDATE`. Validation is `status == 'ok'` (not `success`, and it does not check `plan_id`); it always `resolve`s (never rejects), returning `{type:"error", data:"TEXT_ERROR_LOAD_DATA"}` on failure. The user-level "autosave enabled" flag is `me.data.autoSave` (`user.js:18`).

#### Autosave cadence — two independent timers

The controller drives autosave with **two separate `setInterval` loops** (both armed after a 5 s startup delay). Independent of the manual/full save (which also snapshots a preview screenshot, §Save):

- **localStorage every 5 s (diff-guarded)** — `scope.sceneAutoSaveStorage(hash)` (`plannercore.js:16295`). Immediately writes `R2D.Storage.save('r2d_project_<hash>', JSON.stringify({...getObjDataForStorage(), hash}))`, then a `setInterval(…, 5000)` re-serializes and **writes only if the JSON differs** from what's already stored (a cheap dirty-diff, not the history dirty-flag). Key is `r2d_project_<hash>` when a project hash exists (from URL `/project/<hash>` or the passed `hash`), else the bare `r2d_project` — and `R2D.Storage.save` appends `_<key> (суффикс — installation key из `R2D.Storage.getKey`, не пользователь)` to every key (`17776+`), so the actual localStorage key is `r2d_project_<hash>_<key>`. Cleared by `clearSceneAutoSaveStorage()` (`16310`, `clearInterval` + removes both keys). This is the localStorage recovery source that `SceneLoader.loadFromString` reads back.
- **Server every 60 s (owner + dirty + saved-project only)** — `scope.sceneAutoSaveServer(userKey)` (`plannercore.js:16317`): `setInterval(…, 60000)` that fires `saveCurrentScene(null, /*autoSave*/ true)` **only when all three hold**: `scene.getProjectId()` (project already exists server-side), `scope.wasChanged()` (history dirty-flag, see `09-undo-redo-history.md` §7), and `userKey == scope.getProjectUserKey()` (**current user is the project owner** — a viewer of someone else's shared project never auto-persists to the server). Cleared by `clearSceneAutoSaveServer()` (`16325`).

So: local backup is fast/unconditional-but-diffed (5 s), server autosave is slow and gated on ownership + unsaved changes + an existing `projectId` (60 s). Neither replaces the explicit user save, which additionally attaches the preview screenshot.

### Copy / delete / share (project-level operations)

- **Copy:** `R2D.SceneRename`/`SceneCopy.execute()` (`plannercore.js:15370`): body `json={"plan_id":planId,"plan_new_name":newName,"plan_old_name":oldName}` → `R2D.URL.URL_COPY_PLAN`. Response yields a **new `id` and new `hash`** for the copy (`getNewId()`/`getNewHash()`).
- **Delete:** `R2D.SceneDelete.execute()` (`plannercore.js:15448`): body `json={"plan_id":planId}` → `R2D.URL.URL_DELETE_PLAN`. Validation = `status=='success'`. If the deleted id is the currently-open project, the controller creates a new blank scene.
- **Share:** `R2D.UserCore.projectHashLoad(projectId)` (`user.js:1217`): guards `projectId==0` → `not_saved_project`; body `json={"plan_id":projectId}` → `R2D.URL.URL_SHARE_PLAN`; validation requires `status=='success'` **and** a `hash` property, resolving that `hash`.

### `id` vs `hash`

A project is identified internally by a **numeric `id`** (aka `plan_id`); its **public/shareable reference is a `hash`** (string). Loading by `id` requires ownership/session; loading by `hash` is the read-only shared path. Copy mints a fresh `id`+`hash`; share resolves the `hash` for an existing `id`.

---

## Data model — THE FULL WIRE SCHEMA (centerpiece)

### Top-level plan envelope

Produced by `R2D.Scene.getSceneState` (`plannercore.js:13878`; `res` object assembly at `13900`), validated by `R2D.SceneParser.parse` (`plannercore.js:26208`). Sent as `{plan: {...}}`.

| Field                                           | Meaning                                                                                                                                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                            | numeric project id (`plan_id`); `0`/absent = unsaved                                                                                                                                                                                        |
| `user_key`                                      | owner key (required by parser; used for view-only checks)                                                                                                                                                                                   |
| `name`                                          | project display name                                                                                                                                                                                                                        |
| `dimension`                                     | measurement/unit **display** system (metric cm по умолчанию / imperial ft / mm / m — `R2D.DimensionSystem`) — влияет только на отображение; внутренние координаты всегда в **см**                                                           |
| `version`                                       | format version string; only `"version_001"` exists; **`getSceneState` does NOT write it** (line commented out at `13904`), so saved envelopes lack the field — the parser's **`default` case routes to `parseVersion001`** (see Edge cases) |
| `construction`                                  | the normalized compact geometry graph (below)                                                                                                                                                                                               |
| `scene`                                         | placed products + view state (below)                                                                                                                                                                                                        |
| `floorplan`                                     | uploaded floor-plan tracing image + display state (`drawing.source` base64, `drawing.display`); optional                                                                                                                                    |
| `preview`                                       | base64 **JPEG** thumbnail (data-URI prefix stripped) — все вьюеры кодируют `toDataURL("image/jpeg")` (3D `46737`, 2D `47738`, walk `48324`, конструктор `61031`)                                                                            |
| `hash`                                          | public share hash                                                                                                                                                                                                                           |
| `viewOnly`                                      | read-only flag                                                                                                                                                                                                                              |
| `extraData`, `logoSrcList`, `construction.list` | misc: logo sources, and a flattened manifest list of all product+material ids referenced (used to pre-fetch the catalog)                                                                                                                    |

`parse` hard-requires `id, user_key, name, dimension, scene, construction`. `preview` and `floorplan` requirements are commented out (tolerated absent).

---

### `construction` — normalized compact graph

Built by **`WC.convert.structureToShort(obj)`** (`plannercore.js:53502`), which returns `{construction: res, list_materials: [...unique material ids]}`. Parsed by **`R2D.SceneParser.parseConstructionVersion001`** (`plannercore.js:25647`), which requires keys `points, walls, covers, cuts, rooms, areas, cap`.

**Units:** linear coordinates/heights are in **cm** (world units — подтверждено: `WC.DEFAULT_WALLS_HEIGHT=280`=280см, `pixPerMeter=100` ⇒ 1 unit=1см, `DimensionSystem.MetricCM.toString` — identity; area `/10000`→м² работает только для см²); rotations in **degrees**; material offsets `mx/my` in the material-texture's own units; areas in the estimate converter are divided by 10000 to get m² (cm²→m²).

**The central normalization:** `points` is the single source of geometry. Every point is emitted **once** with an `id`; walls, cuts, covers, rooms, and areas all reference points (and each other) **by id**, never by embedding coordinates. On load, `shortToStructure` (`plannercore.js:53828`) rebuilds `dictPoints`/`dictWalls`/`dictCuts` maps and re-links everything by id.

#### `points[]` — `{id, x, y, type, control}`

- `id` — unique int point id.
- `x, y` — coordinates (cm), rounded via `TR.roundCoord` (до 0.001 см).
- `type` — `'rp'` = room point (`WC.ROOM_POINT`, `plannercore.js:56807`) or `'cp'` = cover point (`WC.COVER_POINT`). Determines whether the point goes into `roomPoints` or `coverPoints` on load.
- `control` — always `0` in current output (control-point flag reserve).
- Parser requires: `id, type, control, x, y` all present (`parsePoints`, `25716`).

#### `walls[]` — `WC.convert.wallToShort` (`plannercore.js:53644`)

`{id, name, partialVisible, visible, exists, pa, pb, pm, m, addM, mr, mx, my, plt*, plb*, conf}`

- `pa`, `pb` — **point ids** of the wall's two endpoints (`point1.id`, `point2.id`).
- `pm` — mid marker (emitted as `''`; parser requires the key present).
- `m` — primary material id; `addM` — secondary/overlay material id.
- `mr` — material rotation (deg); `mx`, `my` — material offset X/Y.
- `exists`/`visible`/`partialVisible` — booleans; a wall can exist structurally but be hidden.
- **Top plinth** (`plt*`): `pltv` (0/1 exists), `pltvisible`, `pltpv` (partialVisible), `plthbi` (hiddenByInstrument), `pltm`/`pltAddm` (material/secondary), `pltmr`/`pltmx`/`pltmy` (rot/offset), `plth` (height cm), `pltd` (depth cm), `pltsh` (shape number / profile index).
- **Bottom plinth** (`plb*`): identical shape with `plb` prefix (`plbv, plbvisible, plbpv, plbhbi, plbm, plbAddm, plbmr, plbmx, plbmy, plbh, plbd, plbsh`).
- `conf` — an **object** returned by `DW.configData.toData()` (not a string blob), the **wall-tiling configurator** (`TConf.Field` ctor `plannercore.js:77699`; `toData`/`fromData` at `78605`/`78643`): `{w, h, areas:[{...,delimiters:{l,r,t,b}, addM}], delimiters:[{...,id,pr1,pr2,ch:[childIds]}]}`. This is a surface split/tiling layout — **NOT** window/door openings. Empty string when the wall has no tiling config.
- Parser (`parseWalls`, `25749`) hard-requires `id, pa, pb, pm`; defaults `m, mr, mx, my` if missing. Unlike the other entity parsers, `parseWalls` returns `[]` (not `null`) when a key is missing (`25758-25787`), and the caller only checks `== null` (`25683`) — so **a broken wall does not fail the whole parse** (points/cuts/rooms/covers/areas do).

#### `cuts[]` — inline in `structureToShort` (`plannercore.js:53525`)

`{id, pa, pb, m, addM, mr, mx, my}`

- A "cut" is an interior partition edge (non-load-bearing divider) between two points. `pa`/`pb` — point ids. `m/addM/mr/mx/my` — material as for walls.
- On load, cut `height`/`low` are **derived** from the heights of the areas it borders (`cut.heights`), defaulting to `cap.wallsHeight`.
- Parser `parseCuts` (`25856`) requires `id, pa, pb`; defaults `mr, mx, my, m`.

#### `rooms[]` — inline (`plannercore.js:53534`)

`{id, points:[pointIds], walls:[wallIds], outer}`

- `points` — ordered list of **point ids** forming the room contour.
- `walls` — list of **wall ids** bounding the room.
- `outer` — `1` = outer/shell contour, `0` = inner contour (hole/nested room).
- Rooms carry **no coordinates and no geometry** — they are pure id references; the polygon is reconstructed from the referenced points at load, and per-wall orientation (`faceRight`, `outer`) is **computed from contour winding** (see Geometry rebuild).
- Parser `parseRooms` (`25895`) requires `id, outer, points, walls`.

#### `covers[]` — `WC.convert.coverToShort` (`plannercore.js:53668`)

Floors and floor-holes. Outer cover (a floor slab):
`{id, exists, visible, partialVisible, name, points:[pointIds], o:1, ch, cvisible, cv, cpv, chbi, m, addM, mr, mx, my, mc, addMc, mcr, mcx, mcy, title}`

- `points` — cover-point ids (contour of the floor).
- `o` — `1` = outer (floor), `0` = inner (hole cut into a floor); inner-cover branch emits a minimal record with **hard-coded** material stubs (`m:'1', mr:0, mx:0, my:0, mc:'0', mcr:0, mcx:0, mcy:0`, `coverToShort` `plannercore.js:53685-53686`), not values from the defaults table (`ProjectMissingDataCorrector`).
- Floor material: `m/addM/mr/mx/my`.
- **Ceiling** attached to this cover: `cv` (0/1 exists), `cvisible`, `cpv` (partialVisible), `chbi` (hiddenByInstrument), `ch` (ceiling height cm), `mc`/`addMc` (ceiling material/secondary), `mcr`/`mcx`/`mcy` (ceiling material rot/offset).
- `title` — room label object `{text, visible:{view3d,view2d,viewConstructor}, areaVisible:{...}, x, y}`; legacy plans store `visible` as a plain bool and it's upgraded on load (`coverFromShort`, `53765`).
- Parser `parseCovers` (`25793`) requires `id, o, points`; defaults the whole `m*`/`mc*`/`ch`/`cv` set.

#### `areas[]` — inline (`plannercore.js:53584`)

Wall-clusters with a ceiling (a "zone" bounded by walls/cuts):
`{id, name, walls:[wallIds], cuts:[cutIds], h, ch, cv, cvisible, cpv, chbi, m, addM, mr, mx, my, mc, addMc, mcr, mcx, mcy}`

- `walls`, `cuts` — **id references** into the wall/cut arrays; the area polygon is rebuilt from the pairs of endpoints via `WC.contourFromPairs`.
- `h` — wall height for this area (cm); overrides `cap.wallsHeight` for its walls, and disables their top plinth.
- Floor material `m*`; ceiling `mc*`/`ch`/`cv`/… identical to covers.
- Parser `parseAreas` (`25923`) requires `id, walls, cuts`; defaults everything else including `h`.

#### `cap` — `{id, m, addM, cv, cvisible, cpv, mr, mx, my, wh}`

The global "cap"/shell: `wh` = default walls height (cm, falls back to `WC.core.wallsHeight` if 0), plus a fallback material for un-zoned walls. Parser `parseCup` (`25990`) defaults `m, mr, mx, my, wh`.

#### `rulers` — `res.rulers = obj.customRulers`

User-drawn dimension rulers (opaque pass-through array).

#### `list_materials` (sibling of `construction`, not inside it)

A **de-duplicated manifest of every material id referenced** anywhere: wall `addM||m` + both plinths, cut/cover/area `addM||m`, cap, and **axis-frame** material ids (`obj.axes.flatMap(a=>a.frames).map(f=>f.addMaterialID||f.materialID)`, `plannercore.js:53634`). This exists so the client can pre-fetch material silhouettes/textures from the catalog by id on load — the material _assets themselves are never stored in the project_, only their ids.

---

### `scene` — placed products + view

Built by `R2D.Scene.makeSceneObjectsData` (`plannercore.js:15113`), parsed by `R2D.SceneParser.parseSceneVersion001` (`plannercore.js:26015`, requires `products` and `viewState`).

```
scene = {
  products: [ ...productShape ],
  groups:   [ ...groupShape ],
  viewState: <opaque camera/view blob>,
  skybox: { id, r /*rotation*/, tags:[] },
  additionalSettings: { showPartialVisibleElements },
  hiddenElements: { objects, walls, covers, groups, bottomPlinths, topPlinths, ceilings, frames, cap, areas, cuts }
}
```

#### `hiddenElements` — object of 11 named id-arrays

Not a flat array of ids — an **object with 11 keys**, each a separate array (init `plannercore.js:13126`, saved verbatim as `hiddenElements: scope.hiddenElements` at `13920`, restored by spread-merge over the defaults at `15551-15557`):
`objects, walls, covers, groups, bottomPlinths, topPlinths, ceilings, frames, cap, areas, cuts`. Elements are ids, **except `groups`** whose elements are **arrays of the group's object ids** (membership compared by `JSON.stringify`).

#### `products[]` — `R2D.Scene.makeSceneObjectData` (`plannercore.js:14862`)

Base fields (all product types):

- `id` — **catalog/model product id** (identifies the model in the catalog; the mesh/geometry is re-fetched by this id, never stored).
- `objid` — per-scene unique **instance** id (stringified). This is the identity used by groups.
- `type` — `R2D.ProductType`: `MATERIAL=1, MODEL=2, POSTER=3, CARPET=4, PLINTH=5` (`plannercore.js:17840`).
- `x, y, z` — position (cm). **`z` is negated on save** (`z: -sceneObject.z`); the loader copies it back verbatim, so the negation is symmetric with the product's own source frame.
- `sx, sy, sz` — scale factors (1 = native).
- `rx, ry, rz` — rotation (deg). **`ry` is negated on save** (`ry: -rotationY`); parser also does `z = -Number(product['z'])` (`26130`) and `product['ry'] = -Number(product['ry'])` (`26137`) on load, mirroring the flip.
- `width, height, depth` — bounding box (cm).
- `isLockedOnScene, visible, partialVisible, plan, userKey, isOwner, externalData, isParametric, configInfo` — flags/metadata (`configInfo` only when parametric).
- **No `name`, no `groupId`** on products. (Name appears only in the estimate export; grouping is via `groups[]`.)

MODEL-only (`type==2`) extra fields:

- `fx, fy, fz` — flip flags (0/1) per axis. Parser reads them as `Number(...)==1` booleans and additionally normalizes negative scales to positive (`26150+`).
- `materials[]` — one entry per material slot: `{current, default, hash, name, source, setId, addMaterial}` (+ `logoParams` for logo meshes). `current` = applied material id, `default` = original; parser back-fills `current` from `default` if absent (`parseProductModelMaterials`, `26175`). `hash` matches the slot to its mesh UV.
- `lightInfo` — written for **any light-source product in the regular save**: the `if (sceneObject.isLight) … data["lightInfo"]` block sits **outside** the `forRender` guard (`~14952-14959`).
- `q` (quaternion, 4 rounded floats), `newUV`/`cubeUV` — **only when `forRender=true`** (render pipeline, not the saved project); `q` is likewise emitted for POSTER/CARPET under `forRender` (`14977-14988`).

**Openings (windows/doors) — `forWall` block** (`plannercore.js:14961`):
An opening is **not a separate entity**; it is a MODEL product with `forWall:true`, which carves a hole in the wall it's mounted on. Extra fields:

- `mf, addMf, mfr, mfx, mfy` — **frame** (top-of-hole reveal) material id / secondary / rotation / offsetX / offsetY.
- `mb, addMb, mbr, mbx, mby` — **bottom-of-hole** material id / secondary / rotation / offsetX / offsetY.
- Parser (`26097+`) reads `mf/mfr/mfx/mfy/mb/mbr/mbx/mby` and defaults them; note the save side additionally emits `addMf`/`addMb` that the parser's explicit checks omit (tolerated as extra keys).

#### `groups[]` — `R2D.Scene.makeSceneGroupData` (`plannercore.js:14992`)

`{objects:[objid...], objectsData:[{...per-object base+MODEL subset...}], x, y, z, r, fx, fz, sx, sy, sz, isLockedOnScene, visible, partialVisible}`. Grouping binds instances by their `objid`; there is no per-product back-reference. Each `objectsData[i]` repeats the product shape. **Competitor bugs here — do not copy:** the `forWall` extras (`mf`/`addMf`/…) are written onto `data.objects[i]` — the array of objid _strings_, so they go nowhere; only `forWall:true` actually lands on `objectsData[i]` (`15097-15108`). And in `objectsData` the `z` coordinate is **not** negated (`15026`), unlike top-level products.

#### `viewState`

Opaque serialized camera/viewer state (`R2D.Viewers.getViewState()`), round-tripped verbatim; restored on load via `R2D.Viewers.setViewState`.

---

### What is stored vs. derived

**Stored:** points (once, with ids), wall/cut/cover/area records referencing point ids, room contours as id lists, product instances (position/scale/rot/materials), material **ids** (not assets), view state, preview JPEG (base64, `toDataURL('image/jpeg')` — см. §envelope `preview`), floorplan tracing image.

**Derived at load (never stored):**

- **Room polygons & triangulation** — rebuilt from referenced points.
- **Wall face orientation** (`faceRight`, per-wall `outer`) — computed from contour winding (`TR.contourArea` sign) during `shortToStructure` (`plannercore.js:54109+`).
- **Areas/rooms membership geometry** — rebuilt via `WC.contourFromPairs` from wall/cut endpoint pairs.
- **Cut heights** — derived from bordering area heights or `cap.wallsHeight`.
- **Wall holes / openings geometry** — recomputed from the `forWall` models via `getHoles()` (`plannercore.js:52990`).
- **Axes & frames** (`WC.Axis` `52086`, `WC.DataFrame` `51889`) — runtime geometry; **not persisted structurally**. Only their material ids leak into `list_materials`; full geometry is emitted only transiently for `forRender`.
- **Model meshes, textures, material silhouettes** — re-fetched from the catalog by `id` after load (`SceneLoader.loadProductsData`), never embedded in the project.

---

### Converters in `WC.convert` (other consumers)

- **`structureToShort`** (`53502`) — canonical **save** converter (structure → compact wire). Inverse: **`shortToStructure`** (`53828`) — rebuilds live `WC.Data*` objects.
- **`structureToApp`** (`53440`) — a **lean** variant for a companion app / AR: only `points {id,x,y}`, `walls {id,pa,pb,contours}`, `rooms {id,points,walls,outer}`, and `cap {wh}`. No materials, no plinths — a pure geometry handoff.
- **`structureToEstimate`** (`54177`) — converts to a **materials estimate**: per-room `{name, area (m²), perimeter (m), wallsArea, width, length}` plus aggregated material-area dictionaries `materialsWall/Floor/Ceiling` and a `plinths[]` list. All areas `/10000` (cm²→m²), lengths `/100` (cm→m). This is the bill-of-materials feed.
- Field copiers `copyWallData`/`copyPlinthData`/`copyCoverData` (`54323+`) — used for style paste, not persistence.

---

### CopyPaste clipboard schema (`R2D.CopyPaste`, `plannercore.js:69206`)

- **Storage:** `localStorage` key `r2d_clipboard` suffixed with the installation key → `r2d_clipboard_<key>` (`R2D.Storage.save`, `17776`; `copyModel`/`copyGroup`/`copyConstruction` write **only** here — `69214`/`69318`). The suffix is **not** a user id: `R2D.Storage.getKey()` (`17761–17774`) reads the query param `key` from the config URL `R2D.URL.URL_SIGN_IN`, i.e. an installation/config key; the same suffix is used for `r2d_token` before login (`16334`). The planner never writes to the OS clipboard: `navigator.clipboard` is used **read-only** in the **inbound OS-clipboard bridge** `checkGlobalClipboard()` (`69405–69420`, external source → planner) — a payload `{action:"copy_to_clipboard", model}` is re-stored locally as `{type:"model", value: model}` and the OS clipboard is cleared with `writeText("")`.
- **Envelope:** every entry is `{type, value}`:

| `type`       | producer                     | `value` shape                                                     |
| ------------ | ---------------------------- | ----------------------------------------------------------------- |
| `'material'` | `copyMaterial` (`69236`)     | material id / object                                              |
| `'logoMesh'` | `copyLogoMesh` (`69241`)     | logo params object                                                |
| `'constr'`   | `copyConstruction` (`69263`) | `{m, mr, mx, my}`; for walls also `conf` = `TConf.Field.toData()` |
| `'model'`    | `copyModel` (`69318`)        | **full product shape** = `R2D.Scene.makeSceneObjectData(obj)`     |
| `'group'`    | `copyGroup` (`69350`)        | **full group shape** = `R2D.Scene.makeSceneGroupData(group)`      |

- **Paste** reads the same shapes: `pasteConstructionTo` (`69279`) copies `m/addM/mr/mx/my` and rebuilds `configData` from `value.conf`; `pasteModel` (`69324`) feeds `value` (or each `objectsData[i]` for groups) back through `R2D.Creator.makeFromLoadedData` — **the exact same deserializer used by scene load**, so clipboard round-trips through the canonical product path.

---

## Geometry rebuild (load → parse → rebuild)

1. **Transport & validation:** `SceneLoader` POSTs by `plan_id` or `plan_hash`, parses response, requires `status=='success'` + `plan`.
2. **Structural validation & defaulting:** `R2D.SceneParser.parse` → `parseVersion001` → `parseConstructionVersion001` (per-entity `parsePoints/Walls/Covers/Cuts/Rooms/Areas/Cup`) + `parseSceneVersion001.parseProducts`. Missing non-critical fields are back-filled by `ProjectMissingDataCorrector` from a defaults table (`plannercore.js:26260`: `mr/mx/my=0, ch=280, wh=280, h=100, m="2013"`, etc.). Missing **critical** keys (ids, `pa/pb`, `points`) fail the parse (return null → error) — except walls, where `parseWalls` returns `[]` and the `==null` caller check passes (see the walls entity above).
3. **Reconstruction:** `WC.convert.shortToStructure` (`53828`) creates `WC.DataPoint/DataWall/DataCut/DataArea/DataCover/DataCeiling/DataCap/DataRoom` objects, populating `dictPoints/dictWalls/dictCuts` keyed by `'k'+id`, and re-links: walls resolve `pa/pb` → point objects; areas/rooms resolve their id lists → objects; entries referencing a missing id are **skipped** (`if (!pt1 || !pt2) continue`).
4. **Derived geometry:** contour winding sets each wall's `faceRight`/`outer`; `WC.contourFromPairs` builds area polygons; cut heights inferred; a legacy fallback (`plannercore.js:54144`) promotes the largest inner room to "outer" for very old plans that stored no outer room.
5. **Async asset hydration:** `SceneLoader.loadProductsData` pre-fetches all product + material ids from `list`/`list_materials`; meshes, textures, and material silhouettes are fetched from the catalog by id and attached; products instantiated via `R2D.Creator.makeFromLoadedData` (`18178`).

---

## Edge cases

- **Forward-compatible versioning:** `R2D.SceneParser.parse` switches on `data['version']`; only `'version_001'` is implemented, and the **`default` case also routes to `parseVersion001`** — so unknown/newer version strings still attempt to load rather than hard-fail. The design intent (per the commented-out `version` fields and the switch shape) is that new formats add a **new `parseVersionNNN` function** while old ones stay, so old projects always load. Backward compat is further reinforced by (a) the missing-data defaulter, (b) legacy `title.visible` bool→object upgrade in `coverFromShort`, and (c) the "very old plans" outer-room fallback.
- **Validation asymmetry:** critical structural keys (ids, endpoints, contour point/wall lists) cause parse failure; cosmetic/material keys are silently defaulted (and a Sentry event is dispatched). `checkSceneDataBeforeSend` re-validates walls/covers/areas right before upload to avoid persisting `null`/`NaN`.
- **Missing referenced ids** are dropped, not fatal — a wall referencing a deleted point is skipped, keeping the rest of the plan loadable.
- **Encoding:** full-scene save double-safety — `encodeURIComponent(JSON.stringify(...))` then a non-encoding `makeParamsString`. The autosave-metadata POST is the exception: raw `JSON.stringify` as the whole body, validated on `status=='ok'`.
- **Coordinate frame flips:** `z` and `ry` are negated on the save side for products; the loader mirrors this, so any tool consuming the raw wire format must apply the same flip.

---

## Confidence & gaps

**High confidence** (read directly from source, exact line numbers): the compact `construction` schema and every entity's field list (`WC.convert.structureToShort`/`wallToShort`/`coverToShort` + the matching `parseConstructionVersion001.*` validators); the id-normalization model and what's derived vs stored; `SceneSaver.save` body shape (`json=` + `autoSave=1`), `SceneLoader.load` by `plan_id`/`plan_hash`, response validation requiring `plan_id`/`status=='success'`; copy/delete/share bodies; product/group/opening (`forWall`) serialization; clipboard `{type,value}` schema. A validation pass confirmed: `lightInfo` saved outside `forRender`; `version` absent from saved envelopes; `conf` is an object; `parseWalls` returns `[]` not null; the group `objectsData` mf/z bugs; the `_<key> (суффикс — installation key из `R2D.Storage.getKey`, не пользователь)` localStorage suffix.

**Medium confidence / gaps:**

- **Endpoint literal paths** — `R2D.URL.URL_SAVE_PLAN / URL_LOAD_PLAN / URL_LOAD_SHARED_PLAN / URL_COPY_PLAN / URL_DELETE_PLAN / URL_SHARE_PLAN / URL_AUTO_SAVE_UPDATE` are referenced as `R2D.URL.*`, but the object is **server-injected at page render** via a template literal — `plannercore.js:24583` reads `R2D.URL = ${JSON.stringify(R2D.URL)}` (values baked in by the backend), so the constants table is absent from the JS bundle. Only the constant names + `POST`/urlencoded/`withCredentials` are confirmed from the bundle itself; literal paths depend on the deploy.
- **`viewState`** and **`extraData`** internal shapes are opaque pass-throughs (not decoded here).
- **Autosave trigger cadence/debounce** — `updateAutoSave` is caller-driven; the change-event wiring and throttle live in the controller (not fully in the two files), so exact trigger frequency is inferred, not proven.
- **`UserAutoSave.updateAutoSave` payload contents** — confirmed it sends raw `JSON.stringify(data)` to `URL_AUTO_SAVE_UPDATE` and checks `status=='ok'`, but the exact `data` fields assembled by its caller weren't visible in `user.js`.
- **`control` on points and `pm` on walls** are always emitted as `0`/`''`; their intended semantics (control-point / mid-marker) are inferred from names.

**Чего не хватает для реализации** (как референс архитектуры схемы док достаточен — id-нормализация, stored-vs-derived, версионирование switch+default, defaulting-pass; не хватает):

1. **`viewState`** — структура камер всех вьюеров не декодирована; свою сериализацию камер проектировать с нуля.
2. **`floorplan`** — transform/scale/позиция подложки в конверте не описаны (механика — в `11-floorplan-import-align.md`).
3. **`materials[]` слота продукта** — форма `{current,default,hash,name,source,setId,addMaterial}` заявлена, но продюсер `getMaterials()` не разобран; стабильную идентификацию material-слотов меша определить самим.
4. **`configInfo` / `lightInfo`** — opaque; своя параметрика/свет = своя схема. `rulers` / `extraData` / `logoSrcList` — opaque pass-through; `pm`/`control` — резерв, не закладывать.
5. **Анти-паттерны конкурента**: валидатор, возвращающий `[]` вместо ошибки; запись в чужой массив (groups); несимметричная negation `z` в группах → negation-слой изолировать в одном converter-модуле, валидация — схемная (zod).
