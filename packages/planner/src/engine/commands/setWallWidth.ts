import type { FaceRef, WallAxis } from '../../document/geometry/axes/findAxes';
import type { Id } from '../../document/id';
import type { PlanPosition, Point } from '../../document/PlannerDocument';
import { quantize } from '../../document/quantize';
import type { PlannerStore } from '../PlannerStore';
import { err, ok, type Result } from '../Result';
import {
  movesSelfIntersect,
  resolveFloor,
  resolvePoint,
  type UnknownFloorError,
  type UnknownPointError,
} from './layoutAccess';
import { MAX_EDGE_LENGTH } from './setEdgeLength';
import { writePositions } from './writePositions';

/**
 * Нижний порог ширины стены, см (`too-short`). Пол длины 15 см из D1 к ширине неприменим (`DEFAULT_WALL_WIDTH =
 * 10`); 1 см — защита от схлопывания граней в одну линию. Верх — тот же лимит парсера, что у длины
 * (`MAX_EDGE_LENGTH`): `MAX_WALL_WIDTH = 80` — порог детектора оси, «не пользовательский лимит ввода» (спека 01);
 * стена шире 80 см просто перестаёт быть стеной с осью, следующая правка ширины даст `unknown-axis`.
 */
export const MIN_WALL_WIDTH = 1;

export type SetWallWidthError =
  | UnknownFloorError
  | UnknownPointError
  /** Такой пары граней в `getDerived().floors[].axes` больше нет — между вводом и коммитом прошёл rebuild. */
  | { kind: 'unknown-axis'; faces: [FaceRef, FaceRef] }
  | { kind: 'too-short'; width: number; min: number }
  | { kind: 'out-of-range'; width: number; max: number }
  | { kind: 'contour-self-intersected' };

/** Ключ коалесинга серии правок ширины одной стены (ADR 0018 D5) — по сдвигаемой грани `faces[0]`. */
export const wallWidthCoalesceKey = ([face]: readonly [FaceRef, FaceRef]): string => `wall-width:${face.a}|${face.b}`;

/**
 * Команда `document.setWallWidth` (ADR 0018 D1, спека 01 «Применение к ребру»): ось адресуется парой граней
 * из `DerivedFloor.axes[].faces` (осей без id — C8), в любом порядке; `faces[0]` — сдвигаемая (выбранная)
 * грань, `faces[1]` — противоположная. Δ = `width` − `depth`; оба конца `faces[0]` сдвигаются на Δ по
 * нормали к оси в сторону от `faces[1]`. Проверка самопересечения — по контурам-владельцам до записи.
 * Одна транзакция с ключом `'wall-width:<a>|<b>'` по `faces[0]`.
 */
export const setWallWidth = (
  store: PlannerStore,
  floorId: Id,
  faces: readonly [FaceRef, FaceRef],
  width: number,
): Result<void, SetWallWidthError> => {
  const floor = resolveFloor(store.getDocument(), floorId);
  if (!floor.ok) return floor;
  const [movable, opposite] = faces;
  const axis = store
    .getDerived()
    .floors.find(candidate => candidate.id === floorId)
    ?.axes.find(candidate => sameFacePair(candidate, movable, opposite));
  if (!axis) return err({ kind: 'unknown-axis', faces: [movable, opposite] });
  const { layout } = floor.value;
  const a = resolvePoint(layout, movable.a);
  if (!a.ok) return a;
  const b = resolvePoint(layout, movable.b);
  if (!b.ok) return b;
  const oppositeA = resolvePoint(layout, opposite.a);
  if (!oppositeA.ok) return oppositeA;
  const oppositeB = resolvePoint(layout, opposite.b);
  if (!oppositeB.ok) return oppositeB;
  if (!Number.isFinite(width) || width > MAX_EDGE_LENGTH) {
    return err({ kind: 'out-of-range', width, max: MAX_EDGE_LENGTH });
  }
  if (width < MIN_WALL_WIDTH) return err({ kind: 'too-short', width, min: MIN_WALL_WIDTH });

  const delta = width - axis.depth;
  const normal = awayNormal(axis, [a.value, b.value], [oppositeA.value, oppositeB.value]);
  const moves = new Map<Id, PlanPosition>();
  if (delta !== 0) {
    moves.set(movable.a, shifted(a.value, normal, delta));
    moves.set(movable.b, shifted(b.value, normal, delta));
  }
  if (movesSelfIntersect(layout, moves)) return err({ kind: 'contour-self-intersected' });

  writePositions(store, floorId, moves, wallWidthCoalesceKey(faces));
  return ok(undefined);
};

const sameFace = (x: FaceRef, y: FaceRef): boolean => x.contourId === y.contourId && x.a === y.a && x.b === y.b;

const sameFacePair = (axis: WallAxis, first: FaceRef, second: FaceRef): boolean =>
  (sameFace(axis.faces[0], first) && sameFace(axis.faces[1], second)) ||
  (sameFace(axis.faces[0], second) && sameFace(axis.faces[1], first));

/** Единичная нормаль к оси, направленная от середины противоположной грани к середине сдвигаемой. */
const awayNormal = (axis: WallAxis, movable: [Point, Point], opposite: [Point, Point]): PlanPosition => {
  const dx = axis.b.x - axis.a.x;
  const dy = axis.b.y - axis.a.y;
  const length = Math.hypot(dx, dy);
  const normal = { x: -dy / length, y: dx / length };
  const towards = {
    x: (movable[0].x + movable[1].x - opposite[0].x - opposite[1].x) / 2,
    y: (movable[0].y + movable[1].y - opposite[0].y - opposite[1].y) / 2,
  };
  return normal.x * towards.x + normal.y * towards.y >= 0 ? normal : { x: -normal.x, y: -normal.y };
};

const shifted = (position: PlanPosition, normal: PlanPosition, by: number): PlanPosition => ({
  x: quantize(position.x + normal.x * by),
  y: quantize(position.y + normal.y * by),
});
