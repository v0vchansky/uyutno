import type { Id } from '../../id';
import type { FloorLayout, PlanPosition } from '../../PlannerDocument';
import type { FaceRef } from '../axes/findAxes';
import { manhDist } from '../predicates/distance';
import { distanceToLine } from '../predicates/distanceToLine';
import { pointInContour } from '../predicates/pointInContour';
import { pointOnSegment } from '../predicates/pointOnSegment';
import { SNAP_DIST } from '../snap/getSnapPoint';
import { pixelsToPlan, type Viewport } from '../viewport';

/**
 * Хит-тест конструктора (ADR 0019 E4; спека 01 «Редактирование → Выбор»): чистая функция над планировкой этажа,
 * без импорта `engine/`. Приоритет: вершина → сторона (ребро контура) → комната. Пороги — в CSS px, в план —
 * `pixelsToPlan(viewport, px)`.
 */

/** Радиус хит-теста вершины и размер хендла, **CSS px** (верифицировано по исходнику: `POINT_SIZE = 6`; ADR 0019 E2). Метрика — манхэттен. */
export const POINT_SIZE = 6;

/** Радиус хит-теста стороны, **CSS px** — половина радиуса снапа (спека 01, ADR 0019 E2). */
export const WALL_HIT_DIST = SNAP_DIST / 2;

/** Цель хит-теста конструктора: вершина, сторона (грань хранимого контура) или комната (ADR 0019 E1/E4). */
export type HitTarget = { kind: 'point'; id: Id } | { kind: 'wall'; face: FaceRef } | { kind: 'room'; roomId: Id };

/**
 * Комната для хит-теста — структурная проекция `DerivedRoom` (`engine/rebuild.ts`): id записи, обвод по id точек
 * `layout.points` и площадь (при вложении комнат побеждает меньшая). Движок передаёт `derived.floors[i].rooms` как есть.
 */
export interface HitRoom {
  readonly roomId: Id;
  readonly outline: readonly Id[];
  readonly area: number;
}

export interface HitTestOptions {
  /**
   * Вершины, которые не участвуют (перетаскиваемая точка — один id покрывает совладельцев): исключаются сами точки
   * и рёбра, в которых они — конец (свои рёбра при драге едут вместе с точкой; целью дропа быть не могут).
   */
  exceptPointIds?: readonly Id[];
  /** Пропустить уровень комнат (цель дропа при драге — только вершина или сторона). */
  skipRooms?: boolean;
}

/** Совпадают ли две цели по значению (для фильтра no-op в автомате: та же цель — та же ссылка состояния). */
export const sameHitTarget = (a: HitTarget | null, b: HitTarget | null): boolean => {
  if (a === b) return true;
  if (a === null || b === null || a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'point':
      return a.id === (b as { id: Id }).id;
    case 'wall': {
      const other = (b as { face: FaceRef }).face;
      return a.face.contourId === other.contourId && a.face.a === other.a && a.face.b === other.b;
    }
    case 'room':
      return a.roomId === (b as { roomId: Id }).roomId;
  }
};

/**
 * Хит-тест по приоритету (ADR 0019 E4): (1) ближайшая по манхэттену вершина в `POINT_SIZE/scale` включительно;
 * (2) ребро контура (`outer`/`inner`, в порядке обхода, включая замыкающее) в коридоре `SNAP_DIST/2/scale`
 * (`pointOnSegment`), при нескольких — с наименьшим перпендикулярным расстоянием, при равенстве — первое;
 * (3) комната, строго содержащая точку (`pointInContour` по обводу), при вложении — с наименьшей площадью.
 * `NaN` во входе → `null`.
 */
export const hitTest = (
  point: PlanPosition,
  layout: FloorLayout,
  rooms: readonly HitRoom[],
  viewport: Viewport,
  { exceptPointIds = [], skipRooms = false }: HitTestOptions = {},
): HitTarget | null => {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const except = new Set(exceptPointIds);

  const pointRadius = pixelsToPlan(viewport, POINT_SIZE);
  let nearestId: Id | null = null;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (const vertex of Object.values(layout.points)) {
    if (except.has(vertex.id)) continue;
    const distance = manhDist(point, vertex);
    if (distance < nearestDist) {
      nearestDist = distance;
      nearestId = vertex.id;
    }
  }
  if (nearestId !== null && nearestDist <= pointRadius) return { kind: 'point', id: nearestId };

  const wallRadius = pixelsToPlan(viewport, WALL_HIT_DIST);
  let face: FaceRef | null = null;
  let faceDist = Number.POSITIVE_INFINITY;
  for (const contour of layout.contours) {
    const n = contour.points.length;
    for (let i = 0; i < n; i++) {
      const aId = contour.points[i]!;
      const bId = contour.points[(i + 1) % n]!;
      if (except.has(aId) || except.has(bId)) continue;
      const a = layout.points[aId];
      const b = layout.points[bId];
      if (!a || !b || !pointOnSegment(point, a, b, wallRadius)) continue;
      const distance = distanceToLine(point, a, b);
      if (distance < faceDist) {
        faceDist = distance;
        face = { contourId: contour.id, a: aId, b: bId };
      }
    }
  }
  if (face) return { kind: 'wall', face };

  if (skipRooms) return null;
  let roomId: Id | null = null;
  let roomArea = Number.POSITIVE_INFINITY;
  for (const room of rooms) {
    const outline = room.outline.map(id => layout.points[id]).filter(vertex => vertex !== undefined);
    if (outline.length < 3 || outline.length !== room.outline.length) continue;
    if (room.area < roomArea && pointInContour(point, outline)) {
      roomArea = room.area;
      roomId = room.roomId;
    }
  }
  return roomId === null ? null : { kind: 'room', roomId };
};
