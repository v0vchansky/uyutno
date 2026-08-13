# Floorplan Image Import & Alignment (underlay tracing)

Reverse-engineered from an un-minified competitor `plannercore.js` (namespaces `WC`, `R2D`, `IMAGE`, `FILE`). All line numbers refer to that file. This is a functional spec written in our own words; snippets are illustrative fragments only.

## Summary of the mechanic

The competitor lets the user load a raster/PDF floorplan as a **2D underlay** ("drawing") shown behind (or above) the wall editor at a fixed opacity. The underlay carries its own transform independent of the editor viewport: a **uniform scale** (`drawingScale`), a **rotation** (`drawingRotation`), and a centering offset (`drawingX/Y`). To make the underlay match real-world units, the user runs the **alignment tool** (`WC.StateAlignDrawing`): they drag a two-handle reference ruler onto a feature of known length, type that length in cm, and the whole underlay is scaled (and optionally rotated) so that ruler now measures the entered length. There is **no image analysis / wall auto-detection** — alignment is purely a manual one-segment scale gesture. The underlay is a tracing aid only; the editor does not snap walls to it.

---

## Interaction (state machine)

### Entering the underlay flow

- Public entry points: `planner.constr.uploadPlan` → `WC.wallsEditor.startUploadDrawing(preloaderNeed)` (`734`), and `setPlanDrawing(imgSrc)` (`62144`) for a programmatically supplied source.
- `startUploadDrawing` (`62115`) returns a Promise. It builds an `R2D.ImagesLoader`, opens the OS file picker via `FILE.openImage(procImg, "image/png, image/gif, image/jpeg, application/pdf", preloaderNeed)` (`62140`), loads the chosen file, and on `Event.COMPLETE`:
  - `setImageDrawing(e.data[0])` stores the `Image` (`62122`);
  - `me.draw()` repaints;
  - sets `stateAlignDrawing.newDrawing = true` and `floorPlanDrawingsChanged = [true]`;
  - sets the 3D helper to `R2D.DrawingHelper.STATE_ABOVE`;
  - resolves by transitioning: `me.changeState(me.stateAlignDrawing)` (`62131`).
- So **uploading an image immediately drops the user into the alignment state**, with `newDrawing` true.

### `WC.StateAlignDrawing` — the align/scale state (`67692`)

A `WC.BaseState` subclass driving a HTML5 canvas overlay (`#canvasConstructor`). Internal model:

- Two ruler handles `alignerH1`, `alignerH2` (`67702`), each `{center: TR.Point, dragPt: TR.Point, angle, state}`. `aligners = [alignerH1, alignerH2]`. Defaults span (50,0)→(250,0) via `initValues` (`67795`).
- The segment between the two handles is the **reference line** ("H" ruler). `distanceH` holds the user-entered real length; `distanceV` exists but the vertical ruler is unused (always 0 in `getRulersData`, `68276`).
- Only a single **horizontal** reference segment is used; the code has vestigial "V" branches (`changeV`, `distanceV`) that are never exercised in this build.

`start()` (`67742`): hides title tool, `recalcDragPts()`, grabs canvas, arms an arrow-hint animation. If `newDrawing` it returns state `stateAlignDrawing` and plays a fade-in "black rect" spotlight (`blackRectOpacity=1`, faded over `fadeDuration=2000ms` in `rectangleAnimation`, `68310`); otherwise `blackRectOpacity=0` (no spotlight on re-alignment).

Pointer sub-states (mutually exclusive flags):

| Sub-state       | Trigger (mouseDown)                                                                                                   | Behavior (mouseMove)                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drag a handle   | `overAligner` set → `dragAligner` (`67816`)                                                                           | Rotates/repositions that endpoint about the other endpoint as pivot; keeps a tiny perpendicular offset via `TR.pointAtAngle`; angle-snaps to cardinals/diagonals unless Ctrl held (`67871`). |
| Drag whole line | `overH` set → `dragLine` (`67833`)                                                                                    | Translates both handles by the mouse delta (`67890`). `isDragging` latches once moved >5 units.                                                                                              |
| Edit length     | `overRect` (click the size label) → mouseUp returns `{state:"stateAlignDrawing", action:"alignerWidthSet"}` (`67943`) | Opens the length-input dialog (below).                                                                                                                                                       |
| Select          | short click (<200 ms, `downTime`) on handle/line                                                                      | Marks `selectedAligner`/`selectedLine` for keyboard nudging; emits `RULER_TIPS_CHANGE` tips (`67926`–`67937`).                                                                               |

