# 07 — Measurements, Rulers & Dimensions (competitor mechanics)

> Reverse-engineered from the competitor's un-minified `plannercore.js` (81 349 lines).
> Namespaces: `WC` (2D walls editor / canvas), `R2D` (scene, dimension system, 3D), `TR` (geometry helpers).
> All line numbers refer to that file. This is a behavioral spec for our own re-implementation — own words, cited symbols, short snippets only.

There are **two independent ruler subsystems** plus an **automatic wall-dimension** system and an **inline editable-dimension** system. Do not conflate them:

| Subsystem                 | Namespace                              | Where                     | Persisted                       | Purpose                                       |
| ------------------------- | -------------------------------------- | ------------------------- | ------------------------------- | --------------------------------------------- |
| 2D manual ruler           | `WC.Ruler`, `WC.StateMakingRuler` etc. | 2D constructor canvas     | yes (`customRulers`)            | user draws a measurement line on the 2D plan  |
| 3D manual ruler           | `R2D.CustomRulers` / `R2D.RulerAB`     | 3D viewport               | yes (same `customRulers` field) | same measurement, drawn/edited in 3D          |
| Auto wall dimensions      | `drawSize` / `drawPolygonSizes`        | 2D canvas                 | n/a (derived)                   | length label auto-drawn on every wall segment |
| Inline editable dimension | `SizesFromKeyboard` (`WC.SFK`)         | DOM `<input>` over canvas | n/a                             | type a number to move geometry                |
| Transient 3D object ruler | `R2D.Ruler3D` (line 38226)             | 3D viewport               | no                              | live spacing hints while dragging furniture   |

The 2D `WC.Ruler` list and the 3D `R2D.CustomRulers` list are two views of the **same stored data** (`wallsData.customRulers`), rebuilt from it whenever you switch view.

---

## A. Dimension system / units

### Data model & configuration

- `R2D.DimensionSystem` (line 10741) is a static singleton with four systems (line 10745): `METRIC_CM = 0`, `IMPERIAL_FT = 1`, `METRIC_MM = 2`, `METRIC_M = 3`.
- **Internal unit is centimetres.** Every stored coordinate/length is in cm; the dimension system only converts cm ↔ display string. Default system is set at boot to `METRIC_CM` (line 28: `R2D.DimensionSystem.setSystem(R2D.DimensionSystem.METRIC_CM)`).
- `setSystem` (line 10757) swaps `_currentSystemInterface` to one of `MetricCM` / `ImperialFT` / `MetricMM` / `MetricM` and fires a `CHANGE` event so the UI can re-render. Public API is exposed on `planner.units.*` (lines 1008–1019): `getSystem/setSystem/valueToString/stringToValue/squareToString/getStep/getName`.
- Each interface carries `_name`, `_isMetric`, `_step` (grid/keyboard step): CM step `1`, M step `1`, MM step `0.1`, FT step `1.27` (= ½ inch in cm).

### Formatting (`toString`, cm in → string)

- **MetricCM** (line 10836): `toFixed(1)`, then strips a trailing `0` and trailing `.` → e.g. `250` → `"250"`, `250.5` → `"250.5"`.
- **MetricM** (line 10858): divides by 100, `toFixed(3)`, strips up to three trailing zeros → `"2.5"`.
- **MetricMM** (line 10896): `Math.round(cm * 10)` → integer mm string.
- **ImperialFT** (line 11178): splits cm into feet + inches + fraction and prints `5' 3 1/2"` style. Uses constants `_FOOT_TO_CM = 30.48`, `_INCH_TO_CM = 2.54`, symbols `'` and `"`. Fractions are rounded to the nearest **1/16 inch** (`_approximate = 0.0625`, line 10925). Fraction reduction uses a binary-GCD helper `_getGCD` (line 10942) and `_getFractionString` (line 10967). Carry handling: if the residual fraction is within `0.001` of a whole inch it rounds up and rolls inches→feet. Output branches on the 8 combinations of (feet? inch? fraction?) — e.g. `0'`, `3/4"`, `7"`, `7 3/4"`, `5'`, `5' 3/4"`, `5' 3"`, `5' 3 3/4"`.

