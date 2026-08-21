# Competitor Mechanics — Rooms / Floors / Ceilings / Areas & Room-Detection Pipeline

Reverse-engineered from an un-minified competitor room-planner core (`plannercore.js`, ~81k lines). Namespaces: `WC` = walls constructor, `TR` = 2D geometry/triangulation, `R2D` = scene. All line numbers cite that file. This is an implementation-ready functional spec in our own words; snippets are evidence only.

> **Core mental model.** The planner does **not** store rooms as explicit polygons that the user draws. The user draws _wall centerlines / cover outlines / area polygons_; the system then **triangulates the whole plan, flood-fills triangle groups across non-fixed edges, and traces the outer contour + holes of each group** to _derive_ rooms and covers. Every geometric edit re-runs this whole pipeline. Rooms are emergent; covers (floors) are auto-generated inside rooms; ceilings hang off covers/areas; plinths/connectors/cuts are structural derivatives generated per-wall/per-area.

---

## 1. Data model

### Coordinates & units

- Plan coordinates are floats in centimeters (default wall height `WC.DEFAULT_WALLS_HEIGHT = 280`, default low-area height `WC.DEFAULT_AREA_HEIGHT = 100`; L51617+, L59320-59321).
- Point types are tagged: `WC.ROOM_POINT = 'rp'`, `WC.COVER_POINT = 'cp'` (L56807-56808). Room points and cover points are separate arrays but get _linked_ (see Cover point sharing, §5).

### Core container: `WC.WallsCore` / `WC.core` (L59323)

Holds the entire scene structure:

- `arrRooms` — derived room contours (`WC.CRoom`).
- `arrCovers` — floor polygons (`WC.CCover`).
- `arrAreas` — low-ceiling zone polygons (`WC.CArea`).
- `roomPoints`, `coverPoints` — flat point pools.
- `walls`, `cuts` — per-side derivatives.
- `relatedCovers` — scratch list during cover merging.
- `wallsHeight` — global default height applied to new covers/areas.

### `WC.CContour` base (L56890) — shared by CRoom/CCover/CArea

Fields: `outer` (bool: is this an outer contour or a hole), `points[]`, `holes[]`, `triangles[]` (cached per-contour triangle list), `area`.

- `addPoint`/`addPointAt` set `point.contour = me` (L56900-56910) — a point knows which contour owns it.
- `calcArea()` (L56918): signed shoelace area over `points`. **Sign matters** — negative area = clockwise winding, used to detect holes and to normalize orientation.

### `WC.CRoom` (L56946)

Thin subclass of CContour. Carries a free-form `data` object (persisted room attributes: name, material, etc.), re-attached after each rebuild by area-overlap matching (§2).

### `WC.CCover` (floor) (L56965)

Subclass of CContour with a rich default `data` object including a nested `ceiling` block:

- `data.materialID/addMaterialID/materialRotation/materialX/materialY` — floor material.
- `data.exists/visible/partialVisible` — floor visibility.
- `data.ceiling = {exists, visible, partialVisible, isHiddenByInstrument, height, materialID, addMaterialID, material shift/rotation}` (L56987-56999). Ceiling defaults `height = WC.DEFAULT_WALLS_HEIGHT`.
- Accessors: `getCeilingHeight/setCeilingHeight/getCeilingVisible/setCeilingVisible` (L57003-57021) — a cover _owns_ its ceiling; there is no separate ceiling object array at the CCover level.

### `WC.CArea` (low-ceiling zone) (L57027)

Subclass of CContour, always `outer=true`. Has own `height = 100` (the drop-ceiling elevation of the zone) plus the same nested `ceiling` `data` block. Points carry `point.areas[]` (a point can belong to several areas). Key methods:

- `getAllPairs()` (L57085): every consecutive point pair of the area polygon, closed — fed to triangulation as **cut pairs** (fixed edges that split rooms).
- `getCutWallPairs()` (L57098): classifies each area edge as a _cut_ (crosses interior — endpoints not adjacent on the same contour) vs _wall_ (coincides with a real room side). Used to reject areas that cross room walls.
- `getHeight/setHeight`, `getCeilingHeight/setCeilingHeight/setCeilingVisible`.

### Data-* render objects (3D build payloads, one per structural element)

These are the objects the 3D scene actually renders; each has `build3D()` producing `parts[].vertices/uvs/indices/triangles/area` via a shared `WC.DataObject` base (L51212) that also handles material get/set, material rotation/shift, and `addNullData()` (emits a degenerate triangle so empty elements still have valid buffers, L51397).

- `WC.DataCover` (L51725): floor. `build3D` (L51742) walks `triangles`, sums `TR.triangleArea`, calls `WC.findTriCover(a,b,c, 0, false, …)` per triangle (z=0 plane), computes bbox-center `rotatingCenter`, and mirrors that center to `me.ceiling`.
- `WC.DataCeiling` (L51789): ceiling. Same as cover but `WC.findTriCover(a,b,c, me.height, true, …)` — extruded to `height`, flipped normal (`true`). `height` defaults `WC.DEFAULT_WALLS_HEIGHT`. Has `visible/exists/partialVisible/isHiddenByInstrument`.
- `WC.DataArea` (L51617): low-area cap. `build3D` (L51635) extrudes triangles to `me.height` via `findTriCover(...,me.height,false,...)`; owns an optional `ceiling`.
- `WC.DataCut` (L51682): a vertical "cut" surface (the wall face created where an area/opening slices a room). `build3D` builds 2 triangles between `point1..point2` from `low` to `height` via `WC.findTriWall`. `area = dist(point1,point2) * (height - low)`.
- `WC.DataPlinth` (L51436): skirting (`bottomPlinth`) or crown molding (`topPlinth`) — see §7.
- `WC.DataPlug` / connectors — see §7.

