import type { PlanPosition } from '../../PlannerDocument';
import { L_EPS } from '../predicates/pointsMatch';

/**
 * Единичная нормаль к грани `a → b` (левая при y вверх). Вырожденная грань (`|ab| < L_EPS`) — `null`:
 * направления нет, двигать «по нормали» нечего.
 */
export const faceNormal = (a: PlanPosition, b: PlanPosition): PlanPosition | null => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!(length >= L_EPS)) return null;
  return { x: -dy / length, y: dx / length };
};

/**
 * Проекция смещения на нормаль грани (спека 01 «Перетаскивание стены»: стена двигается строго перпендикулярно
 * себе — смещение курсора проецируется на её нормаль). Возвращает знаковую длину сдвига вдоль `normal`.
 */
export const shiftAlongNormal = (normal: PlanPosition, delta: PlanPosition): number =>
  delta.x * normal.x + delta.y * normal.y;

/** Точка, сдвинутая на `shift` вдоль `normal`. */
export const shiftPoint = (point: PlanPosition, normal: PlanPosition, shift: number): PlanPosition => ({
  x: point.x + normal.x * shift,
  y: point.y + normal.y * shift,
});
