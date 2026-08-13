# Deep-dive 02 — Wall corner mitering / band offsetting

Reverse-engineered from the competitor's un-minified `plannercore.js`. All line
numbers cite that file. Snippets are illustrative only.

The pipeline has **two distinct code paths** that are easy to conflate:

- **Draw-time band offsetting** (`WC.DrawTool.blocksFromContour`, line 57922) —
  turns the user's drawn centerline polyline into a strip of quad "blocks",
  one per segment, with mitered joins. This is the offset engine.
- **Rebuild-time wall pairing** (`findAxes` → `WC.boxFromWalls` → `parallelBox`,
  lines 55362 / 54822 / 54833, plus `WC.createConnectors`, line 54382) — runs
  on the _already-built_ room polygons to recover wall "axes" (centerlines) and
  to fill the small gaps left at junctions. This is **not** a second offsetter;
  it is a face-pairing + gap-cap step.

---

## Verdict: standard-or-custom

**Fully custom, hand-rolled per-segment offset + line-intersection miter.** No
Clipper/ClipperLib, no straight-skeleton, no Minkowski sum, no polygon-offset
library anywhere in the path. Evidence:

- The offset primitive is `TR.perpendicularPoint(A, B, d)` (line 50196): given
  segment `A→B` it returns `A` displaced by signed distance `d` along the
  segment's left normal (computed from the slope `k = -(Bx-Ax)/(By-Ay)`, with
  explicit `B.y == A.y` vertical-line special-casing and a sign flip based on
  vertex order, lines 50200–50222). This is textbook per-segment normal offset,
  not a library call.
- Corners are formed by intersecting the two offset lines with
  `TR.lineIntersectLine` (line 49874), a plain two-line determinant solve
  (`denom = a1*b2 - a2*b1`, degenerate if `|denom| < L_EPS`, line 49898).
- Each output "block" is a 4-point quad `[A, C, D, B]` (outer-offset corner,
  next outer corner, next centerline point, centerline point), pushed per
  segment — see the loop body at 58051–58066. There is no global polygon
  boolean; walls are emitted as independent quads and only later unioned into
  room contours by unrelated code.

**Join strategy: miter, with an automatic bevel/square fallback.** The default
join is a true miter (intersect the two offset lines). When the miter would
overshoot — sharp angle _and_ the miter apex falls outside the segment bounds —
they drop back to the un-mitered offset endpoints (`C = L01; D = R01`), which is
effectively a **bevel/butt cap** at that vertex. No round joins exist.

---

## Offset & corner math (the crown jewel)

`blocksFromContour(inputCont, wallsWidth, startNeighbSegments)` at line 57922.
Note the offset distance is negated on entry: `var d = -wallsWidth` (line
57930); `wallsWidth` arrives already signed by the caller as
`signSide * me.wallsWidth` (line 65921), so the band is emitted to one chosen
side of the centerline. Key constant: `var recalcAng = Math.PI * 0.75` (line 57924) — **confirms the ~0.75π re-miter threshold**.

Per interior vertex `P1` with neighbors `P0`, `P2` (loop at 58023–58067):

1. Offset the incoming segment `P0→P1` to lines `L0..L01` and the outgoing
   `P1→P2` to `L12..L2`, all via `perpendicularPoint(.., d)` /
   `perpendicularPoint(.., -d)` (lines 58029–58036). Note both endpoints of a
   segment are offset independently (`d` at the tail, `-d` at the head) because
   `perpendicularPoint`'s normal sign depends on vertex order — this keeps the
   offset consistently on one side.
2. **Outer miter corner** `C = lineIntersectLine(L0, L01, L12, L2, false)`
   (line 58039) — intersect the two offset lines as _infinite_ lines
   (`as_seg = false`). **Inner corner** `D` is just the raw centerline
   intersection `lineIntersectLine(R0, R01, R12, R2, false)` where `R*` are the
   original centerline points — so `D` collapses to the shared vertex `P1`.
   Effectively **one side of the wall is the centerline itself and only the
   offset side is mitered** (single-sided band, see §3).
3. Null-guard: `if (! C) C = L01; if (! D) D = R01` (58041–58042) — parallel /
   degenerate intersection falls back to the plain offset endpoint (butt).
4. Emit quad `[A, C, D, B]`; carry `A = C, B = D` into the next segment so
   consecutive blocks share the mitered edge (58060–58066).

**(a) Sharp / acute corners — the re-miter / miter-limit.** Line 58044–58057:

```
ang = angleBetweenLines(P0,P1, P1,P2);
if (ang > recalcAng && ang < 2π - recalcAng && ! pointInBounds(C, D, L2)) {
    C = L01; D = R01;                 // abandon the miter apex
    block.push(A, C, D, B); res.push(block);
    A = L12; B = R12;                 // restart the strip at the raw offset
}
```