---

## 2. Room-detection pipeline (the heart)

### Trigger

Any geometric edit ends by calling `WC.core.rebuildWallsAndCovers()` (L59533). It is called from every mutation state: drag point/wall/room, make walls, delete, paste, area/cover edits, etc. (dozens of call sites: L60776, L61598, L64037, L65108, L66680, L70155, …). So **the room graph is fully recomputed on every commit**, not incrementally patched.

### `rebuildWallsAndCovers()` orchestration (L59533)

Ordered steps:

1. `delIntersectedAreas()` — drop areas whose _cut_ edges cross any room wall (L60101).
2. `roundAllPoints()` — snap every room/cover point to a 0.001-unit grid (L59552).
3. `rebuildWalls()` — re-derive rooms from wall centerlines (L59582).
4. `rebuildCovers()` — re-derive covers constrained to rooms (L59909).
5. `findAutoCovers()` — auto-fill floors inside rooms not already covered (L59714).
6. `connectAllPoints()` — link cover points onto coincident room points (L60285).
7. `findCoverHoles()` — assign inner covers as holes of outer covers (L60406).
8. `findAllCoverTriangles()` — retriangulate each cover with its holes (L60450).
9. reset snap tool + redraw.

### Grid rounding (`TR.roundCoord`, L50554)

```js
return new TR.Point(Math.round(P.x * 1000) / 1000, Math.round(P.y * 1000) / 1000);
```

→ snaps to **1/1000 unit (0.001 cm)**. This is the numeric-stability guard that makes coincident points _exactly_ equal so triangulation merges them. Applied to all room+cover points before triangulation.

### `rebuildWalls(addPairs)` (L59582) — derive rooms

1. **Reject overlapping areas**: pairwise `TR.compareContours` on all areas; any pair that is not `OUTSIDE` and not `CONTACT` marks the later area `bad` and deletes it (L59587-59602).
2. Split rooms into `outerContours` / `innerContours` by `room.outer`.
3. Build `cutPairs` = `addPairs` (optional) + every area's `getAllPairs()` — area edges become forced-fixed segments in the triangulation (L59620-59626).
4. Keep `oldRooms = me.arrRooms` for attribute re-attach.
5. `TR.rebuildContours(outer, inner, [], [], cutPairs, false)` → `[outerContours, innerContours, outerGroups]` (L59630).
6. Rebuild `me.arrRooms` from index-form contours: for each outer contour create `new WC.CRoom(true)`, add `CPoint`s from `TR.points[idx]`; skip if `!TR.contourValid(room.points)` (L59635-59650). Attach the group's triangle list (`newContours[2][i]`) as `room.triangles` — **cached per-room triangulation** (L59654-59662).
7. Repeat for holes → `new WC.CRoom(false)` (L59667-59686).
8. **Re-attach old attributes by area-overlap** (L59690-59701): for each new room, find an old room with same `outer` flag whose polygon `TR.compareContoursByArea(...) == INTERSECT`; copy `data`. This is how a room keeps its name/material after the user edits a wall.
9. `sortRooms()`, then `resetWalls()` / `resetAreas()` / `resetCuts()` (re-derive per-side objects from the new room polygons), then `findAreasTriangles()`.

### `TR.rebuildContours(...)` (L51094) — the triangulate→group→trace core

1. Optionally `TR.filterContours` each input set (`TR.clearContour` removes degenerate/collinear points, L50913).
2. `TR.triangulateContours(outer, inner, bound, subtr, cutPairs)` (L50926): builds a segment graph — deduped points (match within `TR.L_EPS = 1e-8`, L50939) and deduped edges, adds all contour edges + `cutPairs`, then `TR.resplitSegments` (splits crossing/overlapping segments at intersections), `imported_clean_graph`, and finally a constrained Delaunay `TR.triangulate`. Produces `TR.groupedTriObjects`, plus `fillTrs`/`holeTrs` classification and `TR.fillGroups`.
3. `TR.groupTriangles(trs, separateByFixedEdges)` (L50692) — **flood fill**. Iterative DFS (`checkTriangle`): starting from an unvisited triangle, recurse across each shared edge into the neighbor triangle **unless** the edge is `fixed` and we're separating by fixed edges, or the edge is a boundary (`edges.length <= 1`). Each connected component becomes one group = one candidate room/cover region. `separateContacting=true` (used for covers) makes fixed edges act as walls between touching regions.
4. `TR.contoursFromGroup(group, onlyFixedEdges, findInner)` (L50738) — **contour tracing** of a triangle group (line-by-line algorithm: [`deep-dives/03-contour-tracing.md`](deep-dives/03-contour-tracing.md)):
   - Builds an adjacency dict of point→neighbors using only `fixed` edges (the real walls) when `onlyFixedEdges`.
   - `getOneContour()` starts at the **left-most point** (min X) and walks the boundary via `nextPt()` which, at each vertex, picks the next neighbor by turn angle (`TR.angleBetweenLines` def L49754, called from `nextPt` L50869-50909): **CCW/min-angle only on the very first step of a hole contour** (`var CW = !(inner && res.length == 0)`, L50858); every other step — including all subsequent hole steps — uses **CW/max-angle**. This is a classic "wall-follower" boundary walk.
   - After extracting the outer loop it `clearDict()`s (removes dead-ends and consumed points) and loops to pull additional inner contours (holes) until the dict empties (L50772-50789).
   - Guards against infinite loops: if the walked contour exceeds the point count it returns `null` (L50856).
