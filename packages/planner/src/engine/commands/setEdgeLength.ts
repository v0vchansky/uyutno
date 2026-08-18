import { MIN_WALL_LENGTH } from '../../document/geometry/contours/validateContour';
import { euclDist } from '../../document/geometry/predicates/distance';
import type { Id } from '../../document/id';
import type { PlanPosition } from '../../document/PlannerDocument';
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
import { writePositions } from './writePositions';

/** Верхний лимит длины на входе (спека 01/07 «Ошибки парсинга»: 100 000 см = 1 км). */
export const MAX_EDGE_LENGTH = 100_000;

export interface EdgeRef {
  a: Id;
  b: Id;
}

export interface SetEdgeLengthOptions {
  /** Id фиксированного конца ребра (выделена точка — спека 07): вся Δ уходит на другой конец. */
  anchor?: Id;
}

export type SetEdgeLengthError =
  | UnknownFloorError
  | UnknownPointError
  /** `length < MIN_WALL_LENGTH` (спека 01: жёсткий пол 15 см, `0` — тоже «слишком мало»). */
  | { kind: 'too-short'; length: number; min: number }
  /** Не конечное число или `> MAX_EDGE_LENGTH`. */
  | { kind: 'out-of-range'; length: number; max: number }
  /** Концы ребра совпадают — направление сдвига не определено (после `normalize` не встречается). */
  | { kind: 'degenerate-edge' }
  /** Сдвиг дал бы самопересечение контура-владельца (C4) — операция отклонена, геометрия не тронута. */
  | { kind: 'contour-self-intersected' };

/** Ключ коалесинга серии правок одного ребра (ADR 0018 D5) — формирует команда, не UI. */
export const edgeLengthCoalesceKey = ({ a, b }: EdgeRef): string => `edge-length:${a}|${b}`;

/**
 * Команда `document.setEdgeLength` (ADR 0018 D1, спека 01 «Применение к ребру», спека 07): Δ = `length` −
 * текущая длина `a→b`; без `anchor` оба конца сдвигаются симметрично на ±Δ/2 по направлению ребра, с `anchor`
 * — вся Δ на противоположный конец. Проверка самопересечения — по контурам-владельцам после сдвига, до записи;
 * при ошибке транзакция не начинается. Одна транзакция с ключом `'edge-length:<a>|<b>'`.
 */
export const setEdgeLength = (
  store: PlannerStore,
  floorId: Id,
  edge: EdgeRef,
  length: number,
  { anchor }: SetEdgeLengthOptions = {},
): Result<void, SetEdgeLengthError> => {
  const floor = resolveFloor(store.getDocument(), floorId);
  if (!floor.ok) return floor;
  const { layout } = floor.value;
  const a = resolvePoint(layout, edge.a);
  if (!a.ok) return a;
  const b = resolvePoint(layout, edge.b);
  if (!b.ok) return b;
  if (anchor !== undefined && anchor !== edge.a && anchor !== edge.b) return err({ kind: 'unknown-point', id: anchor });
  if (!Number.isFinite(length) || length > MAX_EDGE_LENGTH) {
    return err({ kind: 'out-of-range', length, max: MAX_EDGE_LENGTH });
  }
  if (length < MIN_WALL_LENGTH) return err({ kind: 'too-short', length, min: MIN_WALL_LENGTH });

  const current = euclDist(a.value, b.value);
  if (current === 0) return err({ kind: 'degenerate-edge' });
  const delta = length - current;
  const unit = { x: (b.value.x - a.value.x) / current, y: (b.value.y - a.value.y) / current };
  const shiftA = anchor === edge.a ? 0 : anchor === edge.b ? -delta : -delta / 2;
  const shiftB = anchor === edge.b ? 0 : anchor === edge.a ? delta : delta / 2;

  const moves = new Map<Id, PlanPosition>();
  if (shiftA !== 0) moves.set(edge.a, shifted(a.value, unit, shiftA));
  if (shiftB !== 0) moves.set(edge.b, shifted(b.value, unit, shiftB));
  if (movesSelfIntersect(layout, moves)) return err({ kind: 'contour-self-intersected' });

  writePositions(store, floorId, moves, edgeLengthCoalesceKey(edge));
  return ok(undefined);
};

const shifted = (position: PlanPosition, unit: PlanPosition, by: number): PlanPosition => ({
  x: quantize(position.x + unit.x * by),
  y: quantize(position.y + unit.y * by),
});
