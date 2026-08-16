# Deep-dive 04 — 3D Mesh + UV Generation

**Black box:** How 2D triangulated contours-with-holes become 3D wall / floor / plinth
meshes (vertices, normals, texture UVs) in the competitor's un-minified `plannercore.js`.

**Source:** `plannercore.js` (~81k lines). All line numbers below cite that file.

**Central question:** standard extrude/UV (THREE.ExtrudeGeometry) or hand-built? What
hard-won detail is baked in? This resolves the prior extraction's open flag on the 3D
vertex-generation internals.

---

## Verdict: standard or custom?

**Fully custom.** There is no `THREE.ExtrudeGeometry`, no `THREE.Shape`, no shape/hole
extrusion path anywhere in the mesh build. The 2D→3D lift is entirely hand-rolled:

1. A 2D constrained triangulator (`TR.triangulateContours`, line 50926) turns each
   `outerContour` + `holes`/`innerContours` into a flat index list.
2. Per-triangle functions (`WC.findTriWall` 52463, `WC.findTriCover` 52564,
   `WC.findTriWallTile` 52677, `WC.findPlinthSegment` 52318, `WC.createFrame3D` 54606)
   map each 2D triangle to **3 explicit 3D vertices + 3 explicit UVs**, pushed into flat
   arrays on a `WC.Part` (52441).
3. `R2D.Tool.makeBufferGeometry` (28984) wraps those flat arrays into a raw
   `THREE.BufferGeometry` (`position`/`uv`/index attributes), then calls
   `computeVertexNormals()` (28999). No `mergeVertices`, no indexed sharing — indices are
   the trivial identity `[0,1,2,3,…]` (`WC.generateIndices`, 52311).

So: **hand-built BufferGeometry from triangulation output**, not a THREE extrude. Every
vertex position and every UV is computed in JS by these ~6 functions. That is where their
~5 years of experience is concentrated.

### The `[A,B,C,D]` wall rectangle → triangles → 3D

`DataWall.build3D` (53070) builds the wall face in a **local 2D wall frame** where
`x` = distance along the wall (0..`wallLength`), `y` = height (0..`me.height`):

```js
let A = new TR.Point(0, 0); // 53111
let B = new TR.Point(wallLength, 0);
let C = new TR.Point(wallLength, me.height);
let D = new TR.Point(0, me.height);
```

Holes (doors/windows) are collected 2D (`getHoles`) and fed as inner contours:

```js
trs = TR.triangulateContours([[A, B, C, D]], partContours.concat(holes), [], [], []); // 53185
trs = trianglesFromIndices(trs); // 53052 — reads TR.points[] back into {x,y}
```

Each resulting 2D triangle `(a,b,c)` is lifted by `findTriWall`. The 3D position uses the
wall's world endpoints `v1`/`v2` (`me.v1 = (point1.x, 0, -point1.y)`, `v3/v4` at
`y=height`, lines 53093–53096 — note the **`z = -y` plan→world mapping**) and an azimuth:

```js
var angle = Math.PI / 2 - WC.azimuth(v1.x, v1.z, v2.x, v2.z); // 52474
X = pivotPoint.x + a.x * Math.sin(angle); // 52542 — a.x = along-wall dist
Y = a.y; // a.y = height directly
Z = pivotPoint.z + a.x * Math.cos(angle);
```

So the local `x` (0..wallLength) is rotated into world XZ along the wall direction; local
`y` becomes world `Y` unchanged. **`y=0` base / `y=height` top** come straight from the
triangulated rectangle's `y`. Covers/ceilings (`findTriCover`, 52564) instead lay flat:
`X=a.x, Y=elevation, Z=-a.y` — the `z=-y` plan mapping again, `Y` is a constant elevation
(0 for floor, `me.height` for ceiling).

### The `±0.1 cm` z-fight offset

The per-material tile parts are drawn on a wall face **shifted 0.1 cm off the base wall
plane** so overlaid tiles don't z-fight with the remainder wall:

```js
let shiftVal = 0.1;
if (me.faceRight) shiftVal = -0.1; // 53098
let shiftedP1 = TR.perpendicularPoint(me.point1, me.point2, shiftVal); // 53100
```