### Parsing (`fromString`, string → cm)

- **Metric**: replaces `,`→`.` then `parseFloat`; MetricM multiplies by 100, MetricMM divides by 10 (lines 10826, 10852, 10890).
- **Imperial** is a full tolerant parser: `_normalizeString` (line 10995) → `_parseImperial` (line 11119) → cm.
  - Accepts `ft/feet/foot`, `in/inch/inches`, `'`, `"`; unicode primes (`′ ″ ‘`) normalised; unicode vulgar fractions (`¼ ½ ¾ ⅓…`) expanded; mixed numbers `5 3/4"`; thousands separators.
  - Returns an **error object** `{error: "…"}` (localized Ukrainian strings) on: empty, `≥3` prime chars, negative when not allowed, a bare number with no unit, ambiguous decimal, out-of-range (`_MAX_INCHES = 12000`). A **unit-less number is interpreted as feet** (line ~11085).
  - Callers check `fromString(...).error` and, if present, dispatch `SHOW_ALERT_POPUP` instead of applying (see the input Enter handler below).

### Area formatting (`squareToString`, cm² → string)

- MetricCM (line 10841): `(sqrt(v)/100)² .toFixed(2) + " m²"`. MetricM/MM: `v/10000 .toFixed(2) + " m²"`. Imperial (line 11249): `v/10000 / 0.0929 .toFixed(2) + " sq. ft."`.

---

## B. Auto wall-length dimensions (2D)

### Interaction

- Drawn automatically on every room/wall segment on the 2D constructor canvas. Toggle flag `WC.wallsEditor.sizesVisible`, default **true** (line 60530). A toolbar button flips it (line 59195) and updates its face.
- Entry: main `draw()` (~line 63819) calls `drawPolygonSizes(room)` for each room in `WC.core.arrRooms`.

### Rebuild / render

- `drawPolygonSizes(room, anyway, reverse)` (line 63368): iterates the room's point loop and calls `drawSize(pts[i], pts[i+1], k, anyway)` per edge (plus the closing edge). `k` is the **offset side** (`+1`, or `-1` for outer/reverse rings) — the label is pushed perpendicular to the wall.
- `drawSize(A, B, k, anyway)` (line 63163):
  - Length = `TR.euclDistP(A, B)`, text = `R2D.DimensionSystem.toString(dist.toFixed(1))`.
  - Converts A/B to view coords; when `anyway`, clips the segment to the canvas rectangle (`TR.lineIntersectLine` against the 4 edges) so the label of an off-screen wall still appears on-screen.
  - Text placed at segment midpoint, offset perpendicular by `10 * k` px (`{x: px + dy, y: py - dx}`), rotated to the wall angle (`Math.atan2(dy,dx)`, normalized to keep text upright between ±90°).
  - Registers the drawn label into `WC.SFK.addSizeData({...})` (see §D) so it becomes a clickable hit-target with an editable input.

### On-screen thresholds (numeric)

- **`minLen = 30` px** (line 63170): if `dist * scale < 30` and not at max zoom, skip the label entirely.
- **Text-fit gate** (line 63229): if the on-screen segment length `< measureText(text).width + 30` px, skip — prevents labels overflowing a short wall.
- At `scale == maxScale` (max zoom, `maxScale = 20`, line 79201) both gates are bypassed so labels always show when fully zoomed in.

### Not present

- **No** automatic overall/exterior bounding-box dimension chain.
- **No** automatic corner-angle (`°`) labels. Angles are computed internally (`atan2`) only to orient text and for snapping, never rendered.
- Room **name + area** are a separate DOM overlay (`R2D.TitlesTool` line 39842, `R2D.TitleElement` line 40040): area via `TR.contourArea` (shoelace, line 49515) → `/10000` cm²→m² → `squareToString`; title auto-placed at an interior grid point inside the room. Name and area have independent visibility flags per viewer, and separate PDF-export toggles (`showRoomName`, `showRoomArea`, `showSizes`).

---

## C. Manual ruler tool

### C.1 — 2D ruler (`WC.Ruler` + states)

