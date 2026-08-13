# 12 — Catalog & Asset Loading (competitor mechanics)

Reverse-engineered from the competitor's un-minified `plannercore.js` (namespaces `R2D`, `FILE`) and `user.js` (`R2D.UserCore`). Line numbers cite the extracted sources in the scratchpad. This is a functional spec in our own words; short snippets only.

The catalog/asset subsystem is a two-tier pool: **metadata** (`R2D.Pool`, small JSON per product) and **binary 3D payloads** (`R2D.Pool3D`, one file per product). A product is fetched once, cached, and every scene instance reuses the cached data. Everything hangs off a `productId`.

---

## Interaction

### Browse — catalog tree/pages

- `R2D.UserCore.RightPanelData.load(url, country)` (user.js:2138) is the generic panel/tree fetch. It POSTs to `R2D.makeURL(DOMAIN, url)` via `R2D.XHRLoader.getPostLoader(...)`. When `country` is passed it adds an **`x-country` header** (user.js:2142-2145) — geo-scopes which catalog items/prices are returned. Response must be JSON with `status == "success"`; resolves `{status, data:{...}}` or `{type:"error", data:"TEXT_ERROR_LOAD_DATA"}`. Single-flight: guarded by `if (loader) return`, one request at a time per instance; `.close()` aborts.
- Public wrapper: `user.loadRightPanelData = (url, country) => uRightPanelData.load(url, country)` (user.js:162).

### Search

- `R2D.UserCore.UserSearch.getSearchResult(query)` (user.js:511): GET `URL_CATALOG_SEARCH + "&query=" + searchQuery` (user.js:515), `credentials`-style auth via loader; expects `status == "ok"`.
- `URL_CATALOG_SEARCH` is also the **product-metadata endpoint** (see Pool below), the **skybox endpoint** (`+ "&category_tag=skybox"`), and the **tag endpoint** (`+ "&category_tag=" + tag`). One endpoint, different query params, is the whole catalog read API.
- Tag-based bulk metadata load: `R2D.Pool.loadProductDataByTagsArr(tags)` (plannercore.js:17979) fetches `URL_CATALOG_SEARCH + "&category_tag=" + tag` per tag with headers `x-token`, `x-lang` (plannercore.js:17992-18002) and folds all results into `R2D.Pool`.

### Favorites (`R2D.UserCore.UserFavorites`, user.js:552)

- `getList()` — GET `URL_FAVORITES_GET`; filters null items: `object.data.items = object.data.items.filter(i => i)` (user.js:590).
- `addToFavorites(id, color)` — **PUT** `URL_FAVORITES_ADD.replace("{id}", id)` (user.js:602,614); optional body `{add_data: color}`. On success mutates local cache: `++user.data.favorites.total; items.push(object.data)` (user.js:636-639).
- `removeFromFavorites(id, color="")` — **DELETE** `URL_FAVORITES_DELETE.replace("{id}", id)` (user.js:652,664); body `{add_data: color}`. Local cache: decrements total and filters by both `id` and `color`/`addData` (user.js:685-688). The `color`/`add_data` field means the same product can be favorited multiple times with different color variants.

### Pagination

- Projects: `UserProjects.load(limit=0, offset=0)` → `URL_LOAD_ALL_PLANS + "&limit=&offset="` (user.js:1118-1122).
- Renders: `UserRenders.load(limit=20, offset=0)` → `URL_RENDER_ALL + "&limit=&offset="` (user.js:1298-1300). Simple limit/offset query params; server returns `{data:{items, total}}`.

### Skyboxes / panoramas

- `R2D.UserCore.UserPano.load()` (user.js:1058): GET `URL_CATALOG_SEARCH + "&category_tag=skybox"`, resolves `object.data.items` (user.js:1098). Panoramas are just catalog products tagged `skybox`; `R2D.ProductDataLoader` supports a `type=="pano"` mode that appends the same tag (plannercore.js:22979).

### Upload (see Client-side package creators)

