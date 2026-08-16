# Deep-dive 03 — Contour tracing / planar-face extraction

How the competitor's `plannercore.js` engine turns a set of wall segments into rooms.
Central question: **standard planar-graph face traversal, or a custom flood-fill + boundary walk?**

Source: un-minified `plannercore.js` (~81k lines). All line numbers below refer to that file.
The whole subsystem lives on the `TR` ("triangulation") namespace.

---

## Verdict: standard-or-custom

**Custom.** It is NOT a classic half-edge / doubly-connected-edge-list (DCEL) planar-subdivision
face traversal. It is exactly the pipeline the prompt guessed:

> **triangulate the plan → mark wall edges as `fixed` → flood-fill triangle groups across
> non-fixed edges → walk each group's boundary by turn-angle.**

Evidence, in pipeline order (`TR.rebuildContours`, line 51094 → `TR.triangulateContours`, 50926):

1. **Segment prep.** `TR.resplitSegments` (50272) splits collinear overlapping wall segments on
   the X/Y-axis groups so shared/overlapping walls become a clean shared-vertex graph
   (`rebuildGroup`, 50348: sort points on axis, mark covered sub-spans, re-emit unit edges).
2. **Graph cleanup.** `imported_clean_graph(ptCoords, edges)` (50983) — an **external bundled
   library** (not defined in this file; see gaps) that dedups coincident points / resolves
   crossing edges before triangulation.
3. **Constrained triangulation.** `imported_triangulate(points, edges, {exterior: true})`
   (50635) — again an external CDT library. `{exterior: true}` keeps the outer triangles too.
4. **Half-edge-_lite_ adjacency built by hand** in `TR.createStructure` (50640): every triangle
   gets 3 `edge` objects keyed by sorted point-index pair in `dictEdge`; each edge stores
   `edge.triangles = []` (1 or 2 triangles). Wall segments are flagged by matching against
   `fixedEdgeIndices` → `edge.fixed = true` (50675-50689). This edge→triangles map is the only
   "topology" structure; there is no next/twin half-edge pointer, no per-directed-edge record.
5. **Flood-fill grouping** in `TR.groupTriangles` (50692): connected components of triangles,
   crossing an edge only if `!(edge.fixed && separateByFixedEdges)` and the edge is shared by 2
   triangles (50719-50720). Each component = one candidate region.
6. **Boundary walk** per group in `TR.contoursFromGroup` (50738): collect the fixed edges,
   pick the leftmost vertex, walk by extreme turn-angle. Outer contour + holes.

So the "what is a room" decision is made by (a) which triangles are separated by `fixed` (wall)
edges, and (b) an inside/outside test at each group's centroid (`TR.triangulateContours`,
51016-51089) that classifies a group as `fill` (room interior) vs `hole` vs `empty`.

---

## Flood-fill & grouping

`TR.groupTriangles(triObjects, separateByFixedEdges)` (50692):

- Resets `tri.added = false` on all triangles, then for each unvisited triangle starts a new
  group array and calls the inner `checkTriangle`.
- `checkTriangle` (50709) is **plain recursion**, not an explicit stack. It marks `added`, pushes
  the triangle into the current group, and for each of the 3 edges recurses into the _other_
  triangle sharing that edge — unless the edge is `fixed` (and `separateByFixedEdges` is on) or is
  a boundary edge (`ed.triangles.length <= 1`).
- With `separateByFixedEdges = true`, walls act as flood-fill barriers → each enclosed room is one
  component. Called with `true` for the room pass (`TR.triangulate`, 50637) and for covers
  (`rebuildContours` line 51117 `separateContacting`), and `false` for holes (51118).

Region classification (`TR.triangulateContours`, 50993-51089): for each group it finds a
non-degenerate triangle (`triangleIsNarrow` guard, 51001), takes its centroid, and does
point-in-contour tests against the four input contour sets
(`inpOuterContours`/`inpInnerContours`/`inpBoundContours`/`inpSubtrContours`) to decide `fill`
vs `empty`. `fill` groups go to `fillTrs` + `TR.fillGroups`; the rest to `holeTrs`. This
centroid inside/outside test is how a triangle-group becomes "a room" vs "the space between
rooms".

---

## Boundary walk & holes (the crown jewel)

`TR.contoursFromGroup(triGroup, onlyFixedEdges, findInner)` (50738):

1. **Edge collection → adjacency dict.** Build `dictPointIndex`: for each triangle edge (only
   `fixed` ones when `onlyFixedEdges`, 50751), record an undirected neighbour list
   `dictPointIndex[a] = [b, ...]` (50755-50759). This is the boundary graph of the group.