5. Assemble: first traced loop of each fill group → `outerContours`; hole groups → `innerContours` (skipping any hole adjacent to the total outline, `TR.contoursAdjacent` def L51161, called L51153). Returns `[outerContours, innerContours, outerGroups]` in **point-index form** (values live in global `TR.points`).

### Contour classification `TR.compareContours(A,B)` (L50001)

Returns one of **8** constants: `OUTSIDE / CONTACT / BELONG / CONTACT_BELONG / CONTAIN / CONTACT_CONTAIN / INTERSECT / COINCIDE` (L49473-49480; `CONTACT_CONTAIN` and `COINCIDE` are genuinely used, e.g. L67425). Algorithm:

1. Fast reject: `checkMinMaxOutside` bbox test → `OUTSIDE`.
2. If any edge of A crosses any edge of B (`lineIntersectLine`, proper crossing) → `INTERSECT` (L50019).
3. Sample A's vertices **and edge midpoints** with `pointInContour`/`pointOnContour`; if some are inside B and some outside → `INTERSECT`; if all-in and touching → `CONTACT_BELONG`, else `BELONG` (A inside B) (L50026-50069).
4. Symmetric check B-in-A distinguishes `CONTAIN` (A contains B).
   Used pervasively for containment tests (holes, inner rooms, related covers) and overlap rejection.

### `TR.compareContoursByArea(A,B)` (L49963) — cheap overlap probe

Samples a **10×10 grid** over A's bbox; counts points inside A only / B only / both; returns `INTERSECT` if any point is inside both, else `OUTSIDE`. This is the _fuzzy_ matcher used to re-attach old room/cover `data` to new contours (tolerant to small edits). Note `setSize=10` → 100 sample points.

---

## 3. Floors / covers pipeline

### `rebuildCovers()` (L59909) — reshape existing covers to fit rooms

Splits existing covers into outer/inner; splits rooms into outer/inner room contours (used as **bound** contours = triangulation boundary, and **subtr** contours = subtracted). Calls `rebuildContours(outerCovers, innerCovers, innerRooms, outerRooms, [], true)` (`separateContacting=true`). Rebuilds `arrCovers` from result, caches per-cover triangles, and **re-attaches old cover `data` by `compareContoursByArea == INTERSECT`** (L59981-59988), deep-cloning the ceiling sub-object so covers don't share ceiling state.

### `findAutoCovers()` (L59714) — auto-fill floors inside rooms

- Gathers cover contours (already present) and room contours.
- `rebuildContours(innerRoomContours, [], innerRoomContours, outerRoomContours + outerCoverContours, [], true)`: the trick is that **inner room contours become the fill seed, and existing covers + outer rooms become the subtracted boundary** — so a floor is auto-created for every room interior _not yet_ covered by a manual cover (L59745).
- For each new outer contour → `new WC.CCover(true)`, ceiling height seeded from `wallsHeight`, points added as `COVER_POINT`, triangles cached.
- `findRelatedCovers(cover)` then `rebuildRelatedCovers()` merges/normalizes covers that touch or overlap.
- Hole contours → `new WC.CCover(false)`.

### `findRelatedCovers(cover)` (L60011)

For each other outer cover, `compareContours`: `INTERSECT/BELONG/CONTACT_BELONG` → mark intersect; `CONTACT` → mark contact; also checks the other cover's holes. Any contacting/intersecting cover (and its holes) is pushed to `me.relatedCovers`. Returns `[hasIntersect, hasContact]`. Intersecting covers get auto-merged (`rebuildRelatedCovers`); merely _contacting_ covers trigger `ASK_MERGE_COVERS` (asks the user).

### `rebuildRelatedCovers(separateContacting)` (L59810)

Removes the related covers from `arrCovers`, re-triangulates just their union via `rebuildContours(outer, inner, [], [], [], separateContacting)`, rebuilds them, re-attaching old data by `compareContoursByArea`. `separateContacting` controls whether touching covers stay separate or merge.

### `findCoverHoles()` (L60406)

Sorts outer covers by area with `sortByArea` (descending: `s1>s2` → -1, L59492-59521), then `.reverse()` → **ascending / smallest-first, largest-last** (L60423-60425; comment `// o -> O`), then for each outer cover claims any inner cover it `CONTAIN`s (`TR.compareContoursOnePoint`) as a hole, consuming it. Leftover inner covers with no parent are **deleted** (L60444-60446).

### `findAllCoverTriangles()` / `findCoverTriangles(cover)` (L60450, L60458)

Re-triangulates each cover with its hole contours as inner contours (`triangulateContours([cover.points], holeContours, …)`) and stores `[pt1,pt2,pt3]` triples in `cover.triangles`. These triangles drive `DataCover.build3D` (floor mesh) and, at same XY, the ceiling mesh.

### Manual cover editing states