So the miter is only abandoned when **both**: the turn is sharper than
`0.75π` (135°) away from straight, **and** the computed apex `C` fails
`pointInBounds(C, D, L2)` (line 50167 — an inclusive AABB test with `L_EPS`
slack) i.e. the miter spike shoots past the next offset point. In that case they
close off the current block at the un-mitered offset points and begin a fresh
block — a bevel that also prevents the runaway spike. This is their miter-limit
equivalent. The closed-contour branch (58106) applies the same `recalcAng`
gate but **without** the `pointInBounds` guard, so closed rooms re-miter purely
on angle.

**(d) Very short segments.** Two guards up front (57926–57927): a 1-point
contour yields `[]`; a 2-point contour shorter than `wallsWidth` yields `[]`
(too short to thicken). For open polylines, if the _last_ segment is shorter
than `wallsWidth` the trailing point is dropped (`contour = inputCont.slice(0,-1)`,
line 57982) to avoid a degenerate end quad.

**Endpoints (caps).** Open-polyline start/end use raw offset endpoints:
`A = perpendicularPoint(contour[0], contour[1], d)` (58019) and
`C = perpendicularPoint(last, prev, -d)` (58069) — flat butt caps, unless a
`startNeighbSegments` snap overrides the start (see §T-junction).

---

## Special corners (sharp / parallel / T-junction)

**(b) Near-parallel neighbors — `parallelBox` / `boxFromWalls`.** This is the
_rebuild_ path, not the draw path. `parallelBox(A, B, C, D, maxAngle)` (line 54833) defaults `maxAngle = 0.05` rad (line 54835) — **confirms the ~0.05 rad
near-parallel tolerance**. It bails immediately unless
`TR.parallelLines(A,B,C,D, 0.05)` holds (line 54837; `parallelLines` at 50252
uses the same 0.05 default). It then projects the two endpoints of wall 2 onto
wall 1 (`projectionPointOnLine`, 54839–54842) and, via a four-case analysis on
whether the projections land inside the segment (`insC`/`insD`, 54851–54901),
builds the overlapping rectangle `[E, F, G, H]` — the shared "box" of two nearly
parallel, facing walls. Rejects if the overlap collapses
(`manhDist(E,F) < L_EPS`, 54903) or if there is no genuine overlap. `boxFromWalls`
(54822) wraps it with two gates: `parallelLines` and `WC.rightOriented`
(54922) — the latter is a `faceRight` XOR parity check (54933–54939) ensuring
the two walls actually face each other before a box is created. These boxes feed
`findAxes` (55362) to recover a centerline segment (`boxCenterSeg`, 54911, which
also enforces `MAX_WALL_WIDTH = 80` and `MIN_WALL_LENGTH = 15`, lines 54379–54380
/ 54913–54914).

**(c) T-junctions / 3+ walls at a point — `startNeighbSegments`.** The draw
path handles a new run that _starts on an existing wall_ via `startNeighbSegments`
(the two neighbor points of the snapped edge, from `findNearSegments`, line
57227). At the start segment it intersects the new offset line against **both**
neighbor rays (`X0`, `X1`, lines 57946–57949 / 57998–58001), keeps only
intersections that actually lie on the neighbor (`pointOnLine`), and picks the
one **farther** from `P1s` (`if (d0 > d1) X = X1`, 57955) — i.e. the miter that
reaches deeper into the existing wall so the new stub tucks cleanly into the
T. If neither hits, it uses the plain butt endpoint (57972). There is **no**
general N-way junction solver: three-plus walls meeting a point are resolved
pairwise (each wall mitered against its immediate predecessor/successor only),
and any residual gap at the shared vertex is filled by connectors (§next).

---

## Connectors & caps

`WC.createConnectors(axes, walls, cuts)` at line 54382, with
`var maxConnectorLength = 40` (line 54384) — **confirmed**. This is the
gap-filling / cap-fill step that closes the small triangular/quad voids left
where mitered wall quads don't fully meet (typically at T-junctions and
thickness mismatches).

For each recovered `axis` (a pair of facing walls, `wall1`/`wall2`), it
canonically orders the two walls' endpoints so `P11↔P21` and `P12↔P22` pair up
by proximity (swap test at 54398–54403), then considers the two cross-pairs
`[P11,P21]` and `[P12,P22]` as candidate connector edges (54405–54408). A
candidate is **skipped** if:

- its length exceeds `maxConnectorLength = 40` (line 54408) — the load-bearing
  cap on how big a gap may be bridged;
- it coincides with an existing wall (both endpoints match a wall's endpoints,
  54413–54414);
- another wall's endpoint lies _on_ the connector line but isn't one of its
  endpoints (54420–54432) — i.e. the connector would cross a real wall;
- the connector properly intersects a wall interior (`lineIntersectLine`, 54434) or duplicates a cut of equal height (54443–54454).

Survivors become `WC.DataPlug` quads extruded to `axis.wall1.height`
(`createPlug3D`, 54495) — literal little filler prisms plugging the corner void.
So the "cap fill" is a **whitelist of short, non-crossing bridges** between
paired wall faces, not a geometric union.

---

## Edge cases & thresholds

Numeric thresholds and where they bite:

| Value              | Symbol / line                                             | Role                                                                                                                            |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `1e-8`             | `TR.L_EPS` (49482)                                        | denominator / coincidence epsilon in `lineIntersectLine` (49898), `parallelBox` collapse (54903), `pointInBounds` slack (50169) |
| `1e-4`             | `TR.B_EPS` (49483)                                        | on-line tolerance in `pointOnLine`/`projectionPointOnLine` (49579, 50141), snap-neighbor matching (57242)                       |
| `0.75π` (135°)     | `recalcAng` (57924)                                       | re-miter / bevel threshold at sharp corners (58046, 58106)                                                                      |
| `0.05` rad (~2.9°) | `parallelBox` / `parallelLines` `maxAngle` (54835, 50254) | near-parallel merge tolerance for wall pairing                                                                                  |
| `40`               | `maxConnectorLength` (54384)                              | max bridgeable junction gap                                                                                                     |
| `80`               | `MAX_WALL_WIDTH` (54379)                                  | max face separation for a box/axis (54913)                                                                                      |
| `15`               | `MIN_WALL_LENGTH` (54380)                                 | min axis length (54914)                                                                                                         |
| `wallsWidth`       | arg                                                       | too-short-segment rejection (57927) and trailing-point drop (57980)                                                             |

Degeneracy handling actually present:

- **Zero-length / coincident points:** `perpendicularPoint` guards the vertical
  case (`B.y == A.y`) with `k = MAX_VALUE` (50200); `lineIntersectLine` returns
  `null` on `|denom| < L_EPS` and callers fall back to the plain offset point.
  A fully coincident `P0 == P1` produces `NaN` from `perpendicularPoint` (no
  explicit guard) — relied upon not to occur because upstream snapping merges
  points within `L_EPS`/`B_EPS`.
- **Self-overlap on concave corners:** the mitered inner side is the raw
  centerline (`D = P1`), so the inner boundary never self-overlaps; the outer
  spike is what's clamped by the `recalcAng` + `pointInBounds` test. There is
  **no global self-intersection cleanup** of the emitted band — concave spikes
  are handled only locally per vertex.
- **Extremely sharp spikes:** clamped to a bevel by the re-miter branch;
  worst case the block is split and restarted, so a spike can't propagate.
- **Closed vs open contour:** detected by `inputCont[0].match(last)` (57977);
  closed contours append `contour[1], contour[2]` (58081) so the wrap-around
  vertex is mitered like any interior vertex.

---

## What we'd reuse vs replicate

For our fresh TS build:

- **A stock polygon-offset library will NOT reproduce this behavior out of the
  box**, because their band is **single-sided** (one edge is the centerline
  itself, `d = -wallsWidth` to one side via `signSide`), whereas
  Clipper2/`polygon-offset` produce a symmetric two-sided inflation of a
  polygon. Their walls are also emitted as **independent per-segment quads**,
  not a unioned polygon — downstream code (rooms, axes, connectors, 3D) assumes
  that quad-strip structure.
- **Load-bearing bespoke logic we'd have to replicate to match pixels:**
  (1) the `0.75π` + `pointInBounds` re-miter/bevel rule — a stock miter-limit is
  a _ratio_, not an angle+bounds test, so joins would differ at ~135°;
  (2) the `startNeighbSegments` T-junction tuck-in (pick the farther
  intersection); (3) the connector/plug gap-fill with `maxConnectorLength = 40`
  and its crossing-rejection whitelist; (4) `parallelBox`'s four-case overlap
  with `0.05` rad tolerance for recovering axes from built rooms.
- **Safe to reuse from a library / rewrite cleanly:** the low-level primitives
  (`perpendicularPoint` normal offset, two-line intersection, projection) are
  generic — a well-tested TS geometry lib covers these. The _policy_ layers
  above them are the competitor's 5-year robustness sediment and must be ported
  deliberately if we want matching output.
- Recommended: build our own single-sided offset on Clipper2 primitives (or
  plain vector math) but **port the three decision rules** (re-miter angle,
  T-junction pick, connector gap cap) as explicit, tested special-cases. Do not
  expect a drop-in offsetter to match them.

---

## Confidence & gaps

**High confidence** on: custom (non-library) hand-rolled miter offset; the
`0.75π` re-miter threshold, `0.05` rad parallel tolerance, `maxConnectorLength=40`,
`MAX_WALL_WIDTH=80`, `MIN_WALL_LENGTH=15` — all read directly at cited lines; the
single-sided band construction; miter-with-bevel-fallback join strategy;
per-segment-quad output structure; connector whitelist logic.

**Gaps / lower confidence:** (1) I did not fully trace how per-segment quads are
subsequently unioned into the final room contour polygons and how variable
per-wall thickness (if the product exposes it) feeds `wallsWidth` — I saw only a
single global `me.wallsWidth` (65864) plus a per-run `signSide`, no per-wall
width in the offset path, so "variable thickness" appears to be **not
supported** in this engine, but I can't rule out width being applied elsewhere.
(2) The exact interaction between `faceRight`/`outer` parity (54140) and
`rightOriented` (54922) I described at the level of the parity table, not by
exhaustively enumerating orientation cases. (3) `createPlug3D` 3D extrusion
details and how connectors visually blend with wall meshes were only skimmed.
