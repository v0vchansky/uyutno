# Competitor mechanics — Undo / Redo / History

> Reverse-engineered from the competitor's un-minified `plannercore.js` (namespaces `WC` = WallsCommander / 2D floorplan editor, `R2D` = scene / product engine). All line numbers refer to that file. Snippets are short and paraphrased; class and function names are real. This is an implementation-ready functional spec, not a copy of their code.

## 0. TL;DR

There are **two fully independent history stacks**:

1. **`WC.WallsCommander`** (defined `WC.WallsCommander`, line 58140; singleton `WC.wallsCommander`, line 60584) — history of the **2D construction / floorplan graph**: points, walls, rooms, covers, areas. Pure snapshot/memento with an index-relinking trick. Active only while the 2D constructor editor is open.
2. **`R2D.SceneHistory`** (constructor line 12295; one instance per `R2D.Scene`, created line ~13100 in `R2D.Scene`, exposed as `scene.history`) — history of the **3D scene**: placed products, their transforms/materials, per-construction-surface material state, object groups, and skybox. Snapshot/memento with **stack cap 100** and **label coalescing**.

They are surfaced to the host app as two separate API namespaces — `planner.constr.undo/redo/canUndo/canRedo` (lines 753–756) wire to `WC.wallsEditor`, and `planner.scene.undo/redo/canUndo/canRedo` (lines 786–789) wire to `scene.history`. The host UI decides which stack a global Ctrl+Z hits based on which editor/viewer is active; the two are never merged into one timeline.

---

## 1. The two history systems — why two, and how they stay consistent

### 1.1 Why two

The floorplan graph (`WC.core.roomPoints / walls / arrRooms / arrCovers / arrAreas`) and the scene graph (placed 3D products, groups, skybox, plus the _finish materials applied to construction surfaces_) are different data models edited by different tools. Rather than one unified command log, each editor owns its own stack:

- The **2D constructor** (`WC.WallsEditor` / `WC.wallsEditor`) mutates the geometry graph. Every committed geometry edit calls `me.save()` (line 61342) → `WC.wallsCommander.save()` + `dispatchHistoryState()`.
- The **3D scene** mutates products/transforms/materials. Every committed edit calls `scene.history.saveState()` (dozens of call sites, e.g. 18550, 42303, 43917, 44206).

### 1.2 The bridge between them

`R2D.SceneHistory` snapshots do **not** re-clone construction geometry — the geometry graph lives in `WallsCommander`. Instead each scene snapshot stores, per construction surface (wall/cover/ceiling/cut/area/frame/plinth/cap), only **material state** (material id, add-material id, rotation, shift; plus wall `configData`, plinth shape/dims). See `R2D.SceneHistory.makeConstructionObjectsStates`, line 12890. So the two stacks partition responsibility: WallsCommander = _shape of walls_, SceneHistory = _finishes on those walls + everything 3D_.

They are kept consistent by an explicit hand-off. When the 2D constructor closes (`me.disable`, line 62331):

1. `wallsData.setStructure(me.getStructure())` pushes the final geometry back into the shared `WC.WallsData`.
2. `scene.history.getUndo().length < 1 && scene.history.getRedo().length < 1 && scene.history.updateConstructionData()` (line 62350) — **only when the scene history is otherwise empty**, it refreshes the current scene snapshot's `constructionStateObjects` (`scope.updateConstructionData`, line 12369) so the baseline scene state reflects the just-edited construction. When scene history is non-empty they deliberately do _not_ rewrite past snapshots (that would corrupt older undo entries whose material state was captured against a different wall set).

### 1.3 Order of operations on a geometry commit

`WC.WallsEditor.save` (line 61342): `WC.wallsCommander.save()` first, then `me.dispatchHistoryState()` (fires `WC.HISTORY_STATE` with `{undo, redo}` for toolbar buttons, line 61379).

---

## 2. Snapshot / memento approach

### 2.1 WallsCommander — deep clone of the point/wall/room graph with index relinking

`WC.WallsCommander` holds `var stack = []` and `var pointer = -1` (lines 58142–58144). It is a classic linear undo pointer, **not** two stacks.