**Data model — `WC.Ruler(A, B)` (line 57191).** Two "aligners":

```
me.aligner1 = {center: TR.Point, dragPt: TR.Point, state: 'done'}
me.aligner2 = {center: TR.Point, dragPt: TR.Point, state: 'up'}
```

- `setCoordsToRulerPoints(A,B)` sets the two centers.
- `calcDragPoints()` (line 57202) computes hit-test drag points 1px above each center (in scale units) and initializes `hover.state = false`.
- Extra fields added at render time: `me.angle`, `me.value` (last formatted string), `me.bounds` (4-corner label rect), `me.isHovered`, `me.selected`.
- All rulers live in the array `WC.wallsEditor.rulers` (line 60664).

**Placing a ruler — `WC.StateMakingRuler` (line 68648):**

1. `start()` (line 68662): hides cursor, hides other inputs, switches `WC.SFK.state` to `stateMakingRuler`, makes input width auto, creates a temporary `WC.Ruler` at the cursor, marks it `selected`, fires `RULER_TIPS_CHANGE = "rulerCreate"`.
2. `mouseMove(e)` (line 68727): updates `WC.SFK.validInputValue` to the current length string; records `ctrlKey`; redraws.
3. `findSnap()` (line 68721): `WC.snapTool.snapPolygon([cursor], …, WC.SNAP_DIST/scale)` where `WC.SNAP_DIST = 10` (line 60604). Result feeds `WC.snapPos` and up to 3 alignment guides `WC.aligners`.
4. First `mouseUp()` (line 68736): commits `startPoint` (snapped unless Ctrl held).
5. Second `mouseUp()`: `tmpRuler.calcDragPoints()`, `rulers.push(tmpRuler)`, transition to `stateEditing`.
6. `draw()` (line 68753): draws all existing rulers, an "up" pin icon at the free endpoint, and — while dragging the second point — the temp ruler **dashed**, plus an editable length input over the midpoint. **Angle snapping** (line 68779): unless Ctrl is held, the free endpoint is snapped to the nearest of 0°/45°/90°/135°/180°/225°/270°/315° (each within a ±1°–2° window) by recomputing `endPoint = start + dist*(cos θ, sin θ)`.

**Dragging an endpoint — `WC.StateDraggingRuler` (line 68823):** grabs the clicked aligner, snaps while dragging (`snapPolygon`, Ctrl disables snap), and on release goes to `stateSelectedRuler` (`selectedType = "aligner"`) if it was a click, else back to `stateEditing`. A sibling `WC.StateDraggingRulerLine` (line 64114) drags the whole line (`selectedType = "line"`).

**Selecting / nudging / deleting — `WC.StateSelectedRuler` (line 68959):**

- `moveLeft/Right/Top/Bottom(dist)` nudge either one aligner (`selectedType=="aligner"`) or both (`"line"`) by keyboard.
- `delSelectedRuler()` (line 69089): finds the ruler whose aligner (or the ruler itself) matches `currentAligner` and `rulers.splice(i,1)`, then returns to `stateEditing`. The editor's global delete key also routes here (line 60806).

**2D rendering — `drawRuler` / `drawRulerLabel` / `drawRulers` (lines 63564 / 63664 / 63737):**

- `drawRulers` (line 63737): loops `WC.wallsEditor.rulers`; a ruler is drawn **dashed** if it is the `currentRuler` or the editor is in `stateSelectedRuler` with an aligner selected; calls `drawRuler` + `drawRulerLabel`; then `WC.SFK.checkRulerHoverSize()`.
- `drawRuler`: two stacked strokes — a 3px white outline, then a 1px colored core: **magenta `#F92FDD`** normally, **lime `#B9E31F`** on hover. Dashed uses `setLineDash([5])`. Endpoint icons (`imgDone` / `imgRulerOver` / `imgUp`, from `R2D.STYLE.DRAWING_RULER_ICON_*`) are drawn per aligner state, rotated to `angle - π`. Stores `ruler.angle`.
- `drawRulerLabel`: text = `R2D.DimensionSystem.toString(TR.euclDistP(a1,a2))` at the midpoint in a white rounded-rect (`roundRect` radius 3, height 24, `measureText+20` wide), light-grey when hovered; stores `ruler.value` and a 4-corner `ruler.bounds` for click hit-testing. When the ruler is the `selectedSizeData`, it clears the rect instead (the DOM input takes over).
- `checkRulerHoverSize` (line 71516): point-in-bounds test → sets `isHovered`, cursor `text`/`default`.