Two distinct upload paths: (a) **procedural packages** (material/poster/carpet/OBJ-model) built client-side into the `ROOMTODO` binary and POSTed as base64 to `URL_UPLOAD_PRIVATE`; (b) **raw glTF/GLB user models** zipped and multipart-POSTed to `URL_UPLOAD_FILE`.

### Delete

- `RightPanelData.deleteMaterial(params)` (user.js:2187): POST `URL_DELETE_PRIVATE`; on success fires `user` `UPDATE` event (user.js:2201). Generic "delete my private product".

---

## Data model

### `R2D.ProductType` (plannercore.js:17836-17868)

`MATERIAL=1, MODEL=2, POSTER=3, CARPET=4, PLINTH=5`. Note the binary package `type` int32 uses the same 1–4 codes.

### `ProductData` (metadata, lives in `R2D.Pool`)

Parsed from `URL_CATALOG_SEARCH` JSON `data.items` by `R2D.ProductDataParser.parseJSON` (plannercore.js:17948). Key fields observed in use:

- `productId` — pool key (`addProductData` refuses entries without it, plannercore.js:17889).
- `type` — one of ProductType.
- `source.body.package` — **relative URL of the binary payload** (the `.mrtd`/`.prtd`/`.crtd` "ROOMTODO" file, or a `.glb`).
- `isGLTF` — derived, not stored server-side: `productData.isGLTF = source.body.package.endsWith(".glb")` (plannercore.js:11593, 11835, 12067). This flag switches the entire load/rebuild path (glTF vs custom binary).
- `property.appointment` (wall vs floor), `property.sizes.{width,height,depth}` (used by poster/carpet mesh build), `tags`.

### `R2D.Pool` — metadata pool (plannercore.js:17873)

- `_products_data = {}` (id → ProductData), `_loaders_products_data = {}` (id → in-flight loader).
- `isProductData(id)` / `getProductData(id)` — cache read (plannercore.js:17880-17887).
- `loadProductData(productId, type)` (plannercore.js:17957): **dedupes in-flight** — if a loader already exists for that id, returns it; otherwise creates one `R2D.ProductDataLoader`, registers it in `_loaders_products_data`, and on COMPLETE parses JSON, asserts `status ∈ {ok, success}` and a `data` field, then `addProductData` for each parsed item (plannercore.js:17948-17951). Errors are logged, not thrown.
- `R2D.ProductDataLoader.load(productId, type)` (plannercore.js:22971): GET `URL_CATALOG_SEARCH + "&ids=" + productId` (comma-joined if array); appends `&category_tag=skybox` when `type=="pano"`. So **product metadata is fetched by the same search endpoint filtered by `ids`**.
- `removeProductData(id)` frees the metadata entry (plannercore.js:17972) — used during material GC (plannercore.js:23193) to drop products no longer referenced by any scene object.

### `R2D.Pool3D` — binary/glTF pool with a single-flight queue (plannercore.js:36011)

State: `__queue=[]`, `__exist={}` (queued/in-progress guard), `__loaded={}` (done flag), `__data={}` (parsed payload), `__currentProductId/__currentProductData`, plus an `EventDispatcher`.

- `load(productId)` (plannercore.js:36149): no-op if already `__loaded` or already `__exist`; else marks `__exist[id]=true`, pushes to `__queue`, calls `__checkLoad()`.
- `__checkLoad()` (plannercore.js:36088): the **sequential single-flight driver**. Returns early if `__currentProductId != null` (one load at a time). If queue empty, dispatches `COMPLETE(null)`. Else takes `__queue[0]`, looks up its metadata in `R2D.Pool` (needs it for the URL + glTF flag). If metadata missing → shift, `ERROR`, recurse. Otherwise builds `url = makeURL(DOMAIN, productData.source.body.package)`, sets `__current*`, and branches:
  - **glTF** (`productData.isGLTF`): `new THREE.GLTFLoader().load(url, __GLTFLoadListener)` (plannercore.js:36126-36129).
  - **binary**: `new R2D.XHRLoader().load(url, ..., "GET", ..., "arraybuffer", false)` — raw ArrayBuffer (plannercore.js:36131-36134).
  - Dispatches `START(productId)`.