- **`save()`** (line 58146): if `pointer < stack.length - 1` it truncates the redo tail (`stack.splice(pointer + 1)`), then `stack.push(me.getData())` and `pointer = stack.length - 1`. **No stack cap** here.
- **`getData()`** (line 58198) builds a deep, self-contained clone of the entire graph. The clever part is **relinking by temporary index**:
  - Each source `roomPoint` / `coverPoint` is assigned `.num = i` (its array index) and cloned via `CPoint.clone()` (line 56857 — clones only `x, y, type`, drops live references like `contour`, `children`, `areas`).
  - Rooms/covers/areas are rebuilt as fresh `WC.CRoom` / `WC.CCover` / `WC.CArea`; their `points[]` are re-pointed to the _cloned_ points by looking up `dataObj.roomPoints[srcPoint.num]`, and back-references are re-established (`P.contour = clonedRoom`, `P.areas.push(clonedArea)`). `triangles` and `data` are copied by reference.
  - Walls are rebuilt as fresh `WC.CWall(clonedP1, clonedP2, data)` using `point1.num` / `point2.num` as the index into the cloned point array (line 58317).
  - So a snapshot is a coherent object graph with no shared mutable references to the live graph, reconstructed purely from integer indices.
- **`setData(dataObj)`** (line 58270) is the mirror image: it rebuilds `WC.core.*` from the snapshot the same way — re-cloning points, re-pointing contours/walls/areas by `.num`. It is a **full replacement** of the live construction graph (`WC.core.roomPoints = new Array(...)`, etc.), not a diff.
- **`undo()`** (58158): guard `if (pointer < 1) return;` then `pointer--; setData(stack[pointer])`. **`redo()`** (58165): guard `if (pointer >= stack.length - 1) return;` then `pointer++; setData(stack[pointer])`.
- **`canUndo()` = `pointer >= 1`**, **`canRedo()` = `pointer < stack.length - 1`** (lines 58172, 58177).
- **`clear()`** resets `stack = []; pointer = -1` (line 58348).

Note: because `save()` pushes state 0 at editor init (`me.save()` at end of constructor, line 61407) and `canUndo` requires `pointer >= 1`, the initial state is a non-undoable baseline.

### 2.2 SceneHistory — two-stack model with a live `currentState`

`R2D.SceneHistory` (line 12295) keeps `statesUndo = []`, `statesRedo = []`, a live `currentState`, and `let maxActions = 100` (the stack cap; see §2.4). It is a **three-slot** design: past states in `statesUndo`, future states in `statesRedo`, and the present in `currentState`.

**`makeState(scene)`** (line 13075) captures:

```
{ stateId: __counter++,
  sceneStateObjects,          // placed products (transform/material/light/config/logo/parametric)
  constructionStateObjects,   // per-surface material state (walls/covers/ceilings/cuts/areas/frames/plinths/caps)
  groupStateObjects,          // object groups + their transforms
  skybox: { id, r } }
```

- `makeSceneObjectsStates` (12879) → per object `makeSceneObjectStateBase` (12830): `objectId`, `productId`, `productType`, a **live reference to `sceneObject`**, and value copies of position/rotation/scale/flip plus `lightInfo`, `configInfo`, `hasLogo`, `isParametric`. `MODEL` type additionally stores `materials` (`makeSceneObjectStateModel`, 12862). Transform values are copied by value; the `sceneObject` itself is held by reference (so add/remove is detected by `objectId`, and geometry is re-derived from the live object on restore).
- `makeConstructionObjectsStates` (12890): for each surface, `{ object (live ref), materialId, addMaterialID, materialRotation, materialShift, ... }`. Walls also store `configData` (deep-copied via `configData.getData()`) and a `wasChanged` flag (`= constructionObject.changed`) plus `willBeChanged: false`. Plinths also store `exists`, `shapeNum`, `d`, `h`. Caps come from the single `constructionObjects.cap`.
- `makeGroupsStates` (13037): per group its member `sceneObjects` (by ref) and transform (position/rotation/flip/scale).

**`saveState(label = '')`** (line 12347):