Tiles use `shiftedV1/shiftedV2` as their pivot (`findTriWallTile`, 53161); the plain wall
and the `-1` remainder part use the unshifted `me.v1/me.v2`. Offset direction flips with
`faceRight` so the tiles always sit on the room-facing side.

---

## 2D→3D vertex assembly (per triangle)

Common preamble in every `findTri*` (52478–52492): compute triangle centroid, assign each
vertex an azimuth `az` from the centroid (`WC.azimuth`), then `_currPoints.sort(sortByAngle)`
(54809) to force a **consistent CCW ordering**, and `if (reverse) reverse()`. This fixes
winding _before_ positions/UVs are emitted — that is how they control which face is front
without relying on the triangulator's output order.

- **Wall:** `findTriWall` — position from along-wall distance + azimuth rotation (above).
- **Cover/ceiling:** `findTriCover` — flat plane at `elevation`, `Z=-a.y`.
- **Tile:** `findTriWallTile` — same position math as wall, different UV (see below).
- **Plinth:** `findPlinthSegment` (52318) sweeps a 2D profile `shape=[[d,h],…]` along the
  wall, emitting two triangles per profile segment plus triangulated end-caps
  (52413 `TR.triangulateContours([cont1],…)` then `findTriWall` per cap tri).
- **Frame/reveal:** `createFrame3D` (54606) walks the opening contour and extrudes each
  edge inward by `depth`, emitting a 4-vertex quad (2 tris) per edge with `V1..V4` at
  `±depth/2` around the edge (54654–54671).

Everything ends up as flat `part.vertices` (xyz triplets) + `part.uvs` (uv pairs) +
identity `part.indices`. `part.addNullData` (52454) injects a degenerate
`[-1,-1,-1…]` triangle for empty parts so the mesh/material slot count stays stable.

---

## UV & tiling math

**Origin & scale.** `pixPerMeter = 100` everywhere. The planner works in centimetres; UVs
are produced in **metres** by dividing the cm coordinate by 100 (52530–52537), с
`wrapS/wrapT = RepeatWrapping` (29330) — т.е. **1 UV-единица = 1 метр**. Плотность тайлинга
дальше задаётся **`texture.repeat` материала**: `ObjectViewer3DMaterial` для **scalable**-
материала ставит `repeat = (scaleX, scaleY)` (L32199–32208 → `makeTextureMap` L29339), и
только для не-scalable — `(1,1)` (тогда масштаб уходит в `userData` и плотность даёт лишь
UV-геометрия). ⚠️ **Поправка к прежней версии этого файла:** `repeat.set(1,1)` на L73601 —
это НЕ материал конструктора, а клон-хелпер превью в `R2D.MaterialCreator.MaterialScene`
(`cloneMap` внутри `cloneMaterial`, L73595–73601), где превью тайлит геометрией
(`geometryTile.scale`, L73615–73620). Так что «у конструктора всегда repeat=(1,1)» неверно —
для scalable-материала repeat берёт (scaleX,scaleY).

**Wall UV** (`findTriWall`, 52496–52537):

```js
uA = wallWidth - a.x;
vA = -a.y; // non-reversed: mirror U so texture reads L→R
// or uA = a.x; vA = -a.y;             // reversed (faceRight)
```

then a **rotation-about-center** applying per-material shift `mx/my` and rotation `mr`:

```js
transformedA = TR.rotateXY(uA - shiftX - centerX, vA + shiftY + centerY, -rotation); // 52519
uA = transformedA[0] + centerX;
vA = transformedA[1] - centerY;
uA /= pixPerMeter; // 52530
```

`centerX/centerY = me.rotatingCenter` = wall-rect midpoint (53115). So material offset
(`materialX/Y`), rotation (`materialRotation`) are applied in cm **around the face centre**,
then divided to metres. Because U is a pure function of the along-wall distance and V of
height, **UVs are automatically continuous across the whole face and across holes** — the
hole triangles get the same `wallWidth - x` / `-y` mapping as their neighbours, so the
texture flows behind/around openings seamlessly. No per-triangle UV atlas juggling.

**Cover/ceiling UV** (`findTriCover`, 52593–52640): `uA=a.x, vA=a.y` (or `-a.x` when
reversed, with `kr=-1` mirroring), same rotate-about-center + `/100`. There is a commented-
out earlier version (52618–52628) left in — evidence they iterated on the center-of-rotation
handling.