`mouseDown` also disables wheel/right-drag panning (`wheelEnabled=false`, `rightEnabled=false`) and hides cursor while dragging (`67843`). `mouseUp` restores them.

### Entering the length

- Clicking the on-line size label enters `action:"alignerWidthSet"` and sets `changeH=true` (`67942`).
- The host UI reads the current value via `planner.constr.getPlanAlignLength()` → `getAlignerValue()` (returns `distanceH` while `changeH`, else `NaN`; `68034`) and writes the entered value via `planner.constr.setPlanAlignLength(length)` → `setAlignerValue(val)` (`68041`). `setAlignerValue` accepts `parseInt(val) >= 0`, stores it into `distanceH`, clears `changeH/changeV`, redraws. The dialog value is parsed through `R2D.DimensionSystem.fromString` and unit choice via `WindowChooseUnits` (`58492`–`58503`).

### Committing / leaving

- `stop()` (`67757`) always calls `me.scaleDrawing()` and `dispatchDrawingChanged()`, tears down animations, clears selection, resets tips.
- `stopAlignDrawing(rotate)` (`60743`) is the explicit "done" path: it checks `state.drawingCorrect()` (`68299` → `distanceH > 0 || drawingScale > 1`). If valid, sets `rotateDrawing = rotate`, fires `WC.DRAWING_ALIGNED`, transitions to `stateEditing`. If invalid it returns an error `{type:"text_incorrect_length"}` (`60759`) — you cannot leave with an unscaled brand-new drawing.
- Keyboard nudge: `moveLeft/Right/Top/Bottom(dist)` (`68366`+) shift the selected handle or the whole line by `dist` for fine positioning.

### Alternate: `WC.StateAlignDrawingByArea` (`68434`)

A second, area-based aligner. User traces a closed contour; scale is derived from a typed area: `addScale = sqrt(areaValue / contourArea)` then `drawingScale *= addScale` (`68575`). Shares the same drawing transform. Secondary path; the primary is the known-length line.

---

## Snapping & constraints (thresholds)

- **Handle pick radius:** `WC.SNAP_DIST * 1.5 / scale` in real units (`67976`), with `WC.SNAP_DIST = 10` (`60604`) → ~15 view-px.
- **Line hover radius:** point-to-segment distance `< WC.SNAP_DIST * 1.5` (=15 px) in view space, only within the segment (`dotProduct` in [0,1]) and not over the label rect (`67989`–`68006`).
- **Label hit test:** `isCursorInsideRect` with a ±5 px vertical pad (`67991`).
- **Angle snapping of the ruler** (unless Ctrl): endpoints snap to 0/45/90/135/180/-45/-90/-135° within ±1° (and diagonal within ±1° of ±45/±135°) — see the `neededAngle` ladder (`67877`). Ctrl disables the snap for a free angle.
- **Click-vs-drag threshold:** 200 ms (`downTime`, `67926`) distinguishes a selecting click from a drag; and >5 real-units of travel latches `isDragging` (`67904`).
- **Editor→underlay snapping: NONE.** No code path snaps wall vertices to the underlay image; the underlay is a passive raster. Confirmed by absence of any `snap … imgDrawing` reference. The align ruler snaps only to cardinal/diagonal angles, not to image content (there is no image feature detection).

---

## Data model

Underlay lives on `WC.wallsEditor` (the 2D sub-editor):