1. `statesRedo = []` — any redo branch is discarded on a new edit.
2. If a `currentState` exists, push it onto `statesUndo` **unless coalescing applies** (see §3).
3. `currentState = makeState(scene); currentState.label = label`.
4. `updatePrevState()` (line 12441) — propagates `willBeChanged` flags backward onto the previous undo entry's wall states (see §4.2).
5. `scene.getConstructor().setAllElementsUnchanged()` (clears wall `.changed`, line 55059).
6. `checkStates()` (fires UNDO/REDO active/inactive events, §5).
7. `R2D.controller.savedLastChanges = false` — marks the project dirty (autosave hook, §7).

### 2.3 What a "state" is: present vs past

`currentState` is the present. `undo()` (12380): if `statesUndo` empty, warn and return; else `newState = statesUndo.pop()`, push `currentState` onto `statesRedo`, apply `setState(scene, currentState, newState, false)`, then `currentState = newState`. `redo()` (12406) is symmetric with `statesRedo`/`statesUndo` swapped and `forward = true`. Both fire `STATE_UPDATE` before and `STATE_UPDATED` after, run `checkStates()`, mark dirty, and call `scene.checkIfHiddenElementsWasReturnedOrDeleted()` + `scene.checkForLightObjectsToEnableOrDisable()` to reconcile visibility/light side effects.

There is also `removeUndoState()` (12428): pops one undo state and applies it _without_ pushing to redo — used to silently roll back a transient/aborted action.

### 2.4 Stack cap (~100)

`maxActions = 100` is declared (line 12300). **In this build the cap is not actively enforced in `saveState`** — `statesUndo.push` has no trim. So the intended cap is 100 but the guard appears vestigial/commented-out; treat 100 as the design target and add an explicit `if (statesUndo.length > maxActions) statesUndo.shift()` in our implementation. WallsCommander has no cap at all.

---

## 3. Label coalescing (consecutive same-label collapse)

Coalescing lives in one line of `saveState` (line 12351):

```js
if (label !== 'productSizes' || currentState.label !== 'productSizes') statesUndo.push(currentState);
```

Meaning: when the **new** save and the **current** state both carry label `'productSizes'`, the current state is **not** pushed to the undo stack — it is simply overwritten by the new `currentState`. Consecutive same-label saves collapse into a single undo step; the first entry of the run is the one preserved on the stack, and the last save wins as `currentState`. A save with a _different_ label (or empty label, the default) always pushes normally, so the run is bounded by the next differently-labelled action.

### When a new entry is pushed vs coalesced

- **Empty label `''` (the default for essentially every committed action)** → always pushes. Product moves, rotations via input, adds, deletes, material changes, group ops, skybox — all use `saveState()` with no label, so each is its own undo step.
- **`'productSizes'`** → coalesces runs. This is the designed hook for size edits: the intent is that dragging a size handle or scrubbing a width/height/depth field produces one undo step, not one per pixel.
- After any product is deselected, `history.setCurrentLabel('')` is called (`unsetActiveObjectProduct`, line 42183) — this **clears the label on `currentState`**, breaking the coalescing run so the next size edit starts fresh.

### How the drag itself avoids spamming states

The size/rotation setters gate on an `isMouseDown` argument and **skip `saveState()` entirely during the drag**: e.g. `setCurrentModelWidth(vWidth, keepRatio, isMouseDown)` ends with `!isMouseDown ? scope._scene.history.saveState() : null` (lines 42838, 42856, 42875, 42885; rotation at 42799). So during a live drag no state is saved at all; on release one state is saved. The `'productSizes'` label is the second layer of protection for the case where multiple discrete field edits land back-to-back. **Caveat / gap:** in this build no call site is passing the literal `'productSizes'` label to `saveState` (searched — only the guard references it), so the coalescing is scaffolding that the `isMouseDown` gate largely supersedes. Our implementation should wire the label explicitly at the size-field commit.

---

## 4. Restore — how undo/redo applies a snapshot

`R2D.SceneHistory.setState(scene, stateOld, stateNew, forward)` (line 12819) orchestrates restore in a fixed order:

1. `removeGroups(scene)` — tear down all live groups first (line 12771; each group `clearUnchanged()` then `productHelper.removeGroup`).
2. `setSceneState(scene, stateOld, stateNew)` — **diff** products (add/remove/update), §4.1.
3. `setConstructionState(scene, stateOld, stateNew, forward)` — reapply surface materials, §4.2.
4. `setGroupState(scene, stateOld, stateNew)` — rebuild groups from `groupStateObjects`, §4.3.
5. `scene.setSkyboxMat(stateNew.skybox.id)` + `scene.setSkyboxRotation(stateNew.skybox.r)`.

Guard: `if (!stateNew) return;`

### 4.1 Products: diff old-vs-new, per-object apply (not full reload)

`setSceneState` (line 12561) does a three-way reconciliation keyed by `objectId`:

- **needsAdd**: objects in `stateNew` not in `stateOld` → `scene.add(sceneObject)`.
- **needsRemove**: objects in `stateOld` not in `stateNew` → `scene.remove(sceneObject)`.
- **update**: for every object in `stateNew`, `setSceneObjectState` applies the snapshot's transform/material/etc onto the live `sceneObject`.

`setSceneObjectStateBase` (12474) is diff-aware per property: it compares each of position/rotation/scale/flip against the live object and only writes + sets `needsUpdate` when something actually differs; if `needsUpdate`, it sets `isAddScaleChanged = true`, calls `sceneObject.update()` and `sceneObject.historyUpdate()`. `setSceneObjectStateModel` (12513) additionally restores materials (only if the material array differs), `lightInfo`, `configInfo` (re-runs `R2D.replaceObjectWithConfigModel` when config changed — note the `wasConfigInfo` flag set in `setSceneState` line ~12615 handles config→null transitions), logo (`needUpdateLogo`), and parametric (`updateParametric`). So products are **surgically re-applied**, never wholesale reloaded — the live `sceneObject` instances persist across undo because the snapshot holds them by reference.

### 4.2 Construction surfaces: material reapply, walls optimized by change flag

`setConstructionState` (line 12631) walks each surface list from `stateNew.constructionStateObjects` and calls `setMaterial / setAddMaterial / setMaterialRotation / setMaterialShift`, then `build3D()` + `dispatchUpdate()` on the live `constructionObject`.

- **Walls** are optimized: on `forward` (redo) it `continue`s unless `stateObject.wasChanged`; on backward (undo) it `continue`s unless `stateObject.willBeChanged`. So only walls that actually changed between the two states are rebuilt — a perf optimization to avoid rebuilding every wall's 3D geometry. Walls also restore `configData` (rebuilt from `configData.getData()`).
- **Plinths** additionally restore `exists`, `visible`, `shapeNum`, `d`, `h` and run `scene.constructor.checkPlinthVisible`.
- Covers/ceilings/cuts/areas/frames/caps restore materials unconditionally (no change-flag gate — the frame gate is commented out).

`updatePrevState()` (line 12441) is what feeds the wall optimization: after a save it copies the _current_ snapshot's per-wall `wasChanged` into the _previous_ undo entry's `willBeChanged`, so an undo knows which walls to rebuild when stepping back to that entry.

### 4.3 Groups: full rebuild

`setGroupState` (line 12781) rebuilds every group from scratch: `productHelper.addGroup()`, re-adds member object views found via `findObjectView3dBySceneObject`, and restores group transform (position/rotation/flip/scale) and visibility/partialVisibility from the first member.

### 4.4 WallsCommander restore

By contrast the 2D constructor restore (`setData`, 58270) is a **full graph replacement** — it rebuilds `WC.core.roomPoints/coverPoints/arrRooms/arrCovers/arrAreas/walls` entirely from the snapshot. No diffing; the 2D canvas is redrawn (`me.draw()` after `me.state.undo()`, line 61353).

---

## 5. UI sync

### 5.1 SceneHistory → toolbar

`checkStates()` (line 12306) is called after every `saveState`, `undo`, `redo`, `clear`, `removeUndoState`. It maintains booleans `isUndo`/`isRedo` and fires edge-triggered events only on transition:

- `statesUndo` non-empty & was empty → `UNDO_ACTIVE` (`'undoActive'`); became empty → `UNDO_INACTIVE`.
- Same for `statesRedo` → `REDO_ACTIVE` / `REDO_INACTIVE`.

