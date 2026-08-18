import type { Id } from '../../id';
import type { PlanPosition } from '../../PlannerDocument';
import { quantize } from '../../quantize';
import { manhDist } from '../predicates/distance';
import { lineIntersectLine } from '../predicates/lineIntersectLine';
import { projectPointOnLine } from '../predicates/projectPointOnLine';
import { viewportBounds, type Viewport } from '../viewport';
import { bisectorSnap, type BisectorSnap } from './bisectorSnap';
import { cullCandidates, NO_ALIGNERS, type AlignerPair, type SnapCandidate } from './candidates';
import { orthogonalSnap } from './orthogonalSnap';
import { snapPerpendicular, type Axis, type PerpendicularSnap } from './snapAxis';
import { snapToNearest } from './snapToNearest';

/**
 * Базовый радиус снапа, **CSS px** (спека 01 «Пороги», ADR 0019 E2; верифицировано по исходнику: `WC.SNAP_DIST = 10`):
 * точечный снап и оси; хит-тест стороны — `/2`; радиус угла биссектрисы — `× BISECTOR_SEARCH_FACTOR`. В план —
 * `pixelsToPlan(viewport, SNAP_DIST)`: при базовом зуме `scale = 1` это 10 см.
 */
export const SNAP_DIST = 10;

/** Радиус углового снапа при `pointsSnap = off`, **см плана** (спека 01: притяжение к углам не исчезает, а сжимается до 2 см). */
export const POINT_SNAP_OFF_RADIUS = 2;

/** Флаги снапа — состояние `tools`, не документ (ADR 0019 E2; спека 01 «Флаги в UI»). */
export interface SnapFlags {
  /** Притяжение к углам (существующим вершинам). */
  pointsSnap: boolean;
  /** Оси (вертикали/горизонтали) через точки плана. */
  pointsAlign: boolean;
  /** H/V-лок относительно последней и первой точки рисуемого контура. */
  orthoAlign: boolean;
  /** Биссектриса ближайшего угла. */
  bisectorAlign: boolean;
}

/** Дефолты спеки 01: on / on / off / on. */
export const DEFAULT_SNAP_FLAGS: Readonly<SnapFlags> = Object.freeze({
  pointsSnap: true,
  pointsAlign: true,
  orthoAlign: false,
  bisectorAlign: true,
});

export interface SnapParams {
  /** Радиус снапа в единицах плана — `pixelsToPlan(viewport, SNAP_DIST)`; px → план делает вызывающий (ADR 0019 E2). */
  snapDist: number;
  /** Видимая область — куллинг кандидатов **всегда on** во всех ветках (спека 01 «Куллинг»). */
  viewport: Viewport;
  flags: SnapFlags;
  /** Кандидаты, к которым нельзя снапиться/выравниваться (перетаскиваемая точка); один id покрывает совладельцев. */
  exceptIds?: readonly Id[];
  /** Зафиксированные точки рисуемого контура (без живого курсора) — якоря орто-лока; вне рисования — пусто. */
  contour?: readonly PlanPosition[];
}

/** Что победило в лесенке (спека 01 «Приоритет»); `point` несёт id угла — цель слияния/дропа для инструментов. */
export type SnapHit =
  | { kind: 'point'; id: Id }
  | { kind: 'cross' }
  | { kind: 'bisector-axis'; axis: Axis }
  | { kind: 'ortho-bisector'; axis: Axis }
  | { kind: 'axis'; axis: Axis }
  | { kind: 'ortho' }
  | { kind: 'bisector' }
  | { kind: 'none' };

/**
 * Результат снапа — plain-значение в `ToolState` (ADR 0019 E2, аудит dd09 keep/rework: без глобалов `snapPos/aligners`).
 * `alignerX/alignerY` — представители осей и `rawAlignersX/Y` — сырые пары `[M, P]` возвращаются независимо от
 * победившей ветки (как у референса) — что из них рисовать, решает `guidesFor`; в орто-ветках (5/7) осевые
 * выравниватели и сырые пары — якоря орто-лока (id `ortho:*`; осей точек там заведомо нет, иначе победили бы
 * ветки 3/4/6), чтобы гайд вёл к точке контура;
 * `bisAnchor` — только когда победила биссектрисная ветка (3/4/5/8).
 */
export interface SnapResult {
  /** Итоговая позиция, квантована на 0.001 (любой исход, включая промах — тогда это квантованный `raw`). */
  snapped: PlanPosition;
  alignerX: SnapCandidate | null;
  alignerY: SnapCandidate | null;
  bisAnchor: SnapCandidate | null;
  rawAlignersX: AlignerPair;
  rawAlignersY: AlignerPair;
  hit: SnapHit;
}

const NO_PERPENDICULAR: PerpendicularSnap = Object.freeze({
  point: null,
  alignerX: null,
  alignerY: null,
  rawAlignersX: NO_ALIGNERS,
  rawAlignersY: NO_ALIGNERS,
});

/** Вторая точка оси через `anchor`: вертикали (`x`) — выше на 1, горизонтали (`y`) — правее на 1. */
const axisEnd = (anchor: PlanPosition, axis: Axis): PlanPosition =>
  axis === 'x' ? { x: anchor.x, y: anchor.y + 1 } : { x: anchor.x + 1, y: anchor.y };

/** Пересечение биссектрисы с осью через `anchor`; `null` — параллельны/вырождены (`lineIntersectLine`). */
const bisectorAxisIntersection = (bis: BisectorSnap, anchor: PlanPosition, axis: Axis): PlanPosition | null =>
  lineIntersectLine(bis.anchor, bis.direction, anchor, axisEnd(anchor, axis), { asSegment: false });