- **`StateMakingCover`** (L66322): freehand polygon draw of a floor. Start creates a `CRawContour` seeded at cursor; each `mouseUp` appends a snapped point (`getSnapPoint` at `SNAP_DIST/scale`); closes when new point ≈ first/last within `eps=0.1` manhattan (L66496). On `stop`: needs ≥4 points and `contourValid`; pops the closing dup; **normalizes winding** (`if contourArea<0 reverse`, L66371); creates `CCover(makingOuter)` with ceiling height = `wallsHeight`; `addCoverPoints` + `connectAllPoints` + `findCoverHoles` + `findAllCoverTriangles`; runs related-cover merge logic; may ask to merge (`stateMergeCovers`). Live size inputs appear only when the last edge and closing edge are both ≥ `minLen=45` screen px (L66578-66588). `me.cut` flag toggles between "draw floor" (pattern fill) and "cut" (red) modes.
- **`StateSelectedCover`** (L66882): multi-select of covers. Hover finds nearest cover point (within `WC.POINT_SIZE/scale`) or a cover side (`getSideByPoint`); can drag whole cover, drag a point, or **split a side** by inserting a new cover point mid-edge (`splitCurrentSide`, L66936). Exposes `setCeilingVisible`/`setCeilingHeight` applied to all selected covers. On `stop` re-runs `connectAllPoints`.
- **`StateDraggingCoverPoint` / `StateDraggingCoverSide`** (L63910, L64408): move a cover vertex / edge; commit calls `rebuildWallsAndCovers`.

### Floor material

Default cover material `getDefaultMaterialByKey("cover")` (L51730). `DataCeiling`'s own default material key is **`"wall"`** (L51793-51794); the `"ceiling"` key is the default of `CCover.data.ceiling.materialID` (L56994-56995). Material rotation/shift/rotate handled by the shared `WC.DataObject` (moveMaterial/rotateMaterial rebuild 3D immediately, L51355-51385).

---

## 4. Ceilings (`DataCeiling` / cover.data.ceiling)

- A ceiling is **not** an independent user object; it is the `ceiling` sub-block of a cover's (or area's) `data`, plus a `DataCeiling` render object at build time. Height defaults to `WC.DEFAULT_WALLS_HEIGHT = 280`.
- Visibility: `exists / visible / partialVisible / isHiddenByInstrument` flags. `setCeilingVisible(v)` maps to `data.ceiling.exists`.
- **Height** is set per-cover via `StateSelectedCover.setCeilingHeight(h)` → each selected cover (L67030). Areas set ceiling height similarly (L61443, via `ASK_AREA_HEIGHT`).
- `DataCeiling.build3D` (L51806): uses the cover's cached triangles, but calls `WC.findTriCover(a,b,c, me.height, true, …)` — same XY footprint as the floor, lifted to `height`, with flipped orientation so it faces down. So **ceiling geometry === floor triangulation extruded to ceiling height**. `rotatingCenter` shared with the cover so ceiling material aligns with floor.

---

## 5. Cover-point sharing with room points (`connectAllPoints`, L60285)

Because covers are drawn independently but should snap to room walls:

1. Reset `parent=null` on all cover points.
2. For each room point, for each unparented cover point within `TR.manhDist < TR.L_EPS (1e-8)`: **snap the cover point exactly onto the room point** (`cpt.x=rpt.x; cpt.y=rpt.y`), set `cpt.parent = rpt`, push to `rpt.children` (L60300-60307).

Effect: a cover vertex sitting on a wall corner becomes a _child_ of that room vertex. When the room vertex moves, its children follow. This is the mechanism that keeps auto floors welded to walls without merging the point arrays. `StateSelectedRoom.findInnerStuf` (L67405) uses this: only **unparented** cover points count as independently-movable "inner points" of a room (L67428-67434).

---

## 6. Areas (`DataArea` / `CArea`) — low-ceiling zones

### `StateMakingArea` (L65197)

Freehand polygon like cover-making (same raw-contour + snap + size-input machinery, same `minLen=45` px input gate, same `eps=0.1` close test).
On `stop` (L65228):

1. Needs ≥4 points + `contourValid`.
2. **Overlap rejection**: for every existing area, `compareContours(existingArea, rawCont)`; if not `OUTSIDE` and not `CONTACT` → abort silently (areas may only touch, never overlap) (L65243-65252).
3. Builds pairs from the polygon and calls `WC.core.rebuildWalls(pairs)` — **the area edges are injected as cut pairs so the room triangulation is split along the area boundary** (L65262).
4. Selects the fill-groups whose triangle centers fall inside the drawn polygon (`pointInContour`, L65268-65280), re-groups them, traces contours, and snaps traced vertices onto existing room points (`findNearest` within `TR.B_EPS = 1e-4`, L65294).
5. Merges nested traced contours (BELONG/CONTAIN → absorb), then creates one `CArea` per remaining contour with ceiling height = `wallsHeight`, caches triangles, registers the area's points into `point.areas`, and fires `ASK_AREA_HEIGHT` so the UI prompts for the zone height (L65322-65350).

### Area↔room interaction rules

- Areas store their edges as **cut pairs** fed into room triangulation, so drawing an area actually re-partitions the rooms it sits in (a low zone becomes its own room region).
- `delIntersectedAreas` (L60101) and `resetAreas` (L60221): an area is **deleted** if its cut edges cross a room wall, if it self-intersects (`contourSelfIntersected`), or if any of its points can't be re-snapped onto a room point after rebuild (`findNearest` within `L_EPS` fails → bad → deleted, L60262-60276). Areas thus can only live _snapped to the room graph_.
- `StateSelectedArea` (L67638): thin select state; height set via `setCeilingHeight` on all selected areas.
- `findAreasTriangles` (L60072): after rebuild, area triangles are assigned per fill group — only the center of the **first** triangle of each group is tested (`fillGroups[j][0]`, L60079-60087) with `pointInContour(area.points)`; on a hit the **whole group** is attached to the area.