- `__loaderEventHandler` (binary complete, plannercore.js:36024): clears `__current*`, `__queue.shift()`, deletes `__exist[id]`; on COMPLETE stores `__data[id]=loader.data` (the ArrayBuffer), `__loaded[id]=true`, dispatches `FINISH(id)`; else `ERROR(id)`. Then `__checkLoad()` to advance the queue.
- `__GLTFLoadListener(gltf)` (plannercore.js:36055): same queue bookkeeping; **pre-processes the parsed scene** — `traverse` all meshes: `obj.castShadow=true`, force `map.encoding`/`normalMap.encoding = LinearEncoding`, and zero `metalness` for POSTER products (plannercore.js:36065-36079). Stores the whole `gltf` object in `__data[id]`; `FINISH(id)`.
- `getData(id)` → `__data[id]` (ArrayBuffer for binary, gltf object for glTF). `clearData(id)` deletes `__data`+`__loaded` (plannercore.js:36175) — the raw payload is intentionally dropped after the first instantiation to free memory (see Geometry rebuild).
- `isLoaded(id)` gate is checked before every `load` (plannercore.js:36143).

### `R2D.PoolMaterials` — shared THREE.Material pool (plannercore.js:36182)

- `__materials = {}` keyed by productId (or `initMaterialId`, or a `#color`).
- `getMaterial(productId, addMaterial)` returns the cached `R2D.ObjectViewer3D*Material` or `create()`s one (plannercore.js:36232). `#`-prefixed ids create an `ObjectViewerColorMaterial` (solid color) instead of a textured one (plannercore.js:36201-36203).
- `remove(id)` is the **dispose discipline**: explicitly `.dispose()`s every texture slot (`map, lightMap, bumpMap, normalMap, specularMap, envMap, alphaMap, aoMap, displacementMap, emissiveMap, gradientMap, metalnessMap, roughnessMap`) then the material itself, then deletes the pool entry (plannercore.js:36210-36230). This is the canonical GPU-leak-avoidance pattern to copy.

### `R2D.ObjectViewer3DModel.__geometriesRAW` (plannercore.js:32899)

A **third pool**: `{ productId → parsedModelData }` holding the CPU-side geometry arrays (vertices/uvs/normals/indices) for custom-binary (non-glTF) models, so that additional instances can rebuild `THREE.BufferGeometry` without re-downloading.

### The binary product package format (`ROOMTODO`)

Parser: `R2D.ProductPackageParser` (plannercore.js:26737). Written by `R2D.ProductPackageCreator.*` (plannercore.js:71581). All multi-byte values are **big-endian DataView defaults** (`getInt32`/`getFloat32` with no littleEndian arg).

**Header (fixed 12 bytes):**

| offset | bytes | meaning                                                                                |
| ------ | ----- | -------------------------------------------------------------------------------------- |
| 0      | 8     | ASCII magic `"ROOMTODO"` (`MARKER_ROOMTODO`, plannercore.js:26741)                     |
| 8      | 4     | int32 **type**: 1=material, 2=model, 3=poster, 4=carpet                                |
| 12     | 4     | int32 **version** (material v2, model v3, poster/carpet v1 as written by the creators) |

`parse(arrayBuffer)` (plannercore.js:26764) reads magic (bail → null if mismatch), reads `type = getInt32(8)`, and dispatches to `parseMaterial`/`parseModel`; **poster(3) and carpet(4) are disabled in the top-level `parse`** (`return null`, plannercore.js:26776-26777) — they are only parsed on-demand by the poster/carpet scene viewers directly (`parsePoster`/`parseCarpet`, plannercore.js:33050, 33268).

**Body = flat sequence of `[int32 tag][payload]` records** consumed until `offset >= byteLength`. Tag → field mapping:

_Material (type 1, `parseMaterial` plannercore.js:26784)._ After header, loops tags:

- 10/11 defaultWidth/Height (int32), 12/13 currentWidth/Height (int32), 14/15 scaleX/scaleY (float32).
- 20 scalability, 21 transparent, 22 gloss, 23 metal (each **1 byte**, `== 1`).
- 30/31 intensityGloss/intensityMetal (float32, NaN→0), 60 materialType (int32), 61 materialReflectivity (float32, NaN→0).
- 50/51/52 diffuse/specular/normal **texture blobs**: each is `[int32 len][len raw bytes]`, copied out via `readData` into a fresh ArrayBuffer (plannercore.js:26753, 26917-26936). These are the encoded image files (JPEG/PNG), later turned into `THREE.Texture` via `R2D.Tool.arrayBufferToImage` (Blob→objectURL, plannercore.js:29254-29267).
- Unknown tag → `console.warn`, but note there is **no length-skip for unknown tags**, so an unrecognized tag desyncs the stream (edge case).

_Model (type 2, `parseModel` plannercore.js:26947)._ `modelData = {type, version, geometries:[], contourCut}`. Tags:

- **10 = geometry list**: `int32 count`, then for each geometry an ASCII `"BEGIN"` marker (plannercore.js:26996), an inner `[int32 tag][payload]` loop terminated by ASCII `"END"`:
  - 20 vertices: `int32 vcount`, then `vcount * 3` float32 (x,y,z).
  - 21 uvs: `int32 count`, then `count * 2` float32.
  - 22 normals: `int32 count`, then `count * 3` float32.
  - 23 indices: `int32 count`, then `count` **uint32**.
  - 30 md5: exactly **32 ASCII chars** (geometry hash for dedup).
- **50 = contourCut**: `int32 count`, then `count * 2` float32 (2D cut contour for wall models).
- **Version migrations** run after parse: `version==1` flips geometries by Z (`R2D.Tool.flipGeometriesByZ`, plannercore.js:27119); `version<3` recomputes missing md5 via `R2D.OBJParser.getGeometryMD5` (plannercore.js:27125-27132). Copyable pattern: version-gated fixups on load.

_Poster (type 3, `parsePoster` plannercore.js:27139)._ Body tag 10 = embedded **material sub-package**: `[int32 len][len bytes]` → recursively `parseMaterial(sub.buffer)` (plannercore.js:27185). So a poster is "a material + poster sizes from metadata".

_Carpet (type 4, `parseCarpet` plannercore.js:27192)._ Tag 10 = embedded material sub-package (same recursion); tag 20 = `carpetType` int32 (1=square, 2=round).

---

## Geometry rebuild (instantiate into scene)

### Catalog item → placeable `SceneObject`

1. UI drops a catalog product (has metadata) → `R2D.Creator.makeSceneObject(productData, color)` (plannercore.js:18035) switches on `productData.type`:
   - MATERIAL → `R2D.SceneObjectMaterial`; MODEL → `R2D.SceneObjectModel`; POSTER → `SceneObjectModel` if the package is `.glb` else `SceneObjectPoster`; CARPET → `SceneObjectCarpet` (plannercore.js:18037-18056).
2. From a **saved project**, `R2D.Creator.makeFromLoadedData(dataProductsObjects)` (plannercore.js:18178) first ensures metadata: `R2D.Pool.isProductData(id)` else `loadProductData(id)`, then on COMPLETE builds the SceneObject and copies transform (`x,y,z,sx,sy,sz,rx,ry,rz,fx,fy,fz`), visibility, lock, lightInfo, externalData (plannercore.js:18184-18229). Metadata-first, geometry-lazy.
3. The `SceneObjectModel`'s 3D viewer triggers `R2D.Pool3D.load(id)` if `!isLoaded`, listening for `FINISH`/`ERROR` (plannercore.js:25012-25021, 32885-32891). On `FINISH` for the right id → `productIsLoaded()`.

### `productIsLoaded()` — the rebuild (plannercore.js:32630)

Clears existing children, then three branches:

**A. `configType === "meshReplace"` or `isGLTF`** (plannercore.js:32636, 32666): read `gltf = R2D.Pool3D.getData(id)`; **clone** the scene's mesh children and clone each geometry (`data.scene.clone().children`, `el.geometry.clone()`, plannercore.js:32675-32687) so each scene instance owns its own geometry while sharing nothing mutable back into the pool. Add children to `object3d`. Collect `geometriesHash` from `mesh.userData.md5`. Detect parametric models, then `updateUV()`, `updateGeometry()`, dispatch `MODEL_LOADED`, `updateMaterials()`. Extra: builds a 2D plane proxy if the mesh has an SVG name or is for-wall (plannercore.js:32711-32732), wires light/shadow/logo editors.

**B. custom binary model** (else branch, plannercore.js:32763): if `__geometriesRAW[id]` exists reuse it; else `raw = R2D.ProductPackageParser.parseModel(R2D.Pool3D.getData(id))`, **immediately `R2D.Pool3D.clearData(id)`** (drop the ArrayBuffer) and cache `raw` in `__geometriesRAW[id]` (plannercore.js:32764-32772). Then for each raw geometry create an empty `THREE.BufferGeometry` + `THREE.Mesh` with the shared default material (`DoubleSide`, cast+receive shadow), add to `object3d`, push `raw.geometries[i].md5` to `geometriesHash` (plannercore.js:32776-32789). `updateGeometry()` fills the actual attributes.

### `updateGeometry()` for custom-binary models (plannercore.js:32598)

Reads `raw = __geometriesRAW[id]`, optionally `flipGeometriesByX/Z` per `sceneObject.flipX/flipZ`, then `R2D.Tool.makeModelGeometries(geometriesRaw)` → array of `THREE.BufferGeometry` and assigns `mesh.geometry = geometries[i]` for each child (plannercore.js:32599-32621).

### `R2D.Tool.makeBufferGeometry(index, vertex, uv, normal)` (plannercore.js:28984)

The primitive rebuild: `setIndex(Uint32Array)`, `position` (Float32, itemSize 3), `uv` (Float32, itemSize 2), `normal` (Float32, itemSize 3) — and if no normals supplied, `computeVertexNormals()`. Always `computeBoundingBox()` + `computeBoundingSphere()` (plannercore.js:28987-29004). `makeModelGeometries` just maps this over the raw array (plannercore.js:29231).

### Posters/carpets at runtime

`R2D.ObjectViewer3DPoster` caches per-product in `__poolPoster`; on miss it reads `parsePoster(Pool3D.getData(id))`, builds face+box `MeshPhongMaterial`, applies diffuse/normal/specular textures via `arrayBufferToImage` + `makeTextureMap`, then `Pool3D.clearData(id)` (plannercore.js:33044-33081). Geometry (face/box) is generated from `property.sizes` in metadata, not from the package. Carpet is analogous (`__poolCarpet`, square vs round from `carpetType`).

---

## Client-side package creators (uploads)

### Material / Poster / Carpet (image-based) — `R2D.CustomUploader`

Flow (e.g. `uploadPoster`/`uploadMaterial`, plannercore.js:293-360, 515-589):

1. A preview is scaled to a small canvas (`prevSize=240`, `toDataURL`).
2. `new R2D.MaterialCreator()` / `PosterCreator` / `CarpetCreator` is wired; caller sets `diffuse = srcFile` and `setMaterialSizeCM(w,h)`; `createData()` fires.
3. Internally `R2D.MaterialCreator` composes `MaterialSetting` + `MaterialTexturesManager` + `MaterialMaker` + `MaterialScene`, and a `R2D.ProductPackageCreator.Material` (plannercore.js:72541-72547). On completion it hands a `ByteArray` **`package`**.
4. `packageCompleteListener` reads the package `Blob` as a data-URL (`FileReader.readAsDataURL`), and POSTs to **`URL_UPLOAD_PRIVATE`** a form-encoded body: `{type_id, source: <base64 of ROOMTODO bytes>, preview: <base64 png>, width, height[, depth][, category_id | material_bank_category_id]}` (plannercore.js:334-352, 554-575). `type_id` ∈ `R2D.CustomUploader.UPLOAD_*` (`1` wall-mat, `5` floor-mat, `3` poster, `4` carpet, `6` color-picker, `7` model-material, plannercore.js:594-599).

