import type { PlanPosition } from '../../PlannerDocument';

const TWO_PI = 2 * Math.PI;

/**
 * Ориентированный угол между направлениями `a→b` и `c→d` в диапазоне `[0, 2π)` (ADR 0017 C4, keep 1:1):
 * `atan2(dx, dy)` — угол каждого направления меряется от оси `+Y` в сторону `+X`, разность — поворот
 * **от `c→d` к `a→b`** по часовой стрелке при y вверх. `0` — сонаправлены, `π` — противонаправлены,
 * `angle(ab, cd) = 2π − angle(cd, ab)` (кроме 0). Нулевой вектор (`a == b`) считается направлением `+Y`.
 * Не заменять на `acos` ([0, π] без ориентации): на полном диапазоне держатся митринг, трассировка контуров
 * (min/max сосед), `parallelLines`, `rightOriented`, снап.
 */
export const angleBetweenLines = (a: PlanPosition, b: PlanPosition, c: PlanPosition, d: PlanPosition): number => {
  const angleAb = Math.atan2(b.x - a.x, b.y - a.y);
  const angleCd = Math.atan2(d.x - c.x, d.y - c.y);
  let angle = angleAb - angleCd;
  if (angle < 0) angle += TWO_PI;
  if (angle >= TWO_PI) angle -= TWO_PI;
  return angle;
};

/** Допуск параллельности граней, рад (~2.86°): спаривание граней в оси (ADR 0017 C3/C8). */
export const PARALLEL_EPS = 0.05;

/**
 * Прямые почти параллельны: угол между направлениями в пределах `maxAngle` от `0`, `π` или `2π`
 * (сонаправленность и противонаправленность равнозначны). `NaN` во входе → `false`.
 */
export const parallelLines = (
  a: PlanPosition,
  b: PlanPosition,
  c: PlanPosition,
  d: PlanPosition,
  maxAngle: number = PARALLEL_EPS,
): boolean => {
  const angle = angleBetweenLines(a, b, c, d);
  if (Number.isNaN(angle)) return false;
  const awayFromZero = angle > maxAngle && angle < Math.PI - maxAngle;
  const awayFromPi = angle > Math.PI + maxAngle && angle < TWO_PI - maxAngle;
  return !(awayFromZero || awayFromPi);
};