---

## 7. Structural derivatives

### Cuts (`DataCut` / `CCut`, `resetCuts`, L60188)

A _cut_ is the vertical surface generated where an area (or opening) edge slices across a room interior. `resetCuts` rebuilds `me.cuts` from **area edges** (`areaSides`), matching old cuts by endpoint `match()` to preserve their `data` (L60204-60217). `DataCut.build3D` (L51703) builds two triangles from `low`→`height` via `findTriWall`. So cuts are auto-regenerated every rebuild, one strip per area boundary edge that is interior.

### Plinths / skirting & crown (`DataPlinth`, `createPlinths`, L51436, L55411)

- Two per wall: `bottomPlinth` (skirting, material key `"plinth"`) and `topPlinth` (crown molding, material key `"molding"`); created when a wall is built (`DW.topPlinth/bottomPlinth = new WC.DataPlinth(DW, top)`, L53704-53705). Shape/height/depth come from `WC.plinthCreator` (`PlinthCreator`, L56405) by `shapeNum`; top plinths force `shapeNum ≥ 8` (a separate profile bank) and auto-set `distToCeiling` (L51514-51522).
- **Profiles ARE runtime-parsed SVG for catalog products; only the 16 defaults are hardcoded.** `loadSVG(id)` (L56691-56699) → `createPlinthShape(id)` (L56701-56778) **downloads the catalog product's SVG** (`productData.source.body.package`), extracts the path's `d=` attribute (`getPathFromSVG`), parses its M/V/H/L commands, normalizes the resulting polygon into `[0..1]` (plinths) / `[0..−1]` (moldings) and stores it as a `new PlinthShape(...)` in `PoolPlinthShape[id]` (L56778) — `DataPlinth.build3D` extrudes exactly that parsed profile. The hardcoded part is only the **16 default shapes**: `PlinthCreator.PoolPlinthShape` (L56412) is pre-seeded with `PlinthShape(defDepth, defHeight, path, distToCeiling)` objects (`PlinthShape`, L56396), IDs `0..15` — e.g. shape 0 = `[[0,1],[1,1],[1,0]]`, shape 7 = a 15-vertex stepped profile; IDs **0–7 = bottom (skirting)** with Y in `[0..1]`, IDs **8–15 = top (crown)** with Y in `[−1..0]` and the vertex list `.reverse()`d (so the swept profile faces down from the ceiling). The fallback to a default shape applies only while the catalog SVG hasn't loaded yet (`!isSVGLoaded`, L51508-51522). `getShapePath(id)` (L56575) returns `PoolPlinthShape[id].path`; `getDefDepth/getDefHeight/getDistToCeiling` read the other fields.
- `createPlinths` (L55411) iterates every room's walls, and for each wall computes **mitered inner-offset corner points** (`perpendicularPoint` by depth `d=1`, intersect adjacent offset lines; fall back to the plain perpendicular point if the miter is farther than `maxDist = 2d`, L55460-55464). Both plinths of a wall share those `B,C,Bx,Cx` points (`setPoints`).
- **Gaps around openings**: `findPlinthGaps` / L53290-53333 — for each opening (axis `finalContours`) it projects the opening's footprint onto the wall line and pushes `[proj1,proj2]` into `bottomPlinth.gaps` — unless `-bounds.maxY >= bottomPlinth.h`, which is the **skip** condition (`continue`, L53301): a gap is created only when the opening reaches below the plinth height (`-bounds.maxY < h`). `DataPlinth.build3D` (L51505) then emits plinth segments **around** those gaps (segment before first gap, between gaps, after last gap; L51552-51568) so skirting stops at door openings.
- `build3D` produces the mesh via `WC.findPlinthSegment` per segment, computes `length = dist(point1,point2)`, and stores selection `contours` (a 3D quad) for hit-testing.

#### Per-wall on/off: `exists` (verified 2026-08-21)

Skirting and crown are **independently switchable, and the switch lives on the wall face** — not on the room, not globally.