These are exposed as `R2D.SceneHistory.UNDO_ACTIVE/UNDO_INACTIVE/REDO_ACTIVE/REDO_INACTIVE` (lines 12467–12470). Viewers subscribe (`scene.history.addEventListener(R2D.SceneHistory.UNDO_ACTIVE, historyStageEvent)` etc, lines 46425–46428, 47462, 48075). **In this build the `historyStageEvent` handlers are stubbed** (commented-out body, line 46309) — the actual toolbar-button availability is read pull-style via `planner.scene.canUndo()` = `history.isUndo` and `planner.scene.canRedo()` = `history.isRedo` (lines 788–789), refreshed whenever the host receives the `HISTORY_UNDO_REDO` event.

Also fired around every restore: `STATE_UPDATE` (`'stateUpdate'`, before applying) and `STATE_UPDATED` (`'stateUpdated'`, after). A viewer listens to `STATE_UPDATE` (line 41903) to **deselect the active object and active group** before the scene mutates underneath the selection (`historyEvent`, line 41809), preventing a dangling selection reference.

### 5.2 HISTORY_UNDO_REDO event

`api.HISTORY_UNDO_REDO = 'historyUndoRedo'` (defined for both `planner.constr`, line 695, and `planner.scene`, line 773). Dispatched by the host wrapper after operations that change scene contents and history, e.g. after a keyboard nudge (`R2D.scene.history.saveState(); api.dispatchEvent(new Event(api.HISTORY_UNDO_REDO, {removeQuickPanel:false, clearDynamicPanel:false}))`, lines 28566–28567) and after product move/add (lines 43919, 44208, 44247). Payload carries UI hints like `removeQuickPanel` / `clearDynamicPanel`. The host uses this single event to re-query `canUndo/canRedo` and refresh quick panels — it is the app-facing "history changed" signal, distinct from the fine-grained active/inactive events.

### 5.3 WallsCommander → toolbar

The 2D side dispatches `WC.HISTORY_STATE` (`'historyState'`, line 60513) via `dispatchHistoryState()` (line 61379) after every `save`/`undo`/`redo`, carrying `{undo: canUndo(), redo: canRedo()}`. The in-file listener (`historyStateListener`, line 59083) is also stubbed; the host reads `planner.constr.canUndo/canRedo` (lines 755–756).

---

## 6. What is / isn't tracked

**Tracked by SceneHistory** (each an undo step): product add/delete, move (drag release), rotate (input & release), width/height/depth/elevation resize (on release), material assignment, config-model swap, logo, parametric change, grouping/ungrouping, skybox material & rotation, construction-surface finish materials, plinth existence/shape/dims. Every one funnels through `saveState()`.

**Tracked by WallsCommander**: every committed change to the floorplan graph — creating/moving/deleting points, walls, rooms, covers, low-contour areas — via `WC.wallsEditor.save()`.

**Not tracked (transient / view-only)**: camera pan/zoom/tilt (`WHEEL_ZOOM`, `CAMERA_MOVE` are their own events, no `saveState`), selection changes, in-progress drags (gated out by `isMouseDown`), panel open/close state, and pure label changes (`setCurrentLabel`). `removeUndoState` exists precisely to discard states from aborted interactions.

**Interaction with autosave (§7).**

---

## 7. Autosave interaction

`saveState`, `undo`, and `redo` all set `R2D.controller.savedLastChanges = false` (lines 12363, 12401, 12425) — i.e. any history mutation marks the project as having unsaved changes. `wasChanged()` returns `!(sceneIsEmpty() || savedLastChanges)` (line 16397). A successful server/storage save sets `savedLastChanges = true` (lines 15693, 15793, 16147) and triggers `sceneAutoSaveStorage()` (line 15701). So history and autosave are coupled only through this dirty flag: **history does not trigger autosave directly, but every undo/redo re-dirties the project**, so an autosave cycle will re-persist the post-undo state. On project load, `scene.history.clear()` then `saveState()` (lines 15574–15576) establishes a fresh baseline; on error during load, `clearSceneAutoSaveStorage()` is called.