- `imgDrawing` — the loaded `Image` (`62086`); `imgSrc`.
- `drawingScale` (default 1), `drawingRotation` (default 0) — the underlay transform (`62092`–`62094`, guarded against NaN/undefined).
- `drawingX = -imgDrawing.width/2`, `drawingY = -imgDrawing.height/2` — centering offset so the image is centered on world origin (`62095`).
- `drawingPosition` ∈ { `WC.DRAWING_ABOVE`='drawingAbove', `WC.DRAWING_BELOW`='drawingBelow', `WC.DRAWING_HIDE`='drawingHide' } (`60515`–`60517`, default `DRAWING_ABOVE` `60662`) — layer + implicitly opacity.
- Align ruler state via `getRulersData()/setRulersData()` (`68266`/`68286`): `{horizontal:{size,ax,ay,bx,by}, vertical:{…zeros}}`.

Lifecycle:

- `setImageDrawing(img)` (`62089`) sets the image and derives centering; `delImageDrawing()` (`62099`) nulls it, calls `stateAlignDrawing.initValues()`, fires `WC.DRAWING_REMOVED` + `dispatchDrawingChanged()`.
- Events: `WC.DRAWING_UPLOADED`, `WC.DRAWING_CHANGED`, `WC.DRAWING_REMOVED`, `WC.DRAWING_ALIGNED`.

### Persistence

- `getDrawingData()` (`55308`): returns `null` if no `imgDrawing`; else
  `{ drawing:{ scale, rotation, source: imgDrawing.src }, rulers: getRulersData() }`.
  **`source` is the image's own `src`** (a data-URL if loaded from local file, or a URL) — the pixels are serialized inline, there is no separate asset store here.
  Note: `drawingX/Y` (centering) and `drawingPosition/display` are **not** in this object — display is round-tripped separately (below), and X/Y are recomputed from image size on reload.
- `setDrawingData(data)` (`55276`): restores `drawingScale`, `drawingRotation`, maps `data.drawing.display` (2/1/0) → ABOVE/BELOW/HIDE, then async-loads `data.drawing.source` via `R2D.ImageUrlLoader`; on complete calls `setImageDrawing`, fires `DRAWING_UPLOADED`+`DRAWING_CHANGED`. Finally `stateAlignDrawing.setRulersData(data.rulers)` — which re-runs `scaleDrawing()`, so **restoring the rulers re-applies the scale** (see edge cases).
- Scene-level (`R2D.commonSceneHelper`) round-trips `floorplanData['drawing']['display'] = drawingHelper.state` (`15664`/`15751`) and reads it back on load (`15547`). So layer/visibility persists as an integer 0/1/2.

So: **yes, the underlay persists** across save/load (source pixels + scale + rotation + rulers + display layer).

---

## Geometry rebuild (2D display)

`drawBG(opacity)` (`63499`) paints the underlay each frame before/after walls:

1. Early-return if no `imgDrawing`.
2. Compute view coord of world origin `realToView((0,0))`.
3. `globalAlpha = opacity`; translate to origin; `rotate(drawingRotation)`; `scale(editorScale * drawingScale)`; `translate(drawingX, drawingY)`.
4. Draw the image at (0,0) only if fully loaded (`imgDrawing.complete && naturalWidth/Height != 0`) (`63511`).
5. Unwind every transform and reset `globalAlpha = 1`.

Layering & opacity are keyed off `drawingPosition` in each editor state's `draw()`:

- `DRAWING_BELOW` → `drawBG(0.3)` before drawing walls (`63794`), so image sits under walls at 30% opacity.
- `DRAWING_ABOVE` → `drawBG(0.5)` after walls (`63805`), so image sits over walls at 50%.
- The align state itself draws the underlay at full `drawBG(1)` (`68256`).
- `DRAWING_HIDE` → neither branch fires → not drawn.

Opacity is therefore **fixed per layer (0.3 below / 0.5 above)**, not a user slider.

### Scale computation — `scaleDrawing()` (`68220`) — the core of alignment

```
if (distanceH == 0) return;
addScale = distanceH / TR.euclDistP(alignerH1.center, alignerH2.center); // cm per drawing-unit
WC.wallsEditor.drawingScale *= addScale;               // grow/shrink the underlay
aligners[i].center *= addScale;                         // keep ruler consistent with new scale
if (rotateDrawing) {
    ang = atan2(dx, dy) - PI/2;                         // make the ruler horizontal
    WC.wallsEditor.drawingRotation += ang;
    rotate both aligner centers by ang;
}
recalcDragPts();
```