- `WC.DataPlinth = function(wall, top, height)` (L51436) keeps `me.wall = wall` (L51444) and gets its role from the `top` argument alone: `me.type = 'topPlinth'` (L51458) / `me.type = 'bottomPlinth'` (L51469), with default materials by key `"molding"` (L51460) / `"plinth"` (L51471). Its default flags are `me.visible = true`, `me.exists = true`, `me.partialVisible = false`, `me.isHiddenByInstrument = false` (L51479-51482).
- `WC.DataWall` (L52759) holds **scalar** fields `me.topPlinth = null` / `me.bottomPlinth = null` (L52785-52786) — exactly one of each per wall, built as `new WC.DataPlinth(DW, true)` / `(DW, false)` (L53704-53705). Neither `WC.DataRoom` (L52070) nor `WC.CRoom` (L56946) nor the shared `WC.CContour` (L56890) carries any plinth field: the room is not the owner. No `plinthEnabled` / `hasPlinth` / `setPlinthVisible` / `setPlinthExists` exist anywhere in the bundle.
- **`exists` is persisted per wall.** `WC.convert.wallToShort(DW)` (L53644) writes `pltv:DW.topPlinth.exists? 1 : 0` (L53651) and `plbv:DW.bottomPlinth.exists? 1 : 0` (L53658), alongside `pltvisible/pltpv/plthbi` and `plbvisible/plbpv/plbhbi`, per-plinth material fields, and — notably — **per-plinth `plth`/`pltd`/`pltsh`** (L53657) **and `plbh`/`plbd`/`plbsh`** (L53664) — height, depth, `shapeNum`. Read back at L53718 / L53740 (`exists`, defaulting to `true` when the key is absent) and L53729 / L53751 (`shapeNum`). So the profile choice is a **wall** attribute in the reference, not a room attribute.
- **`exists` survives a rebuild** the same way materials do: `WC.convert.copyPlinthData(cwall.data.topPlinth, DW.topPlinth)` / `…bottomPlinth…` (L61686-61687) re-applies the saved plinth block onto the freshly derived wall. `copyPlinthData` (L54346) copies `materialID, addMaterialID, materialRotation, exists, visible, partialVisible, isHiddenByInstrument, d, h, shapeNum, fromStart`.
- **Two engine overrides run after that restore and force `exists = false`:** (a) walls of an outer contour lose both — `if (DW.outer) { DW.bottomPlinth.exists = false; DW.topPlinth.exists = false }` (L61741-61743), which is why there is no plinth on the outside of the building; (b) a wall whose two points coincide with an area edge loses **only the crown** — `DW.topPlinth.exists = false` (L61841, inside `me.getStructure` L61611, in the `wallPairs` loop fed by `cArea.getCutWallPairs()`), and the same rule is re-applied on load in `WC.convert.shortToStructure` (L53942, function at L53828). Note the asymmetry: (b) is the reference's version of our derived `underArea` and touches only `topPlinth`.

#### "Apply to the whole room" — `setPlinthToRoom` (verified 2026-08-21)

`me.setPlinthToRoom = function(plinth)` (L56062) takes **one plinth**, finds every room whose `walls` array contains `plinth.wall`, and for each wall of that room runs `WC.convert.copyPlinthData(plinth, walls[j].topPlinth)` or `…bottomPlinth` depending on `plinth.type`, then `build3D()` + `dispatchUpdate()`. So it copies the **whole plinth block of the source wall** — `exists` included, plus material, `d`, `h`, `shapeNum` — onto the same-role plinth of every wall of the room. It is a one-shot broadcast, not a room-level property: nothing afterwards keeps the walls in sync.

The sibling `me.setWallToRoom(wall)` (L56096) does the same for the wall itself via `WC.convert.copyWallData` (L54323), which copies the wall's material block, `exists/visible/partialVisible`, `configData` — **and both plinths** (L54342-54343). Both are exposed to the UI as `planner.scene.setPlinthToRoom` / `planner.scene.setWallToRoom` (L973-975).

Per-wall plinth data also feeds the bill of materials: `let molding = w.topPlinth; let areaMolding = molding.h * molding.length / 10000; … plinthsDict.push({materialID, addMaterialID, area, type, shapeNum})` (L54210-54215), with the symmetric block for `w.bottomPlinth` at L54203-54208.

#### The wall properties panel (React bundle, verified 2026-08-21)

`react.js` is a single-line bundle, so anchors here are **byte offsets**, not line numbers. The selected-wall panel (`selectedConstr/selectedWall`, see [15-ui-redux-bridges.md](./15-ui-redux-bridges.md) «FSM левой dynamicPanel») binds:

- `v=_?_.topPlinth:null,b=_?_.bottomPlinth:null` (@2260040) — both plinths of the selected wall `_`;
- two independent checkboxes writing `.exists` directly: `{name:"moldingVisible",label:d.TEXT_MOLDING,onChange:e=>{v.exists=e,v.dispatchUpdate(),R2D.scene.history.saveState(),…}}` (@2267621) and `{name:"plinthVisible",label:d.TEXT_PLINTH,onChange:e=>{b.exists=e,b.dispatchUpdate(),R2D.scene.history.saveState(),…}}` (@2268286). Each toggle is its own undo step;
- one **«apply to room»** button that fires all three broadcasts at once: `onClick:()=>{Lr.scene.setPlinthToRoom(v),Lr.scene.setPlinthToRoom(b),Lr.scene.setWallToRoom(_),…},label:d.TEXT_APPLY_TO_ROOM` (@2268460) — so the button copies **the wall and both its plinths** to every wall of the room, not just the plinth flags.

When a **plinth itself** is picked (`selectedPlinth` panel), the same flag is offered alone: title `"topPlinth"==(null==i?void 0:i.type)?l.TEXT_MOLDING:l.PANEL_TITLE_PLINTUS` (@2421384), checkbox `{name:"plinthVisible",onChange:e=>{i.exists=e,…},label:l.TEXT_SHOW}` (@2423070), and `{label:l.TEXT_APPLY_TO_ROOM,onClick:()=>{Lr.scene.setPlinthToRoom(i),…}}` (@2423285) — here `setPlinthToRoom` is called **once**, and `setWallToRoom` is absent.

