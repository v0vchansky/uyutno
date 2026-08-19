import { draftCandidates, type SnapCandidate } from '../../document/geometry/snap/candidates';
import {
  getSnapPoint,
  missSnap,
  SNAP_DIST,
  type SnapHit,
  type SnapResult,
} from '../../document/geometry/snap/getSnapPoint';
import { guidesFor, type GuideFace, type SnapGuide } from '../../document/geometry/snap/guidesFor';
import { pixelsToPlan } from '../../document/geometry/viewport';
import type { PlanPosition } from '../../document/PlannerDocument';
import type { ToolContext } from './ToolHandler';
import type { PointerInput } from './ToolState';

/**
 * Общее для инструментов рисования («Стены», «Прямоугольник», «Комната по точкам»): snap-first курсор по одному
 * рецепту (ADR 0019 E2, Q31) и сравнение кадров по значению — фильтр no-op для `tools:changed` (дубль
 * `pointerMove`, пересчёт после смены окружения без последствий).
 */

/** Живая часть кадра рисования: снапнутый курсор, результат снапа и гайды к нему. */
export interface CursorFrame {
  cursor: PlanPosition;
  snap: SnapResult;
  guides: readonly SnapGuide[];
}

/**
 * Пул = индекс этажа + зафиксированные точки рисуемого контура (`draftCandidates`); орто-якоря — зафиксированные
 * точки без живого курсора; радиус — `SNAP_DIST` px в план по viewport. Ctrl/Cmd зажат — снап выключен целиком:
 * квантованный сырой курсор без гайдов.
 */
export const snapCursor = (points: readonly PlanPosition[], input: PointerInput, ctx: ToolContext): SnapResult => {
  if (input.mods.ctrl || input.mods.meta) return missSnap(input);
  const index = ctx.snapIndex();
  const candidates: SnapCandidate[] = [...index.candidates, ...draftCandidates(points)];
  return getSnapPoint(input, candidates, {
    snapDist: pixelsToPlan(ctx.viewport, SNAP_DIST),
    viewport: ctx.viewport,
    flags: ctx.snapFlags,
    contour: points,
  });
};

/** Что рисовать из снапа: `lastPoint` — угловой фильтр расширенных гайдов от последнего сегмента полилинии (`null` — только основные, как `drawAligner` референса); `face` — параллельный пунктир второй грани (только «Стены»). */
export interface DrawingGuideOptions {
  lastPoint: PlanPosition | null;
  face: GuideFace | null;
}

/** Гайды к результату снапа при рисовании; подавление «на стене» — по рёбрам этажа. */
export const drawingGuides = (
  snap: SnapResult,
  ctx: ToolContext,
  { lastPoint, face }: DrawingGuideOptions,
): readonly SnapGuide[] => guidesFor(snap, { lastPoint, segments: ctx.snapIndex().segments, face });

/** Снап + гайды одним вызовом. */
export const cursorFrame = (
  points: readonly PlanPosition[],
  input: PointerInput,
  ctx: ToolContext,
  guides: DrawingGuideOptions,
): CursorFrame => {
  const snap = snapCursor(points, input, ctx);
  return { cursor: snap.snapped, snap, guides: drawingGuides(snap, ctx, guides) };
};

export const samePosition = (a: PlanPosition | null, b: PlanPosition | null): boolean =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y);

const sameCandidate = (a: SnapCandidate | null, b: SnapCandidate | null): boolean =>
  a === b || (a !== null && b !== null && a.id === b.id && a.x === b.x && a.y === b.y);

const sameHit = (a: SnapHit, b: SnapHit): boolean =>
  a.kind === b.kind &&
  ('id' in a ? a.id === (b as { id: string }).id : true) &&
  ('axis' in a ? a.axis === (b as { axis: string }).axis : true);

export const sameSnap = (a: SnapResult | null, b: SnapResult | null): boolean => {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    samePosition(a.snapped, b.snapped) &&
    sameHit(a.hit, b.hit) &&
    sameCandidate(a.alignerX, b.alignerX) &&
    sameCandidate(a.alignerY, b.alignerY) &&
    sameCandidate(a.bisAnchor, b.bisAnchor) &&
    sameCandidate(a.rawAlignersX[0], b.rawAlignersX[0]) &&
    sameCandidate(a.rawAlignersX[1], b.rawAlignersX[1]) &&
    sameCandidate(a.rawAlignersY[0], b.rawAlignersY[0]) &&
    sameCandidate(a.rawAlignersY[1], b.rawAlignersY[1])
  );
};

const sameGuide = (a: SnapGuide, b: SnapGuide): boolean =>
  a.kind === b.kind &&
  samePosition(a.from, b.from) &&
  samePosition(a.to, b.to) &&
  (a.face === b.face ||
    (a.face !== null && b.face !== null && samePosition(a.face.a, b.face.a) && samePosition(a.face.b, b.face.b)));

export const sameGuides = (a: readonly SnapGuide[], b: readonly SnapGuide[]): boolean =>
  a.length === b.length && a.every((guide, index) => sameGuide(guide, b[index]!));

/** Совпадают ли живые части кадров: курсор, снап и гайды (превью — функция курсора и стабильной части, отдельно не сравнивается). */
export const sameCursorFrame = (
  a: { cursor: PlanPosition | null; snap: SnapResult | null; guides: readonly SnapGuide[] },
  b: { cursor: PlanPosition | null; snap: SnapResult | null; guides: readonly SnapGuide[] },
): boolean => samePosition(a.cursor, b.cursor) && sameSnap(a.snap, b.snap) && sameGuides(a.guides, b.guides);