**Tile UV** (`findTriWallTile`, 52699–52733): instead of along-wall distance, U/V are the
**perpendicular distances from the tile's own two edges** `uv00→uv01` (U) and `uv00→uv10`
(V), `/100`. Then rotate by `π - rotation` (or `rotation - π` if reversed) and mirror U on
`reverse ^ flip`. This gives each tile its own local UV frame so a tiled pattern (e.g.
brick/laminate) aligns to the tile grid, independent of the wall's global UV.

**Per-material "part" vs the `-1` remainder.** `DataWall` emits one `WC.Part` **per
material pattern segment** (`me.pattern`, 53129) — each triangulated from its own tile
contours with `holes` subtracted — plus one final part with `part.id = -1` (53181) that
covers **everything the material patterns didn't** (`partContours.concat(holes)` subtracted
from the full `[A,B,C,D]` rect, 53185). Each part → its own mesh → its own material →
its own picker id. This is how one wall can carry multiple materials with a fallback base.

**Frame UV** (`createFrame3D`, 54673 + `DataFrame.build3D`, 52013): U runs across the
reveal depth (`depth/pixPerMeter`), V accumulates along the opening perimeter
(`coordV/pixPerMeter`). `DataFrame.build3D` re-applies `mx/my/mr` rotate-about-center to a
saved `uvsDef` copy (52023–52047) so material transforms can be re-run without
recomputing geometry.

---

## Structural pieces (plinth / frame / connector)

**Plinth around openings** (`findPlinthSegment`, 52318; driven by `DataPlinth.build3D`,
51505). The plinth is split by **gaps** where openings meet the floor: if `me.gaps` is
non-empty, `build3D` emits a separate segment for `point1→gap[0][0]`, between consecutive
gaps, and `gap[last]→point2` (51552–51568), each a full `findPlinthSegment` sweep. UV `U`
is arc-length along the wall (projected via `TR.projectionPointOnLine`, 52357), `V` is
arc-length up the profile (`Vs = V + sqrt(Δd²+Δh²)/100`, 52369) — so the profile texture
wraps continuously over the moulding's curved cross-section. End-caps are triangulated
separately (52413) and lifted with `findTriWall`.

**Frames / reveals** (`createFrame3D`, 54606): `bottomHeight = 2` (54608) partitions the
opening perimeter into a **bottom frame** (edges within `bottomHeight` cm of the top of the
contour, i.e. the sill — window bottom, `P.y > maxY - bottomHeight`, 54681) and a **top
frame** (jambs + head). These become two independent `DataFrame` objects — `frameB`
(bottom, uses `materialBottom*`) and `frameT` (top, uses `materialFrame*`) — so a window's
sill can be a different material than its jambs. Each edge extrudes inward by `depth/2` on
both sides (54654–54671), giving the reveal thickness.

**Corner connectors:** wall endpoints share world coords (`v1=(point1.x,0,-point1.y)`), so
adjacent walls meet exactly; there is no dedicated corner-fill geometry in the mesh path —
corners are handled upstream in the 2D contour solve (`me.axes` / `finalContours`), and the
plug/box helper (`DataPlug`, class at 52053; the plug builder's `findTriWall` call-site is
54507–54508) stitches parallel walls with two `findTriWall` quads.

---

## Normals, winding, seams, material binding

**Normals:** never authored. `makeBufferGeometry` calls `geometry.computeVertexNormals()`
(28999) whenever no explicit `normal` array is passed — which is always for constructor
parts. Because indices are the identity list (no shared vertices), this yields **flat
per-face normals**, which is correct for planar walls/floors.

**Winding / which side faces the room:** controlled two ways — (1) the `sortByAngle` CCW
sort + `reverse` flag inside every `findTri*` (`me.faceRight` is passed as `reverse`,
53167/53202); (2) a final `R2D.Tool.flipGeometryByZ` (29079) applied to every part before
buffer creation (31129). `flipGeometryByZ` negates `z` on positions/normals **and swaps
index[1]↔index[2]** (29112–29116) to keep winding consistent after the mirror — this
converts the internal `z=-y` left-handed plan convention into three.js's right-handed world
while preserving front-face orientation toward the room.

