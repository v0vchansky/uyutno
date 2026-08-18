import type { Id } from '../../document/id';
import type { PlanPosition } from '../../document/PlannerDocument';
import { quantize } from '../../document/quantize';
import type { PlannerStore } from '../PlannerStore';
import { err, ok, type Result } from '../Result';
import {
  isFinitePosition,
  resolveFloor,
  resolvePoint,
  type UnknownFloorError,
  type UnknownPointError,
} from './layoutAccess';

export interface PointMove extends PlanPosition {
  id: Id;
}

export interface MovePointsOptions {
  /** Ключ коалесинга серии (ADR 0018 D5): нудж стрелками — `'nudge:<ids>'` (ADR 0019 E4); драг мышью — без ключа. */
  coalesce?: string;
}

export type MovePointsError =
  | UnknownFloorError
  | UnknownPointError
  /** Не конечная координата (`NaN`/`±Infinity`) у точки `id` — в plain-JSON документ не попадает (B5). */
  | { kind: 'invalid-coordinate'; id: Id };

/**
 * Команда `document.movePoints` (ADR 0018 D1): без геометрической валидации — квантование и запись координат
 * одной транзакцией; совладельцы общего id едут сами (ADR 0016 B4); слияние точек и разрез стены — не команды
 * (тождество координаты и T-стык делает `normalize`). Те же координаты — no-op без записи и событий.
 * Дубли `id` в пакете — последний побеждает.
 */
export const movePoints = (
  store: PlannerStore,
  floorId: Id,
  moves: readonly PointMove[],
  { coalesce }: MovePointsOptions = {},
): Result<void, MovePointsError> => {
  const floor = resolveFloor(store.getDocument(), floorId);
  if (!floor.ok) return floor;

  const quantized: PointMove[] = [];
  for (const move of moves) {
    const point = resolvePoint(floor.value.layout, move.id);
    if (!point.ok) return point;
    if (!isFinitePosition(move)) return err({ kind: 'invalid-coordinate', id: move.id });
    quantized.push({ id: move.id, x: quantize(move.x), y: quantize(move.y) });
  }

  store.transact(
    draft => {
      const layout = draft.floors.find(candidate => candidate.id === floorId)!.layout;
      for (const { id, x, y } of quantized) {
        const point = layout.points[id]!;
        // Поимённо: immer видит присваивание того же примитива как no-op.
        point.x = x;
        point.y = y;
      }
    },
    { history: { zone: 'layout', coalesce } },
  );
  return ok(undefined);
};