The autosave **cadence** itself (localStorage `r2d_project_<hash>` diff-write every 5 s; server save every 60 s gated on `projectId` + `wasChanged()` + owner) lives in two `setInterval` loops in the controller — documented in `10-serialization-save-format.md` §Autosave cadence, not here.

---

## 8. Template sub-sections

### Interaction

Two entry points: `planner.scene.undo/redo` (3D scene) and `planner.constr.undo/redo` (2D constructor), each reading its own `canUndo/canRedo`. The host binds the global shortcut to whichever surface is active. SceneHistory undo/redo auto-deselects the active object/group first (via `STATE_UPDATE`). Constructor undo/redo forces `stateEditing` before applying (lines 63142, 63149) and redraws the canvas.

### Snapping & constraints

**n/a to history itself.** Snapping/alignment is a live-editing concern in the 2D editor (`WC.snapTool`, `findSnap`, line 61134) and is not part of any snapshot; snapshots store already-resolved point coordinates. Restore does not re-run snapping.

### Data model (snapshot shape)

- **WallsCommander snapshot** (`getData`): `{ roomPoints[], coverPoints[], arrRooms[], arrCovers[], arrAreas[], walls[] }` — a fully deep-cloned, index-relinked geometry graph; `data`/`triangles` shared by reference.
- **SceneHistory snapshot** (`makeState`): `{ stateId, label, sceneStateObjects[], constructionStateObjects{walls,covers,ceilings,cuts,areas,frames,plinths,caps}, groupStateObjects[], skybox{id,r} }`. Transforms/materials copied by value; `sceneObject`/`object` held by reference; `configData` deep-copied.

### Geometry rebuild (restore path)

- Products: **diff by `objectId`** → add/remove/property-apply; only-changed transforms/materials written; `update()` + `historyUpdate()`.
- Construction surfaces: reapply materials + `build3D()`; **walls skip rebuild unless `wasChanged`/`willBeChanged`** for the direction of travel.
- Groups: torn down then rebuilt from scratch.
- Skybox: material + rotation reapplied.
- 2D constructor: **whole graph replaced** and canvas redrawn.

### Edge cases

- Undo/redo on empty stack: warns to console and returns (12381, 12407).
- WallsCommander initial baseline state is non-undoable (`pointer >= 1` required).
- Redo branch discarded on any new edit (`statesRedo = []` in `saveState`; `stack.splice` in WallsCommander).
- Config-model teardown across undo: `wasConfigInfo` flag handles restoring an object that had a config model to a state where it didn't.
- Hidden elements & lights reconciled after every restore (`checkIfHiddenElementsWasReturnedOrDeleted`, `checkForLightObjectsToEnableOrDisable`).
- Cross-system consistency only refreshed when scene history is empty (line 62350) — otherwise past scene snapshots keep their originally-captured construction material state.
- Stack cap (100) declared but not enforced in this build — **must add explicit trim**.

### Confidence & gaps

- **High confidence**: two-stack architecture and independence; SceneHistory three-slot (undo/redo/current) model; coalescing rule (exact one-line guard, 12351); product diff-restore; wall change-flag optimization; UNDO/REDO active/inactive edge-triggered events; `HISTORY_UNDO_REDO` as the app-facing signal; dirty-flag coupling to autosave; WallsCommander index-relinking clone. All cited to concrete line numbers.
- **Medium confidence**: exact intended trigger for the `'productSizes'` label — the guard exists but no live call site passes that label in this build, so real coalescing today rides mostly on the `isMouseDown` gate; treat the label path as designed-but-dormant scaffolding to wire deliberately in our build.
- **Gaps**: (1) `maxActions = 100` is not enforced in the visible `saveState`; whether a trim was removed or lives elsewhere is unconfirmed — assume we must implement the cap. (2) The concrete toolbar button-enable handlers (`historyStageEvent`, `historyStateListener`) are stubbed in this file, so the _presentation_ layer of button availability lives in host code not present in `plannercore.js`; we inferred it is pull-style via `canUndo/canRedo` refreshed on `HISTORY_UNDO_REDO`. (3) The precise host policy for routing a single Ctrl+Z between the 2D vs 3D stack is host-side and not in this file.
