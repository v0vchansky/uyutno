import type { PlanPosition } from '../../PlannerDocument';
import { L_EPS } from './pointsMatch';

/** Сторона офсета относительно направления `a→b` при y вверх: `'left'` — против часовой от направления. */
export type OffsetSide = 'left' | 'right';

/** Вектор смещения `distance` по нормали к `a→b` в сторону `side`; `|ab| < L_EPS` → `null`. */
const offsetVector = (a: PlanPosition, b: PlanPosition, distance: number, side: OffsetSide): PlanPosition | null => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!(length >= L_EPS)) return null;
  const sign = side === 'right' ? 1 : -1;
  return { x: (sign * distance * dy) / length, y: -(sign * distance * dx) / length };
};

/**
 * Точка `a`, смещённая на `distance` по нормали к направлению `a→b` в сторону `side` (ADR 0017 C4, rework
 * `perpendicularPoint`): нормаль нормированная — правая `(dy, −dx)/len`, левая `(−dy, dx)/len`; сторона —
 * явный enum, а не знак `distance` и не порядок вершин. Отрицательный `distance` разрешён и означает
 * противоположную сторону. Гард нулевой длины: `|ab| < L_EPS` → `null` (направление не определено).
 */
export const offsetPoint = (
  a: PlanPosition,
  b: PlanPosition,
  distance: number,
  side: OffsetSide,
): PlanPosition | null => {
  const shift = offsetVector(a, b, distance, side);
  return shift && { x: a.x + shift.x, y: a.y + shift.y };
};

/**
 * Оба конца отрезка `ab`, смещённые на `distance` в одну и ту же сторону `side` от направления `a→b`.
 * Удобство для ленты: концы считаются от одного направления, без разворотов знака. `|ab| < L_EPS` → `null`.
 */
export const offsetSegment = (
  a: PlanPosition,
  b: PlanPosition,
  distance: number,
  side: OffsetSide,
): [PlanPosition, PlanPosition] | null => {
  const shift = offsetVector(a, b, distance, side);
  return (
    shift && [
      { x: a.x + shift.x, y: a.y + shift.y },
      { x: b.x + shift.x, y: b.y + shift.y },
    ]
  );
};