### C.2 — 3D ruler (`R2D.CustomRulers` / `R2D.RulerAB`)

- Manager `R2D.CustomRulers(scene3d, wallsData, api)` (line 38555), singleton via `.init` / `._instance`; reached as `mih._customRulers` / `scope._scene3d.customRulers`. Holds `rulers[]`, `creating`, `newVectors[]`, `selectedRuler`, `selectedAligner`, `draggingRuler`.
- **State glue — `R2D.MIH.StateCreatingRuler` (line 43716):** `start()` on desktop calls `addRuler()` (arm creation); on phone `createNewRuler()` + back to `stateMain`. `mouseUp/touchEnd` → `addPoint(e)`; when `isCreating()` turns false → `stateMain`. `stop()` → `_cancel()`. Drag/select states call `_customRulers.disableRulers()/activateRulers()` so rulers don't fight furniture dragging (lines 43788/43795 etc.).
- **Creation:** `addRuler()` (line 38708) arms; `addPoint(e)` (line 38881) raycasts onto the scene mid-plane, storing `newVectors[0]` then `newVectors[1]`; on the 2nd point builds `new R2D.RulerAB(v0, v1, this)`, pushes to `rulers[]`, adds `r.line` to `scene3d` "top" layer. `createNewRuler()` (line 38926) auto-creates one from the camera look-direction down to terrain (phone one-tap).
- **`R2D.RulerAB` (line ~39716):** endpoints `A`,`B` as `THREE.Vector3` with **y = 0**; `length = A.distanceTo(B)`; DOM overlay elements `elemA`,`elemB` (endpoint flag icons), `elemVal` (dimension text), `elemInput` (editable length); dashed red 3D line via `THREE.LineDashedMaterial`.
- **Live length:** `viewUpdate()` (line 39324) projects each ruler's center to the camera viewport and repositions the HTML label; text = `R2D.DimensionSystem.toString(ruler.length)`.
- **Endpoint drag:** `elemDownListener`→`elemDragListener`→`elemUpListener` (lines 39231/39254/39305). Drag raycasts to a new scene point; **angle snap** to 8 directions unless Ctrl; a <200 ms press is treated as a **click → select** the aligner, longer → move. Re-adds the line and calls `viewUpdate`.
- **Delete:** `delRuler(ruler)` (line 39405) removes the 3D line + all DOM elements and `rulers.splice(...)`. `_cancel()` (line 39579) aborts an in-progress creation.

### Persistence & cross-view rebuild

- Stored form: `wallsData.customRulers` = array of `[A, B]` where each is a `THREE.Vector3 {x, y:0, z}`.
- **3D export** `exportData()` (line 39015): `customRulers = rulers.filter(!removed).map(r => [r.A, r.B])`, called on hide.
- **3D import** `importData()` (line 38972): clears then rebuilds `R2D.RulerAB(new Vector3(x,0,z), …)` from the stored pairs, called on show.
- **2D ↔ store:** the 2D editor rebuilds its `rulers` from `obj.customRulers` mapping `[r0, r1]` → `new WC.Ruler(TR.Point(r0.x, r0.z), TR.Point(r1.x, r1.z))` (line 61606), and serializes back the other way in `getStructure()` (line 62003): `[Vector3(a1.center.x,0,a1.center.y), Vector3(a2.center.x,0,a2.center.y)]`. **Note the axis mapping: 2D `y` ↔ stored/3D `z`.**

---

## D. Inline editable dimensions (`SizesFromKeyboard` / `WC.SFK`)

The click-a-dimension-and-type-a-number system. `WC.SFK = new SizesFromKeyboard()` (line 71577); class at 71289.

### Data model