Meaning: the reference segment's current pixel/unit length maps to the typed real length `distanceH`; the multiplicative correction `addScale` is folded into `drawingScale`. If "align with rotation" was chosen, the underlay also rotates so the reference segment becomes horizontal. The ruler endpoints are scaled/rotated in lockstep so a subsequent re-align starts from the corrected geometry. `recalcDragPts()` (`68014`) recomputes each handle's perpendicular drag point (offset by `1/scale`) and the shared segment angle.

### 3D underlay — `R2D.DrawingHelper.Drawing` (`41223`)

For the 3D view the same image becomes a textured plane: `makePlaneGeometry(nearWidth/scaleX, nearHeight/scaleY)`, scaled by `imageScale`, rotated `makeRotationY(imageRotation)`, `MeshBasicMaterial` with `transparent:true, opacity:0.3` (`41257`). States `STATE_ABOVE=2 / BELOW=1 / OFF=0` (`41219`) mirror the 2D layer.

---

## Edge cases

- **Cannot exit un-aligned:** `stopAlignDrawing` blocks leaving a brand-new drawing until `distanceH>0` or `drawingScale>1`, returning `text_incorrect_length` (`60759`).
- **Degenerate ruler math:** `mouseMove` guards `NaN` for `L`, `a`, `sign` (defaults 1) when the drag point coincides with the pivot (`67862`).
- **`distanceH == 0`:** `scaleDrawing` no-ops — an empty length never rescales (`68222`).
- **Load-in re-scaling risk:** `setDrawingData` sets `drawingScale` from stored data, then `setRulersData` calls `scaleDrawing()` again, which multiplies `drawingScale` by `distanceH/rulerLength`. This is intentional (stored `scale` is the pre-ruler baseline) but is fragile if the stored `scale` already included the ruler correction — a double-apply footgun.
- **`stop()` always scales:** leaving the state (even via cancel) runs `scaleDrawing()`; re-entering align on an already-scaled drawing skips the spotlight (`blackRectOpacity=0`) but will re-apply scale on the next stop if a non-zero `distanceH` persists.
- **PDF accepted** as input MIME (`application/pdf`, `62140`) alongside png/gif/jpeg; relies on the loader to rasterize.
- **Local files inlined:** `FILE.loadFileAsImage` = `readAsDataURL` (`7884`), so `imgDrawing.src` is a base64 data-URL → the saved project embeds the full image, which can bloat project size for large scans.
- **Ctrl bypasses angle snap** during handle drag for arbitrary orientation (`67871`).
- **Panning locked during drag** (wheel/right disabled) — user cannot pan while adjusting a handle (`67843`).

---

## Confidence & gaps

**High confidence:** upload flow and immediate transition into `stateAlignDrawing` (`62115`); the two-handle known-length ruler interaction and thresholds (`67692`–`68012`); the scale/rotate math in `scaleDrawing` (`68220`); underlay transform + layer/opacity rendering in `drawBG` (`63499`); persistence shape of `getDrawingData/setDrawingData` (`55276`); constants (`SNAP_DIST=10`, DRAWING_* enums); confirmed **no image analysis / wall auto-detection** (no OpenCV/edge/contour-from-image path; the only contour usage is the manual area-trace aligner).

**Medium confidence:** exact length-entry dialog wiring — the `alignerSizeListener` body I read is commented out (`58490`), so the live UI likely drives `setAlignerValue` through the same `getPlanAlignLength/setPlanAlignLength` API (`740`) but the current dialog widget wasn't pinned down. The double-`scaleDrawing` on load is inferred from call order, not observed at runtime.

**Gaps / not traced:** (1) whether `drawingPosition` opacity (0.3/0.5) is ever user-adjustable elsewhere — appears hard-coded. (2) The full `R2D.ImagesLoader`/`ImageUrlLoader` internals (assumed standard async image load). (3) Whether large-PDF rasterization has size caps. (4) `distanceV`/vertical-ruler code is present but dead in this build — no evidence it is reachable. (5) Interaction between `rotateDrawing` flag source (which UI toggle passes `rotate` into `stopAlignDrawing`) not located.
