import type { FaceRef } from '../../document/geometry/axes/findAxes';
import { CLEAR_CONTOUR_MIN_LEN } from '../../document/geometry/contours/clearContour';
import { euclDist } from '../../document/geometry/predicates/distance';
import { createId, type Id } from '../../document/id';
import type { PlanPosition, Point } from '../../document/PlannerDocument';
import { quantize } from '../../document/quantize';
import type { PlannerStore } from '../PlannerStore';
import { err, ok, type Result } from '../../document/Result';
import {
  isFinitePosition,
  resolveFloor,
  resolvePoint,
  type UnknownFloorError,
  type UnknownPointError,
} from './layoutAccess';

export interface InsertPointOptions {
  /**
   * Id новой вершины. Нужен, когда вызывающий обязан знать его **до** транзакции: инструмент входит в драг
   * рождённой вершины тем же `pointerDown`, а эффекты автомата выполняются уже после перехода (ADR 0019 E1),
   * поэтому вернуть id постфактум некуда. Без опции — свежий `uuidv7`.
   */
  id?: Id;
}

export type InsertPointError =
  | UnknownFloorError
  | UnknownPointError
  /** Контура нет либо `a`/`b` не соседи в его кольце (в любом из двух порядков обхода). */
  | { kind: 'unknown-face'; face: FaceRef }
  /** Не конечная координата (`NaN`/`±Infinity`) — в plain-JSON документ не попадает (ADR 0016 B5). */
  | { kind: 'invalid-coordinate' }
  /** Id уже занят точкой пула: вставка затёрла бы чужую вершину. */
  | { kind: 'duplicate-id'; id: Id }
  /** Ближе `CLEAR_CONTOUR_MIN_LEN` к концу грани — `clearContour` схлопнул бы вершину обратно. */
  | { kind: 'too-short' };

/**
 * Команда `document.insertPoint` (ADR 0018 D1) — рождение новой вершины **на существующей грани** (ручка деления
 * грани, спека 01): точка дописывается в `layout.points` и вставляется в кольцо контура между `face.a` и `face.b`.
 *
 * Чего команда **не** делает: не разрезает соседние контуры, полы и зоны, делящие ту же грань, — их заводит
 * `normalize` (`resplitSegments`/`clean-pslg`, ADR 0017 C6), ровно тем же путём, что и T-стык от дропа точки.
 * Именно поэтому `movePoints` разрезом не занимается, а отдельной команды `mergePoints` нет и не будет.
 *
 * Позиция квантуется и обязана лежать не ближе `CLEAR_CONTOUR_MIN_LEN` = 5 см от обоих концов грани: ближе её
 * всё равно схлопнет `clearContour` на том же прогоне `normalize`, и жест «не сработал бы» молча — поэтому отказ,
 * а не тихая потеря. Позицию поджимает вызывающий (`splitPositionOn`), команда лишь не пускает мимо порога.
 *
 * Ключ коалесинга `'insert-point:<id>'` формирует сама команда (D5): следующий `movePoints` с тем же ключом
 * заменяет запись — весь жест деления остаётся **одним** шагом истории. Возвращает id новой вершины.
 */
export const insertPoint = (
  store: PlannerStore,
  floorId: Id,
  face: FaceRef,
  position: PlanPosition,
  { id }: InsertPointOptions = {},
): Result<Id, InsertPointError> => {
  const floor = resolveFloor(store.getDocument(), floorId);
  if (!floor.ok) return floor;
  const { layout } = floor.value;

  const a = resolvePoint(layout, face.a);
  if (!a.ok) return a;
  const b = resolvePoint(layout, face.b);
  if (!b.ok) return b;

  const contour = layout.contours.find(candidate => candidate.id === face.contourId);
  const at = contour ? edgeIndex(contour.points, face.a, face.b) : -1;
  if (!contour || at < 0) return err({ kind: 'unknown-face', face });

  if (!isFinitePosition(position)) return err({ kind: 'invalid-coordinate' });
  const point: PlanPosition = { x: quantize(position.x), y: quantize(position.y) };
  if (euclDist(point, a.value) < CLEAR_CONTOUR_MIN_LEN || euclDist(point, b.value) < CLEAR_CONTOUR_MIN_LEN) {
    return err({ kind: 'too-short' });
  }

  const pointId = id ?? createId();
  if (Object.hasOwn(layout.points, pointId)) return err({ kind: 'duplicate-id', id: pointId });

  store.transact(
    draft => {
      const target = draft.floors.find(candidate => candidate.id === floorId)!.layout;
      const record: Point = { id: pointId, x: point.x, y: point.y };
      target.points[pointId] = record;
      target.contours.find(candidate => candidate.id === face.contourId)!.points.splice(at + 1, 0, pointId);
    },
    { history: { zone: 'layout', coalesce: `insert-point:${pointId}` } },
  );
  return ok(pointId);
};

/**
 * Индекс вершины, **после** которой встаёт новая: `a`/`b` должны быть соседями в кольце. Порядок концов в
 * `FaceRef` произвольный (`normalize` сохраняет id контура при той же циклической последовательности, но
 * направление обхода в него не заложено), поэтому проверяются оба.
 */
const edgeIndex = (ring: readonly Id[], a: Id, b: Id): number => {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [from, to] = [ring[i]!, ring[(i + 1) % n]!];
    if ((from === a && to === b) || (from === b && to === a)) return i;
  }
  return -1;
};