**«Split the wall» is not about low-ceiling areas.** The button next to those checkboxes runs `Lr.scene.runConfigurator(_),c(Gr({mode:"wallSlice",data:{type:"main"}}))` with `icon_divide.svg` and the label `null!=_&&_.configData?d.TILE_CONFIG_EDIT:d.TILE_CONFIG_INIT` (@2266741-2267018) — it opens the **tile configurator** (`TConf`, see [06-materials-textures.md](./06-materials-textures.md) §4a), i.e. slicing the wall into material patches. It has nothing to do with `CArea` / low-ceiling zones despite a UI label that reads like «divide the wall into zones».

**Negative fact:** the React bundle carries only translation **keys** — `TEXT_PLINTH`, `TEXT_MOLDING`, `TEXT_APPLY_TO_ROOM`, `PANEL_TITLE_PLINTUS`, `TILE_CONFIG_INIT`, `TEXT_SHOW` never appear as object keys with a string value, and the Cyrillic literals «Плінтус» / «Молдинг» / «Плинтус» have **zero** occurrences in the file. The only string-valued mentions are key maps: `{molding:"TEXT_MOLDING",plinth:"TEXT_PLINTH"}` (@2292500) and `{topPlinth:"TEXT_MOLDING",bottomPlinth:"TEXT_PLINTH"}` (@2424220). Translations are fetched at runtime, so the snapshot cannot tell us the wording of any locale.

### Connectors / plugs (`WC.createConnectors`, L54382)

Fills the small triangular gaps where two wall axes meet at a corner (the "cap" between wall ends).

- `maxConnectorLength = 40` (L54384): for each axis pair, candidate connector segments longer than 40 units are skipped (a corner gap wider than 40 is assumed to be a real opening, not a joint).
- Rejects a candidate if it coincides with an existing wall, if a wall endpoint lies on it, or if it properly crosses a wall (`lineIntersectLine`) (L54411-54441); also skips if a same-height cut already spans it (L54443-54453).
- Surviving pairs become `WC.DataPlug`s, built into 3D via `createPlug3D` (L54495): a vertical quad from 0→height between the two points. Height = the axis's wall height.

---

## 8. Geometry rebuild — 2D (plan) vs 3D

### 2D plan

- Rooms/covers/areas are pure polygons (`points[]`) rendered on a canvas. Room detection (§2) is entirely 2D: triangulate → flood-fill → trace. Drawing states draw the in-progress `rawCont` polygon with mode-specific fill (green for area, floor pattern for cover, red for cut).
- Snapping is view-scale-aware: thresholds are `WC.SNAP_DIST / WC.wallsEditor.scale` so they stay constant in screen pixels (see §9).

### 3D extrusion / triangulation

- Every structural element has a `build3D()` that turns cached 2D `triangles` into vertex/uv/index buffers. Floors sit at z=0, ceilings at `ceiling.height`, area caps at `area.height`, cuts span `low→height`, walls/plinths/plugs extrude between their point elevations.
- `WC.findTriCover(a,b,c, elevation, flipNormal, materialX,Y,rotation, centerX,centerY)` is the common floor/ceiling triangle→3D mapper; `WC.findTriWall(...)` the vertical-surface mapper (walls/cuts/plugs). UVs derive from material shift/rotation and a per-element `rotatingCenter` (bbox center) so materials tile consistently.
- The full 3D scene rebuild (`build3D` at L55475) order: walls → cuts → `findPlinthGaps` → plinths → covers (each cover and its ceiling built in the same loop iteration, cover first) → areas/caps → connectors (L55633), each dispatching `ELEMENT_CREATE` events the scene layer listens to.

---

## 9. Snapping & constraints (numeric thresholds)

| Constant                              | Value             | Meaning / use                                                                                                         |
| ------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `TR.L_EPS` (L49482)                   | `1e-8`            | "same point" tolerance in triangulation dedup, `connectAllPoints`, area re-snap, `DataPoint.match` default.           |
| `TR.B_EPS` (L49483)                   | `1e-4`            | looser snap when re-snapping area/traced vertices onto room points (`findNearest`, L65294).                           |
| `TR.roundCoord` grid (L50558)         | `0.001`           | all room/cover points rounded to 1/1000 unit before triangulation.                                                    |
| `WC.SNAP_DIST` (L60604)               | `10`              | base cursor snap radius, **divided by view scale** → constant screen pixels. Used by `getSnapPoint` in making states. |
| `WC.POINT_SIZE` (L60605)              | `6`               | `/scale` → point pick radius in `StateSelectedCover`.                                                                 |
| close-polygon `eps`                   | `0.1` (manhattan) | making states auto-close when new point ≈ first/last vertex.                                                          |
| size-input `minLen`                   | `45` px           | live dimension inputs shown only when both open edges ≥ 45 screen px.                                                 |
| `maxConnectorLength` (L54384)         | `40`              | corner gaps ≤ 40 get a connector; larger are treated as openings.                                                     |
| plinth `d` / `maxDist` (L55413-55414) | `1` / `2`         | plinth inner-offset depth and max miter distance.                                                                     |
| `compareContoursByArea` grid (L49965) | `10×10`           | fuzzy overlap sampling for room/cover `data` re-attach.                                                               |
| default heights (L59320-59321)        | `280` / `100`     | wall & ceiling height / low-area height.                                                                              |

`WC.snapTool.getSnapPoint` (L57568) composes: nearest-point snap → perpendicular/orthogonal snap → bisector snap (search radius `snapDist*10`, L57525), each gated by `snapDist`. This is used by all making states to place the next vertex.

---

## 10. Edge cases (from code)