### The binary writers — `R2D.ProductPackageCreator.*` (plannercore.js:71586-71897)

Each builds a `ByteArray`, writes the body records, then prepends the 8-byte `"ROOMTODO"` magic + `int32 type` + `int32 version` + body, and `dispatchComplete(byteArray)`:

- **Material** (plannercore.js:71604): writes tags 10–15 (sizes/scale), 20 (realSize→scalability), 21 (transparent), 60 (materialType), 61 (reflectivity), then 50/51/52 diffuse/specular/normal each as `[int32 tag][int32 len][bytes]`. Header type=1, version=2.
- **Model** (plannercore.js:71685): tag 10 + geometry count; per geometry `"BEGIN"`, then 20 vertices (`len = vertices.length/3`), 21 uvs (`len/2`), 22 normals (`len/3`), 23 indices (uint32), 30 md5 (32 chars), `"END"`. Header type=2, version=3. **This is the exact inverse of `parseModel`.**
- **Carpet** (plannercore.js:71809): tag 20 shape (1 square / 2 round), tag 10 embedded material sub-package `[int32 len][bytes]`. Type=4, v1.
- **Poster** (plannercore.js:71870): tag 10 embedded material sub-package. Type=3, v1.

### OBJ user model upload — `R2D.OBJParser` + `R2D.ModelCreator`

- `R2D.ModelCreator.loadOBJ(file)` reads the file as a binary string (`FILE.loadFileAsBinaryString`, plannercore.js:75211) then `parseOBJ(string)`.
- `R2D.OBJParser` (plannercore.js:25361) parses OBJ into interleaved arrays and runs `simplifyGeometry()` which **de-duplicates vertices**: an 8-level nested `pool[vx][vy][vz][u][v][nx][ny][nz]` lookup collapses identical position+uv+normal tuples into shared indices, building `indices/vertices/uvs/normals`, bounds, `totalTriangles`, and an md5 (plannercore.js:25379-25469).
- **Geometry MD5**: `R2D.OBJParser.getGeometryMD5(indices, vertices, normals, uvs)` = `md5(indices.join(",") + vertices.join(",") + normals.join(",") + uvs.join(","))` (plannercore.js:25631-25640). Used for (a) rejecting duplicate elements in `ModelCreator.parseOBJ` (`if elements[i].geometry.md5 == parser.geometry.md5 → ELEMENT_EXIST`, plannercore.js:75167-75172), and (b) instance/material hashing at runtime (`geometriesHash`, `userData.md5`).
- On save, `ModelCreator` feeds its `elements` to `R2D.ProductPackageCreator.Model.create(elements)` (plannercore.js:74974, 75285-75286), captures the resulting bytes (`getBytesRange()`), and additionally computes `contourTop`/`contourCut` via `WCT.makeContour(...)` (plannercore.js:75037-75046). The ROOMTODO-model bytes then follow the same base64 → `URL_UPLOAD_PRIVATE` upload as materials.

### Raw glTF/GLB user upload

Distinct from the procedural path: user glTF assets are zipped (`JSZip`, DEFLATE level 9) and multipart-POSTed to **`URL_UPLOAD_FILE`** with headers `x-token`, `x-lang` and a `FormData` field `"models.zip"`; the server returns `data.modelsZip` (a URL) which becomes the product's `source.body.package` (plannercore.js:40683-40718). Logo images use the same `URL_UPLOAD_FILE` endpoint with field `logoImg` (plannercore.js:18424-18443). Metadata for user glTF products then flows through the normal `URL_CATALOG_SEARCH?ids=` path and `.glb` sets `isGLTF`.

### glTF decoders (DRACO / KTX2 / meshopt)