- `sizesData[]` — every auto-drawn wall label registered by `drawSize` via `addSizeData` (line 71355): stores `{A, B, k, ang, value, bounds(4 corners), center, inputCenter, pointAtStart, pointAtEnd}`. `pointAtStart/End` decide which wall endpoint moves.
- `selectedSizeData1..4` / `selectedSizeData` — the label(s) currently being edited; `widthData` — a separate wall-thickness dimension.
- Four reusable DOM inputs `inputDomEl1..4` (`CreateInput` instances) + `inputDOMWidth`; `activeInput`; `validInputValue` (last accepted text, for input sanitization).
- Internal FSM states (own classes, all extend `BaseState`, line 69759): `baseState`, `SelectedWall` (70050), `SelectedPoint` (70324), `MakingWalls` (70829), `MakingRect` (70934), `MakingRoom/Cover/Area`, `MakingRuler` (71187), `SelectedRuler` (70643). `WC.SFK.state` points at the active one.

### The DOM input — `CreateInput` (line 69562)

- Absolutely-positioned 26px-tall flex container, default 70px wide, `z-index 100`, 1px border (`#E9E9E9` standard / `#dd0066` width), 10pt font. Width grows with text: metric `(len+1.9)*8`px, imperial `(len+1)*7`px.
- `updateInput(data, dom)` (line 69942) positions it centered on `data.inputCenter`, rotated to the segment angle (`transform: rotate(θrad)`), and fills `input.value = data.value`. For metric it also appends a unit suffix label (`addDimension` → `getName()`); imperial shows no suffix (units are in the value).
- **Live input sanitization** (`inputStandardListener`, line 69671): metric restricts to `/^[+-]?[0-9]*([,.]?[0-9]*)?$/`, reverting to `validInputValue` on violation; imperial accepts free text (validated only on commit). Typing also drives an `ArrowAnimation` hint showing which way the wall will move.

### Commit — how typing a value moves geometry

- **Enter** handler `keydownListener` (line 69634):
  - Metric: reject empty/`+`/`-`; replace `,`→`.`.
  - Imperial: `fromString(value)`; if falsy or `.error`, dispatch `SHOW_ALERT_POPUP` and abort.
  - Call `this.state.updateConstruction(target)` then `afterUpdateConstruction()`; hide inputs (except in `stateMakingRect`, which keeps them for the next segment); fire `CHANGE_AREA_VALUE`.