- **Degenerate contours** dropped: `TR.contourValid` gate on every rebuilt room/cover; `filterContours`/`clearContour` strip collinear/duplicate points before triangulation.
- **Self-intersecting areas** deleted (`contourSelfIntersected`, L60228).
- **Areas that leave the room graph** deleted: any area point that can't re-snap to a room point within `L_EPS` after rebuild is removed (L60262-60276).
- **Overlapping areas / covers** are auto-rejected or auto-merged (areas: reject non-OUTSIDE/CONTACT; covers: merge on INTERSECT, prompt on CONTACT).
- **Winding normalization**: covers reverse to positive area on creation (L66371); contour tracing distinguishes CW outer vs CCW hole by turn-angle selection.
- **Infinite-loop guard** in boundary walk returns `null` if the traced contour exceeds available points (L50856), so malformed graphs fail soft.
- **Hole vs outer disambiguation**: a hole contour adjacent (shares a directed edge) to the total outline is discarded, preventing the outer boundary from being mistaken as a hole (`contoursAdjacent`, L51153).
- **Cover holes**: leftover inner covers with no containing outer cover are deleted (L60444).
- **Ceiling data isolation**: cover/area `data.ceiling` is deep-spread-cloned on re-attach so merged/rebuilt covers don't alias each other's ceiling height (L59985, L59864).
- **Empty elements** still get a degenerate triangle (`addNullData`) so buffers are always valid.

---

## Confidence & gaps

**High confidence (directly read from code):**

- The whole room-detection pipeline: `rebuildWallsAndCovers` → round → `rebuildWalls`/`rebuildCovers`/`findAutoCovers` → `connectAllPoints`/`findCoverHoles`/`findAllCoverTriangles` (L59533-60009).
- `TR.rebuildContours` = triangulate → `groupTriangles` (flood-fill) → `contoursFromGroup` (turn-angle boundary walk) (L50692-51159).
- `compareContours` / `compareContoursByArea` semantics and the 8 relation constants (OUTSIDE/CONTACT/BELONG/CONTACT_BELONG/CONTAIN/CONTACT_CONTAIN/INTERSECT/COINCIDE, L49473-49480, L49963, L50001).
- Grid rounding 0.001, EPS values 1e-8/1e-4, SNAP_DIST 10, maxConnectorLength 40, default heights 280/100, area overlap rejection, cover merge/prompt logic — all cited above.
- Data models CRoom/CCover/CArea/CContour and Data* build3D methods (L51212-51836, L56890-57163).
- Cover-point↔room-point parent/child sharing (L60285).
- Plinth generation, gaps around openings, connectors (L54382, L55411, L53290); plinth profiles confirmed **runtime-parsed from catalog SVG** (`loadSVG`/`createPlinthShape`, L56691-56778) with the 16 default shapes as the only hardcoded bank.
- Attribute re-attach by `compareContoursByArea == INTERSECT` (L59695, L59983).

**Inferred (behavior deduced, not spelled out):**

- The _intent_ of `findAutoCovers`'s argument pattern (inner rooms as fill seed, existing covers as subtracted boundary) → "cover every uncovered room interior". Logic is read; the product intent is inferred.
- That the whole graph recomputes on _every_ edit (rather than incremental) — inferred from the ~dozens of `rebuildWallsAndCovers()` call sites at every mutation, not from a single dispatcher.
- Exact 3D vertex/UV math inside `findTriCover`/`findTriWall`/`findPlinthSegment` — these were treated as black boxes (signatures + roles read, internals not fully traced).
- `resplitSegments` / `imported_clean_graph` / `TR.triangulate` internals (the actual constrained-Delaunay algorithm) not read in depth — only their contract (produce `groupedTriObjects`, fill/hole classification) is confirmed.

**Not found / not covered:**

- Persistence/serialization format of room `data` beyond that it's an opaque object copied across rebuilds (load path around L53506-53987 was only skimmed).
- Exact ceiling _visibility_ interaction with "instrument hiding" (`isHiddenByInstrument`) — flag exists, its toggler not traced.
- `StateDraggingCoverPoint`/`StateDraggingCoverSide` full drag math (only their existence and that they commit via `rebuildWallsAndCovers` confirmed).
- Undo/redo model beyond the per-making-state `undoPoints`/`order` vertex stack.

**Missing for implementation** (validation gaps; items since closed by later deep-dives are linked):

- Closed by deep-dives: the CDT question is settled — stock `cdt2d` (`{exterior:true}` is load-bearing) + `clean-pslg` from npm → [dd01](deep-dives/01-triangulation-core.md); `pointInContour`/`pointOnContour`/`checkContact` and the epsilon policy behind `compareContours` → [dd08](deep-dives/08-geometry-predicates.md); UV math of `findTriCover`/`findTriWall`/`findPlinthSegment` → [dd04](deep-dives/04-3d-mesh-uv.md) + [dd05](deep-dives/05-cover-build3d.md); the "drawn wall → primary contour" pipeline (axes/thickness/`faceRight`, `resetWalls`) → [dd07](deep-dives/07-wall-axes-pipeline.md).
- Port decisions left to us: the flood-fill recursion must become an **explicit stack** in TS (mandatory); preserve `sortByArea` ordering (descending, eps=10 tie-break for outer) — it affects room order, hit-testing and `findCoverHoles`; full re-triangulation on every commit (14+ call sites) is fine as a starting point, but plan a debounce/worker for large plans.