The bundled `THREE.GLTFLoader` (plannercore.js:3282) supports `setDRACOLoader` / `setKTX2Loader` / `setMeshoptDecoder` (plannercore.js:3391-3411), throwing if a compressed asset is loaded without the matching decoder registered. In the **model-preview viewer**, a `THREE.DRACOLoader` is attached with `setDecoderPath("/src_designer/js/draco/")` (plannercore.js:20881-20883). Note: the main `R2D.Pool3D.__checkLoad` glTF path (plannercore.js:36126) instantiates a bare `GLTFLoader` **without** DRACO/KTX2/meshopt registered — so pool-loaded catalog `.glb` are expected uncompressed, while the standalone preview path handles DRACO. (Gap: KTX2/meshopt loaders are present in the bundle but no `set*` call was found in the extracted regions.)

---

## Edge cases

- **In-flight dedup, two tiers.** `Pool.loadProductData` returns the existing loader for a pending id (plannercore.js:17959-17961); `Pool3D.load` guards on both `__loaded` and `__exist` (plannercore.js:36150-36165). Prevents duplicate network calls for the same product hammered from many placements.
- **Pool3D is strictly sequential.** Only one 3D download decodes at a time (`__currentProductId` gate). Simplifies GLTFLoader worker contention but is a throughput bottleneck for large catalogs.
- **Raw payload dropped after first build.** `clearData(id)` runs right after `parseModel`/`parsePoster`/`parseCarpet` (plannercore.js:32770, 33081); subsequent instances rely on `__geometriesRAW`/`__poolPoster`/`__poolCarpet`. If those secondary caches are also cleared, re-instantiation forces a re-download.
- **Big-endian, DataView defaults.** All int32/float32 reads/writes omit the littleEndian flag → big-endian. Any reimplementation must match.
- **Unknown material tag desyncs.** `parseMaterial`'s default case only warns; without a per-tag length it cannot skip → a future/unknown tag corrupts the rest of the stream. Model/poster/carpet loops silently ignore unknown outer tags (no offset advance guarantee either).
- **`type != 1 && type != 2` accepted by `parseMaterial`** (plannercore.js:26822) — material parser tolerates type 2 (legacy), a quirk to preserve if reading their historical data.
- **Version fixups on model load** (Z-flip for v1, md5 backfill for v<3) — must run to keep old catalog data usable (plannercore.js:27116-27133).
- **Geometry count vs mesh children mismatch** only warns, then rebuilds `min(len)` (plannercore.js:32605-32617) — tolerant to partial/edited models.
- **Favorites carry a `color`/`add_data` variant key** — same productId favorited in multiple colors; delete must match both id and color (plannercore.js:687).
- **`x-country` scopes the catalog** — the tree/panel fetch is geo-aware; without it the server presumably returns a default region.
- **Missing metadata aborts a 3D load** — `Pool3D.__checkLoad` drops the queue item and emits ERROR if `Pool.getProductData(id)` is null (plannercore.js:36103-36118); the 3D pool depends on the metadata pool being populated first.

---

## Confidence & gaps

**High confidence:** the `ROOMTODO` header layout and all four body-record tag maps (parser and creator are mirror images and cross-check exactly); the two-tier `Pool`/`Pool3D` caching + sequential single-flight queue; `PoolMaterials` dispose discipline; OBJ vertex-dedup + md5 formula and duplicate-rejection; the `URL_CATALOG_SEARCH` "one endpoint, many query params" model; favorites PUT/DELETE with `add_data` color; the material/poster/carpet/OBJ-model → base64 → `URL_UPLOAD_PRIVATE` upload path; the glTF vs custom-binary rebuild branches and `__geometriesRAW` reuse.

**Medium confidence:** exact server JSON shape of `ProductData` (inferred from field accesses, not from a schema); which DRACO/KTX2/meshopt decoders are wired where (DRACO confirmed only on the preview viewer, not the Pool3D path).

**Gaps / not found in extracted regions:** the literal string values of the `R2D.URL.URL_*` constants (endpoints referenced by name only — their definitions live in a config file not in these two sources); server-side handling/validation of uploads; where KTX2/meshopt `setKTX2Loader`/`setMeshoptDecoder` are actually invoked (present in the bundle, no call site seen); pagination `total`/response envelope for catalog search beyond `data.items`; the `PLINTH` (type 5) asset pipeline (declared but no package parser/creator for it here).