const quantizePoint = (point: PlanPosition): PlanPosition => ({ x: quantize(point.x), y: quantize(point.y) });

const result = (
  target: PlanPosition,
  perp: PerpendicularSnap,
  bisAnchor: SnapCandidate | null,
  hit: SnapHit,
): SnapResult => ({
  snapped: quantizePoint(target),
  alignerX: perp.alignerX,
  alignerY: perp.alignerY,
  bisAnchor,
  rawAlignersX: perp.rawAlignersX,
  rawAlignersY: perp.rawAlignersY,
  hit,
});

/**
 * Лесенка приоритетов снапа (спека 01 «Приоритет», ADR 0019 E2; 1:1 с `getSnapPoint` референса, кроме явного
 * приоритета Y в ветке 5). Все пороги — в единицах плана; куллинг по `viewport` применяется ко всему пулу до
 * любой ветки. Фаза сбора: угол (`snapToNearest`, радиус `snapDist` либо `POINT_SNAP_OFF_RADIUS` при
 * `pointsSnap = off`), оси (`snapPerpendicular`), орто (`orthogonalSnap`), биссектриса (`bisectorSnap`).
 * Приём любого точечного результата — **манхэттен** `< snapDist` (строго; `snapToNearest` находит и на `= snapDist`,
 * но ветка 1 его не принимает — как у референса, Q34).
 *
 * 1. угол; 2. крест (X ∧ Y); 3. биссектриса ∩ вертикаль `alignerX` (откат — одноосевой `pointPt`);
 * 4. биссектриса ∩ горизонталь `alignerY` (откат — `pointPt`); 5. орто ∩ биссектриса — при обоих орто-якорях
 * берётся **Y-вариант** (README «Приоритет Y-оси»; откат — `orthoPt`); 6. одна ось; 7. орто-лок; 8. проекция
 * на биссектрису; иначе — сырой курсор. Итог всегда квантован (`quantize`, 0.001).
 */
export const getSnapPoint = (
  raw: PlanPosition,
  candidates: readonly SnapCandidate[],
  { snapDist, viewport, flags, exceptIds = [], contour = [] }: SnapParams,
): SnapResult => {
  // Неконечный курсор — снапить нечего: детерминированный промах (`snapped` — как есть, `quantize` не-конечное пробрасывает).
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return result(raw, NO_PERPENDICULAR, null, { kind: 'none' });
  const bounds = viewportBounds(viewport);
  const pool = cullCandidates(candidates, bounds);
  const except: ReadonlySet<Id> = new Set(exceptIds);

  const nearPt = snapToNearest(raw, pool, flags.pointsSnap ? snapDist : POINT_SNAP_OFF_RADIUS, except);
  const perp = flags.pointsAlign ? snapPerpendicular(raw, pool, snapDist, except) : NO_PERPENDICULAR;
  const ortho = flags.orthoAlign ? orthogonalSnap(raw, contour, snapDist, bounds) : NO_PERPENDICULAR;
  const bis = flags.bisectorAlign ? bisectorSnap(raw, pool, snapDist, except) : null;

  const accepts = (point: PlanPosition | null): point is PlanPosition =>
    point !== null && manhDist(raw, point) < snapDist;
  const withBisector = (target: PlanPosition, hit: SnapHit): SnapResult =>
    result(target, perp, bis?.anchor ?? null, hit);

  if (nearPt && manhDist(raw, nearPt) < snapDist) return result(nearPt, perp, null, { kind: 'point', id: nearPt.id });
  if (perp.point && perp.alignerX && perp.alignerY) return result(perp.point, perp, null, { kind: 'cross' });
  if (bis && perp.point && perp.alignerX) {
    const hit = bisectorAxisIntersection(bis, perp.alignerX, 'x');
    if (accepts(hit)) return withBisector(hit, { kind: 'bisector-axis', axis: 'x' });
    return result(perp.point, perp, null, { kind: 'axis', axis: 'x' });
  }
  if (bis && perp.point && perp.alignerY) {
    const hit = bisectorAxisIntersection(bis, perp.alignerY, 'y');
    if (accepts(hit)) return withBisector(hit, { kind: 'bisector-axis', axis: 'y' });
    return result(perp.point, perp, null, { kind: 'axis', axis: 'y' });
  }
  if (bis && ortho.point) {
    // Приоритет Y — явное правило (у референса Y-вариант перезаписывал X побочным эффектом порядка присваиваний).
    const axis: Axis = ortho.alignerY ? 'y' : 'x';
    const anchor = ortho.alignerY ?? ortho.alignerX!;
    const hit = bisectorAxisIntersection(bis, anchor, axis);
    if (accepts(hit)) return result(hit, ortho, bis.anchor, { kind: 'ortho-bisector', axis });
    return result(ortho.point, ortho, null, { kind: 'ortho' });
  }
  if (perp.point) return result(perp.point, perp, null, { kind: 'axis', axis: perp.alignerX ? 'x' : 'y' });
  if (ortho.point) return result(ortho.point, ortho, null, { kind: 'ortho' });
  if (bis) {
    const hit = projectPointOnLine(raw, bis.anchor, bis.direction, { asSegment: false });
    if (accepts(hit)) return withBisector(hit, { kind: 'bisector' });
  }
  return result(raw, perp, null, { kind: 'none' });
};