2. **First contour = outer** via `getOneContour()` (50832). If `!onlyFixedEdges` (e.g. the total
   outline call at 51126) it returns after one contour.
3. **Leftmost-vertex start + turn-angle walk** (`getOneContour` + `nextPt`, 50832-50910):
   - Start at the vertex with the smallest X (50836-50845) — guaranteed to be on the outer hull.
   - Seed the "previous point" as `[targPt.x - 10, targPt.y]` (a virtual point to the left, 50875) so the first turn is well-defined.
   - At each vertex, `nextPt` computes `TR.angleBetweenLines(prev→curr, curr→neighbour)` for every
     neighbour (`angleBetweenLines` = `atan2` difference normalized to [0,2π), 49754) and picks
     the neighbour with **max angle for CW, min angle for CCW** (50896-50909).
   - Winding control: `var CW = !(inner && res.length == 0)` (50858). Outer contour is walked one
     way; each **hole (`inner`) is walked with the opposite winding on its first step** — this is
     their CCW-outer / CW-hole orientation normalization, baked into that one boolean.
4. **Holes = remaining contours.** After the outer contour, `clearDict()` (50792) deletes the
   used vertices and then iteratively prunes **dead-ends / dangling chains**: any vertex whose
   neighbour list drops to length 1 is removed, looping until stable (50796-50829). Then
   `getOneContour(true)` is called repeatedly (50772-50788); each returns one hole contour until
   the dict is empty. So holes are simply the leftover closed loops inside the group after the
   outer loop is consumed.
5. **Hole → room association** is _not_ done geometrically here. `contoursFromGroup` returns
   `[outerContour, hole1, hole2, ...]` for one group, and the caller keeps them together:
   `rebuildContours` (51128-51145) pushes `contours[0]` as the room outline and, when
   `separateContacting`, `contours.slice(1)` as that room's inner contours. A hole belongs to the
   room whose triangle-group it was extracted from — association is by shared group membership,
   not a containment test. (Cross-group holes go through `holeGroups` + `contoursAdjacent`
   dedup at 51147-51156.)

Robustness guards worth noting: `res.length > pointsNum → return null` (50856) bails out of a
runaway walk (defends against malformed graphs / infinite loops), and `nextPt` returns `-1` if a
vertex has ≤1 neighbour (50883) which also aborts the contour. `TR.clearContour` (50398) then
merges near-coincident points (`minLen = 5`) and drops collinear vertices, and `TR.contourValid`
(50525) rejects contours below `MIN_CONTOUR_AREA = 50` or a bad area/perimeter ratio.

---

## Room re-attach by overlap

After any edit, rooms are fully rebuilt (`rebuildContours`), so old `CRoom` objects are thrown
away and new ones created (`me.arrRooms = []`, 59633). To avoid losing a room's material/data,
old attributes are re-attached by **fuzzy area overlap** (build-rooms flow, 59688-59701):

```js
if (me.arrRooms[i].outer != oldRooms[j].outer) continue;
if (TR.compareContoursByArea(oldRooms[j].points, me.arrRooms[i].points) == TR.INTERSECT)
{ me.arrRooms[i].data = oldRooms[j].data; break; }
```

`TR.compareContoursByArea` (49963) is the 10×10 grid sampler: it takes contour A's bounding box,
lays a `setSize = 10` grid (100 sample points) over it, and counts points inside A, inside B,
inside both. **If any sample is inside both (`ptsInAB > 0`) → `INTERSECT`, else `OUTSIDE`.** So
the match is "do the new and old room overlap in area at all" — cheap, tolerant of the edited
boundary having moved. The first overlapping old room of the same `outer` polarity donates its
`data`. Covers use the identical pattern (59860-59867, 59983), copying `data` incl. `ceiling`.

This is distinct from the precise `TR.compareContours` (50001), which does full
segment-intersection + point-in/out + contact tests and returns the rich classification
`OUTSIDE / BELONG / CONTAIN / INTERSECT / CONTACT / CONTACT_BELONG / CONTACT_CONTAIN / COINCIDE`
(constants at 49473-49480). `compareContours` is used for structural room/cover/hole nesting
decisions; `compareContoursByArea` is used only for the tolerant old→new re-attach. Using the
fuzzy version for re-attach is deliberate: a precise `CONTAIN`/`INTERSECT` test would fail when
an edit nudges a wall, but a 100-sample area overlap survives it. **This is the load-bearing
"edits don't lose a room's material" behavior.**

---

## Edge cases & recursion