**UV seams at corners:** each wall is its own mesh with its own UV origin at its `point1`,
so **UVs are intentionally discontinuous across wall corners** (a seam per corner). Within a
wall face they're continuous (U = along-wall distance). That is a deliberate trade — clean
tiling per wall, visible seam only exactly at corners.

**Material binding for the picker:** `updateGeometry` (31119) builds one `THREE.Mesh` per
part and stamps `mesh.num = part.id` (31134) — `id` is the pattern-segment id, or `-1` for
the remainder. `updateMaterial` (31093) then binds `parts[i].materialID` (+ optional
`addMaterialID`) to `meshes[i]` via `PoolMaterials.getMaterial`. `scope.getObject3d(num)`
(31171) resolves a picked `num` back to its mesh (num `-1`/undefined → `meshes[0]`). So the
part id is the single key linking triangulated geometry → material → hit-testing.

---

## What we'd reuse vs replicate (three.js r185 notes)

Their stack is **three.js ~r134-era** (uses `THREE.sRGBEncoding` / `THREE.LinearEncoding`
and `texture.encoding`, e.g. 5969, 36069 — all removed in modern three).

For our fresh TS build on **r185**:

- **Keep the architecture, not the code.** Hand-built `BufferGeometry` from a 2D
  triangulation is the right call — we'd do the same (`setAttribute('position'|'uv')` +
  `computeVertexNormals`). We do **not** want `ExtrudeGeometry` (no per-face UV control, no
  per-material split, no z-fight offset).
- **UV routine is ours.** Reimplement the "U = along-wall distance / 100, V = height / 100,
  then rotate-about-center for material offset" formula as a small pure function. Keep
  `1 UV unit = 1 metre` + `RepeatWrapping`. **Плотность тайла — через `texture.repeat`**:
  у конкурента для scalable-материала `repeat=(scaleX,scaleY)` (не `(1,1)`), у не-scalable
  `(1,1)`. Повторяем эту развилку (repeat = масштаб материала), а не хардкодим `(1,1)`.
- **r185 color space:** `texture.encoding`/`sRGBEncoding` are gone. Use
  `texture.colorSpace = THREE.SRGBColorSpace` on **albedo/map** textures and
  `THREE.NoColorSpace` (linear) on normal/roughness/metalness maps. This is the single most
  likely silent-breakage point if code is ported verbatim.
- **r185 merging:** their identity-index, unmerged, per-face-normal geometry is wasteful.
  If we merge parts, use `BufferGeometryUtils.mergeGeometries` (renamed from r134's
  `mergeBufferGeometries`) — but only _within_ a material, since each material still needs
  its own draw/mesh for the picker. Consider `toNonIndexed()`/groups instead of N meshes.
- **Winding:** we can set winding correctly at emit time and skip the `flipGeometryByZ`
  mirror hack entirely by building directly in three.js world handedness (`z = -planY`
  once, consistent triangle order), and let `computeVertexNormals` + `material.side` do the
  rest.
- **`±0.1 cm` tile offset:** worth replicating exactly (`polygonOffset` on the material is
  the modern alternative, but a geometric 1mm push is more portable across renderers).

---

## Confidence & gaps

**High confidence** on: custom (non-extrude) vertex assembly and the exact position math
(`findTriWall`/`findTriCover`/`findTriWallTile` read in full, 52463–52758); the UV formulas,
`pixPerMeter=100`, rotate-about-center, `mx/my/mr`, per-material vs `-1` remainder parts
(`DataWall.build3D` 53070–53214); plinth gaps + profile sweep (51505, 52318); frame
top/bottom split at `bottomHeight=2` (54606); normals via `computeVertexNormals`, winding
via `sortByAngle`+`flipGeometryByZ`, and `mesh.num=part.id` picker binding (28984, 29079,
31119). The prior extraction's flagged "3D vertex-generation internals not fully traced" is
now **resolved**.

**Gaps / lower confidence:** (1) `TR.triangulateContours` internals (50926) were read only
at the interface level — the constrained Delaunay/ear-clip algorithm itself wasn't deep-
traced; it's a black box we consume, not replicate. (2) Corner-connector geometry lives in
the upstream 2D axis/contour solve (`me.axes`, `finalContours`) rather than the mesh path,
so it's characterised but not line-traced here. (3) Exact three.js revision inferred from
API usage (`encoding`/`sRGBEncoding`), not a version string.