- **Delta convention (all states):** a leading `+`/`-` means _relative_ (`delta = ±fromString(rest)`); otherwise _absolute_ (`delta = fromString(new) − fromString(oldValue)`). `dx = delta·cos(ang)`, `dy = delta·sin(ang)`.
- **`SelectedWall.updateConstruction` (line 70110):** editing the length input moves **both** endpoints symmetrically by half: `pointAtStart.move(-dx/2,-dy/2)`, `pointAtEnd.move(+dx/2,+dy/2)`. Editing the **width** input translates both endpoints perpendicular by the full delta. `afterUpdateConstruction` (line 70152) rebuilds walls/covers and saves.
- **`SelectedPoint.updateConstruction` (line 70375):** moves only the selected endpoint by the full `dx,dy` (the one that isn't fixed).
- **`MakingWalls.updateConstruction` (line 70862):** while drawing, recomputes the angle from the previous point, and repositions the just-placed point to `prev + delta·(cosθ,sinθ)`; auto-closes the contour if the new point lands within `wallsWidth` of the last, or within `0.1` of the first point.
- **`BaseState.updateConstruction` (line 69887, used by MakingRoom/Area/Cover):** input1 moves the last-placed point along the drawing direction; input2 (shown once the contour has >2 points) moves the **first** point, extending the chain from the other end.
- **`MakingRuler.updateConstruction` (line 71216):** moves `aligner2` by the full delta along the ruler angle (grow/shrink from the fixed start); `calcDragPoints()`; `afterUpdateConstruction` pushes the temp ruler into `rulers` and returns to `stateEditing`.
- **`SelectedRuler.updateConstruction` (line 70727):** edits an existing ruler's length by moving **both** aligners symmetrically ±dx/2, ±dy/2; `calcDragPoints()`; save.
- `SelectedRuler` reuses the same `inputDomEl1` HTML box, positioned over the ruler-label midpoint (`updateInput`, line 70753), so editing a ruler feels identical to editing a wall dimension.

### Live thresholds during wall/rect drawing (min on-screen px)

- Base size labels: **30px** (`minLen`, line 63170) + text-fit (`+30px`).
- Wall/room/area draft segments: **45px** (`minLen`) gate before an editable input is shown for the last segment.
- Rectangle corner segments: **70px** (`minLen`) — a rect only shows its two edge inputs once both leading edges exceed 70px on-screen.

### Repositioning on pan/zoom

- `updateInputsAfterDraggingCanvasOrZoom()` (line 70016) re-selects the active input and clears per-state `checkPt` caches so the input box follows the geometry after a viewport change.

---

## E. 2D vs 3D visibility summary

- **Auto wall dimensions**: 2D only (canvas `drawSize`), toggled by `sizesVisible`.
- **Room name/area**: DOM overlay, visible in 2D and 3D viewers via independent per-viewer flags.
- **Manual rulers**: authored/edited in **both** 2D (`WC.Ruler`) and 3D (`R2D.RulerAB`), sharing one persisted list; the 3D form projects HTML labels into the viewport while drawing a dashed 3D line.
- **Transient object spacing** (`R2D.Ruler3D`, line 38226): 3D-only, auto-generated while dragging furniture, never saved.

---

## F. Edge cases

- **Ctrl held** disables snapping (both endpoint-snap and 8-way angle snap) in 2D and 3D ruler drawing.
- **Angle snap windows** are tight (±1°–2°) so free-angle rulers are still easy to draw.
- **Imperial parse errors** never crash: they return `{error}` and surface a popup; the geometry is left unchanged.
- **Imperial rounding** to 1/16" can make a committed length differ slightly from the typed decimal; carry logic rolls 12" → 1'.
- **Very short segments**: label hidden below 30px (or 45/70 while drafting) and when the text can't fit; both gates lifted at max zoom (`scale == maxScale`, 20×).
- **Off-screen walls**: `drawSize` clips the segment to the canvas rect so the midpoint label is still visible.
- **Axis remap on save**: 2D `y` is persisted as `z`; a re-implementation must keep this mapping or 2D/3D rulers will disagree.
- **Deletion**: 2D matches by aligner identity (`splice`); 3D also tears down DOM overlay elements — forgetting either leaks nodes.
- **MetricM/MM string stripping** removes trailing zeros, so `"2.500"`→`"2.5"`, `"2.000"`→`"2"`; round-tripping relies on `fromString` re-scaling.

---

## G. Confidence & gaps

- **High confidence**: dimension-system unit math and formatting (read directly, §A); auto wall-dimension `drawSize` + thresholds 30/45/70px (read directly, §B/§D); 2D `WC.Ruler` data model, `StateMakingRuler`/`StateSelectedRuler`, `drawRuler`/`drawRulerLabel`, delete (read directly, §C.1); the `SizesFromKeyboard` commit pipeline and per-state `updateConstruction` geometry moves (read directly, §D); persistence pairs `[A,B]` and the 2D-`y`↔3D-`z` remap (read directly).
- **Medium confidence**: `R2D.CustomRulers` / `RulerAB` 3D internals (endpoint drag <200ms click threshold, `viewUpdate` projection, import/export, `_cancel`) — sourced from a focused sub-agent sweep with cited line numbers but not every method re-read line-by-line here. Exact DOM structure of the 3D ruler input and its Enter handler was not opened directly (assumed to mirror `RulerAB.elemInput`).
- **Gaps / not confirmed**: whether the 3D ruler length input reuses the same imperial/metric validation as `WC.SFK` (likely, but not verified); the precise contents of `R2D.STYLE.DRAWING_RULER_ICON_*` assets; the exact interior-point search used to place room-name/area labels (only outline seen); and whether any keyboard step (`getStep`) is applied to ruler nudging vs. free movement. No automatic angle labels or exterior dimension chains exist (confirmed absent).
