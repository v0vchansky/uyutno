# Deep-dive 01 — Triangulation Core

> Source: `plannercore.js` (~81k lines, un-minified). All line numbers below refer to that file.
> Companion libs (`imported_triangulate`, `imported_clean_graph`) are **not** in the recovered source tree — only their call sites are present — so they are loaded as external globals from a separate bundle. That absence, plus the `imported_` prefix (webpack default-interop naming) and the exact API shape, is itself the primary evidence for "vendored library, not custom".

---

## Verdict: standard-or-custom

**The raw triangulator is a STANDARD off-the-shelf library — `cdt2d` (mikolalysenko's 2D constrained Delaunay), with its companion `clean-pslg` as the pre-cleaner.** It is _not_ custom.

The ~5 years of hard-won experience is **not** in the triangulator itself — it lives entirely in the **hand-rolled wrapper pipeline** around it (`TR.triangulateContours`, `TR.resplitSegments`, `TR.roundCoord`, the dedup in `addSeg`, and the post-triangulation flood-fill classification in `TR.groupTriangles` + `TR.triangulateContours`). That wrapper is load-bearing.

Evidence for the cdt2d identification:

- Call at line **50635**: `imported_triangulate(points, edges, {exterior: true})`. Signature is `(points, edges, options)` where `points` are `[x,y]` pairs and `edges` are `[i,j]` index pairs (built as such in `TR.triangulateContours`, lines 50954–50964). Returns triangles as index triples (consumed at 50649: `[triangleIndices[i][0..2]]`). This matches cdt2d's documented API exactly, including the `exterior` option flag — a cdt2d-specific name (cdt2d: `{exterior}` removes exterior faces; `{exterior:true}` keeps them so interior/hole classification can be done downstream).
- Call at line **50983**: `imported_clean_graph(ptCoords, edges)` mutates `points`/`edges` **in place** immediately before triangulation. That is the signature and contract of **`clean-pslg`**, the library the cdt2d docs explicitly recommend running first ("preprocess it first using clean-pslg … the resulting graph meets all invariants required by cdt2d"). The pairing cdt2d + clean-pslg is a canonical mikolalysenko stack.
- `{exterior: true}` appears exactly once in the whole file (only the triangulation call); the other `exterior` hits (14594, 46203, 46798) are unrelated render/material flags.

No patches to the stock libs are visible from the planner side (we only see the call boundary). Any modifications, if present, would be inside the vendor bundle.

> **Verified:** the vendor bundle is `tris.js` — a **browserify bundle of the npm packages `cdt2d` + `clean-pslg`**, exposed via `window.imported_*` wrappers (tris.js:1912–1922). `poly2tri` / `SweepContext` occurrences in the codebase = **0**, confirming poly2tri is _not_ used.

Sources for API confirmation: [cdt2d](https://github.com/mikolalysenko/cdt2d), [clean-pslg (npm)](https://www.npmjs.com/package/clean-pslg).

---

## The raw triangulator

Thin wrapper `TR.triangulate` (line **50632**):

```js
TR.triangulate = function (points, edges) {
  TR.points = points;
  var trs = imported_triangulate(points, edges, { exterior: true }); // cdt2d
  TR.createStructure(trs, edges); // build half-edge-ish adjacency
  TR.groupedTriObjects = TR.groupTriangles(TR.triObjects, true);
};
```

- cdt2d internally is a **sweep + monotone triangulation + Delaunay edge-flip** (per-face flipping to restore the Delaunay condition) with constraint insertion — i.e. a proper constrained Delaunay, not ear-clipping (earcut) and not an unconstrained Delaunay (Delaunator). The `{exterior:true}` here means "return all faces including outside-the-boundary ones"; the planner does its own inside/outside labeling afterward (see pipeline).
- `TR.createStructure` (line **50640**) turns the flat triangle-index list into an adjacency structure: each triangle gets 3 edge objects keyed by sorted point-index pair (`dictEdge`, line 50657), edges accumulate their incident triangles (`eds[j].triangles.push(tr)`), and each edge is flagged `fixed` if it coincides with an input constraint edge (50675–50689). `fixed` = "this is a real wall/contour boundary", which drives grouping.

---

## Pre & post pipeline (where the 5-year experience lives)

Entry point is `TR.triangulateContours(inpOuterContours, inpInnerContours, inpBoundContours, inpSubtrContours, cutPairs)` (line **50926**). Order of operations:

1. **Grid rounding — `TR.roundCoord`** (line **50554**): snaps to a 0.001-cm grid: `Math.round(P.x * 1000) / 1000`. Note: it is _not_ called inside `triangulateContours` itself — it is applied upstream at the many geometry-mutation sites (53448, 53510, 53871, 59556; also 53516, 57698, 59563 — note 60466 is a `TR.triangulateContours` call for cover triangulation, not a `roundCoord` site). By the time contours reach the triangulator, coordinates are already grid-quantized, which kills most near-coincident-point noise before it ever reaches cdt2d.

2. **Segment build + duplicate-point / duplicate-edge dedup — `addSeg`** (lines **50932–50965**, closure inside `triangulateContours`): for every contour edge it linearly scans existing `ptCoords` and reuses a point index if within `L_EPS` (1e-8) on both axes (50939–50940); skips zero-length segments (`A.match(B)`, 50934); and skips an edge if the same pair already exists in either direction (50945–50950). This is an O(V·E) dedup but guarantees a shared-vertex, no-duplicate-edge graph.

3. **Constraint splitting at overlaps — `TR.resplitSegments`** (line **50272**): splits _collinear overlapping axis-aligned_ constraint edges so they share intermediate vertices instead of crossing/overlapping. It groups edges that are vertical (`|A.x−B.x| < L_EPS`) or horizontal (`|A.y−B.y| < L_EPS`) and colinear, sorts the group's endpoints along the axis (`rebuildGroup`, 50348), marks covered spans (`links[k]=1`), and re-emits one edge per covered gap between consecutive sorted points (50372–50376). Diagonal edges (`otherEdges`) pass through untouched. This is the planner's own fix for T-junctions and overlapping walls on the axis-aligned case; it does **not** handle general (diagonal) self-intersections — those are left to `clean-pslg`.

4. **`imported_clean_graph` = clean-pslg** (line **50983**): the general PSLG sanitizer. Per the library, it dedupes coincident points, splits _all_ edges at their mutual intersection points (the general/diagonal case `resplitSegments` skips), removes degenerate/zero-length edges, and returns a graph satisfying cdt2d's invariants. It mutates `ptCoords`/`edges` in place. This is the real self-intersection / holes-in-holes safety net.

5. **Triangulate** (`TR.clear()` then `TR.triangulate`, 50985–50986).

6. **Post: sliver-safe centroid classification** (50993–51089). For each connected triangle group it deliberately **skips narrow/sliver triangles when picking a representative** (`TR.triangleIsNarrow`, guard at 51001) so the inside/outside test isn't run on a degenerate centroid; if a group is all-slivers it is dropped (multi-line block 51010–51014: `if (!trForCenter)` @51010, `continue` @51013). The chosen triangle's centroid (`TR.triangleCenter`, 49734) is tested with a ray-cast point-in-contour (`TR.pointInContours` → `TR.pointInContour`, 49616/49629) against outer/inner/bound/subtract contour sets to decide fill vs hole vs empty (the boolean-op logic at 51024–51076 implements bound∩ / subtract set operations). This centroid-labeling is how the `{exterior:true}` faces get correctly assigned — it is the planner's substitute for trusting cdt2d's own exterior removal, because it needs multi-set boolean semantics cdt2d can't express.

7. **Grouping — `TR.groupTriangles`** (line **50692**): recursive flood-fill (`checkTriangle`, 50709) across shared edges, stopping at `fixed` edges when `separateByFixedEdges` is set (50719). This is what turns the triangle soup back into per-room / per-region polygons (later stitched by `TR.contoursFromGroup`, 50738, via a left-most-point + max-turn-angle boundary walk).

`TR.rebuildContours` (line **51094**) is the outer wrapper: optional `TR.filterContours` pre-filter (50913) to drop tiny/degenerate contours, then `triangulateContours`, then group→contour reconstruction, returning `[outerContours, innerContours, outerGroups]`.

---

## Edge cases & epsilons

Two global epsilons (lines **49482–49483**):

- `TR.L_EPS = 1e-8` — "loose"/coordinate-equality epsilon. Used for point-index dedup (50939), colinearity/axis tests in `resplitSegments` (50291, 50305), edge-equality, bbox separation (49802–49805), determinant-degeneracy in line intersection (`|denom| < L_EPS` → parallel, 49898), and the **default accuracy of `Point.match`** (49554). Applied in **topology/identity** decisions.
- `TR.B_EPS = 1e-4` — "big"/spatial-tolerance epsilon (0.0001 cm). Default for `pointOnLine` (49579) / `pointOnContour` (49605), i.e. **geometric on-boundary** decisions. (`Point.match` defaults to `L_EPS`, not `B_EPS` — which strengthens the "L_EPS = identity" split.)
- Also a hard-coded `EPS = 1e-6` inside `pointInContour` (49633) for the ray-cast vertex-on-ray test, and `minLen = 0.1` in `triangleIsNarrow` (49746) and `minLen = 5` in `clearContour` (50402).

Edge cases explicitly handled:

- **Duplicate / near-coincident points**: `roundCoord` (0.001 grid) upstream + `L_EPS` index-reuse in `addSeg` + clean-pslg dedup. Triple defense.
- **Duplicate / reversed constraint edges**: `addSeg` skip check (50945–50950).
- **Zero-length segments**: `A.match(B)` early-return (50934).
- **Collinear overlapping constraints / T-junctions (axis-aligned)**: `resplitSegments`.
- **General self-intersecting constraint edges + diagonal crossings**: delegated to `clean-pslg`.
- **Holes-in-holes / nested contours & boolean bound/subtract**: centroid point-in-contour counting with `inside > outside` and bound/subtract set logic (51021–51076).
- **Zero-area / sliver triangles**: not fed to the classifier (`triangleIsNarrow` guard, 51001); all-sliver groups dropped (51010–51014). `contourValid` (50525) rejects contours below `MIN_CONTOUR_AREA=50` or with bad area/perimeter ratio (`MIN_SP_RATIO=1`).
- **Contour reconstruction dead-ends / spurs**: `clearDict` prunes degree-1 nodes and dangling refs before walking each contour (50792–50830).

Note the planner does **not** rely on cdt2d's own robustness for exterior removal or hole handling — it re-derives all of that from centroids, which is a deliberate belt-and-suspenders choice.

---

## Complexity & failure modes

- **cdt2d itself**: ~O(n log n) expected (sweep + incremental flips) — good.
- **The wrapper is the bottleneck**: `addSeg` does a linear scan of `ptCoords` per endpoint and a linear scan of `edges` per segment → **O(V·E) ≈ O(n²)** graph assembly. `resplitSegments` groups via nested `indexOf` scans (also quadratic in group size). For typical apartment plans (hundreds–low-thousands of points) this is fine; it degrades on pathological large inputs.
- **Point-in-contour classification** is O(triangles × total contour vertices) — another quadratic-ish term on big plans.
- **Recursion / stack-overflow risk**: `TR.groupTriangles.checkTriangle` (50709) and `TR.indicesToPoints` (51189) are **recursive**. `checkTriangle` recurses once per triangle in a connected component with no explicit depth guard — a very large single connected region (tens of thousands of triangles) could blow the JS call stack. There is a commented-out `throw new Error('Contour error')` (50854) replaced by a soft `return null` guard (50856) capping contour-walk length, but the flood-fill recursion has no such cap. This is the most likely real-world failure mode on huge plans.
- Other guards: parallel-line early-outs (`|denom| < L_EPS`), bbox `checkMinMaxOutside` short-circuit (49767) before expensive contour comparisons, `contour.length < 3` bail-outs throughout.

---

## What we'd reuse vs replicate (for our fresh TS rebuild)

- **Reuse (drop-in):** stock **cdt2d** + **clean-pslg** off npm. The triangulator boundary is clean and the API is unchanged from stock, so we can call `cdt2d(points, edges, {exterior:true})` and `cleanPSLG(points, edges)` directly and get the _same core behavior_. No need to reimplement Delaunay.
- **Replicate (load-bearing wrapper):** the surrounding pipeline is where their 5 years live and it is **not** optional:
  1. `roundCoord` 0.001-grid quantization applied at all geometry-mutation sites (not just before triangulation).
  2. `resplitSegments` axis-aligned overlap/T-junction splitting **in addition to** clean-pslg (they run both; clean-pslg alone would not reproduce their exact vertex-sharing on colinear walls).
  3. The **centroid-based fill/hole/bound/subtract classification** — this is their boolean-geometry semantics and cannot be replaced by cdt2d's `exterior` flag alone.
  4. Sliver rejection at classification time (`triangleIsNarrow`) — cheap, high-value robustness.
  5. `groupTriangles` flood-fill + `contoursFromGroup` boundary walk to get polygons back out.
- **Improve while replicating (don't copy the bugs):** replace the O(V·E) `addSeg` dedup with a hash grid / spatial index keyed on the rounded coord (the grid rounding already makes exact-key hashing safe); make `groupTriangles` **iterative** (explicit stack) to remove the stack-overflow risk; keep the two-epsilon split (`L_EPS` for identity, `B_EPS` for on-boundary) — it's a sound distinction worth preserving verbatim.

Net: **stock cdt2d + a faithful re-implementation of their wrapper's four/five steps** reproduces the behavior. Dropping in cdt2d with only a "thin" wrapper (just `exterior` handling) would **not** — the classification, resplit, and grid-rounding steps are behaviorally essential.

---

## Confidence & gaps

- **High confidence** that the raw triangulator is stock **cdt2d + clean-pslg**: exact API/option-flag match (`{exterior:true}`, `(points, edges)` in-place clean), the `imported_` external-global prefix, the single unique call site, and the canonical cdt2d↔clean-pslg pairing all agree.
- **Gap:** the bodies of `imported_triangulate` / `imported_clean_graph` live in the separate `tris.js` browserify bundle (wrappers at tris.js:1912–1922), not inline in `plannercore.js` (only call sites at 50635 and 50983 there). The bundle is now identified as `cdt2d` + `clean-pslg`, but I have not audited its bundled bodies line-by-line, so I cannot verify from source whether the vendored copies were _patched_ vs stock, nor read cdt2d's internal epsilons/flip logic directly — the "cdt2d = sweep+flip, clean-pslg = split-at-intersections/dedupe" characterization is from the libraries' public docs. `poly2tri`/`SweepContext` = 0 occurrences across the codebase.
- **High confidence** on everything in the wrapper (pipeline order, epsilons, recursion, complexity) — all read directly from the source lines cited.

**Missing for implementation** (this doc is sufficient for the "cdt2d vs something else" decision; for actually wiring it into Three.js r185 + TS, still to pin down):

1. **Package versions** are not fixed (likely `cdt2d@1.0.0`; both packages frozen since ~2016).
2. **Maintainability**: cdt2d/clean-pslg are ~10 years unmaintained, CommonJS, no types (a ~5-line `.d.ts` of our own is needed). An alternative of the same class — `constrainautor` on top of Delaunator (more active, faster) — is not compared here.
3. **Units**: all thresholds (0.1, 5, 50, the 0.001 grid) are in the competitor's centimeters; rescale if our base unit differs.
4. **Input contract**: contour orientation (CW/CCW) and who calls `rebuildContours` vs `triangulateContours` directly (covers at 60466 call `triangulateContours` with no bound/subtract).
5. **Bridge into Three.js**: assembling `BufferGeometry` from the index triples + groups — trivial, but should be written down.

Recommendation: take `cdt2d` + `clean-pslg` from npm, implement the wrapper ourselves following this doc's steps; fix versions/units (items 1–3) before starting.