- **Rooms sharing a wall (touching).** Handled at the source: `resplitSegments` (50272) splits
  coincident/overlapping collinear walls into shared unit edges so the shared wall is one `fixed`
  edge between two triangle groups → two clean rooms. `separateContacting`/`separateByFixedEdges`
  controls whether contacting fills are split.
- **Nested room (room inside room).** The inner room's walls are `fixed` edges; its triangles
  form their own flood-fill group; the annulus between them is another group. The centroid
  inside/outside test (51021-51022) decides which is fill. Nesting relationships between resulting
  contours are then resolved with `compareContours` returning `CONTAIN`/`BELONG` (used e.g. at
  54536, 60026-60048).
- **Non-manifold junctions (3+ walls at a point).** A vertex with >2 neighbours in
  `dictPointIndex` is handled by the turn-angle choice in `nextPt` (50890-50909): it always takes
  the extreme-angle edge, which is the correct "hug the boundary" choice at a T/X junction. No
  special-casing needed — the min/max-angle rule _is_ the non-manifold handler.
- **Dangling walls (not part of any room).** A wall that doesn't close a region leaves dead-end
  chains in the boundary graph; `clearDict` (50792-50829) iteratively strips any vertex that
  drops to a single neighbour, so dangling walls are pruned before hole extraction and never
  produce a spurious contour.
- **Duplicate / coincident points.** `imported_clean_graph` (50983, external) plus
  `resplitSegments` axis-grouping (`L_EPS = 1e-8`, `B_EPS = 1e-4`) dedup at graph level;
  `clearContour` (50398, `minLen = 5`) merges near-coincident vertices in the final contour.
- **Recursion / stack-overflow risk.** **Real and unmitigated.** `TR.groupTriangles.checkTriangle`
  (50709) is direct recursion, one frame per triangle in a connected group. A large room (many
  thousands of triangles) can blow the JS call stack — there is _no_ explicit stack/worklist here.
  The boundary walk, by contrast, is iterative with an explicit `res.length > pointsNum` cap
  (50856), so _it_ is safe. So: the **flood-fill is the recursion risk; the boundary walk is not.**

---

## What we'd reuse vs replicate

For our fresh TS build:

- **Keep the overall pipeline.** triangulate → mark wall edges fixed → flood-fill triangle groups
  → boundary-walk each group is a solid, well-proven architecture and maps cleanly to a CDT
  library (e.g. `poly2tri`, CGAL-style CDT, or a WASM Delaunay). It also gives us triangles for
  free (needed for area/rendering), which a pure half-edge planar-face lib would not.
- **Reuse the ideas, not the code:** the `edge.fixed` flag as the flood-fill barrier; the
  leftmost-vertex + turn-angle boundary walk with the CW/CCW winding flip for holes; the
  centroid inside/outside classification; and especially the **10×10 area-overlap re-attach** —
  that fuzzy match is the single most valuable, non-obvious robustness trick and we should port
  its behavior directly (grid-sample overlap, first-match-of-same-polarity wins).
- **Replace the recursion.** Implement flood-fill with an explicit stack/queue — cheap, removes
  the only genuine correctness landmine.
- **A half-edge library is not clearly cleaner.** It would give principled face traversal, but we
  still need triangles, still need the wall-edge-as-barrier semantics, and would then be
  re-implementing exactly this grouping on top of it. The triangulate+flood-fill approach is the
  right call for a room planner; the turn-angle walk is the part where a mature half-edge lib
  could reduce our own edge-case surface, but it's a small, self-contained function to test.
- **Load-bearing behaviors to preserve exactly:** dead-end pruning before hole extraction
  (`clearDict`); the min-X start guaranteeing outer-hull start; `res.length > pointsNum` walk
  cap; `contourValid` min-area/ratio filtering; and the tolerant re-attach.

---

## Confidence & gaps

- **High confidence** on the custom triangulate+flood-fill+turn-angle-walk verdict, the boundary
  walk mechanics, the recursion risk, and the fuzzy area-overlap re-attach — all read directly
  from the un-minified source with cited line numbers.
- **Gap (since closed):** `imported_triangulate` and `imported_clean_graph` (50635, 50983) are
  external bundled functions not present in this file. The bundle has since been identified:
  stock **cdt2d + clean-pslg** (`tris.js:1912–1921`) — see
  [dd01](01-triangulation-core.md) for the full audit of the triangulator and its wrapper.
- **Minor gap:** hole→room association is asserted from group membership + caller wiring
  (`rebuildContours` 51128-51156); I did not exhaustively trace every downstream consumer of the
  `[outer, inner, groups]` triple, so an edge case in cover/area flows (findAutoCovers, 59714+)
  could handle holes slightly differently than the room flow shown.
