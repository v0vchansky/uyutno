import type { PlanPosition } from '../../PlannerDocument';

/**
 * Точка на расстоянии `radius` от `a` под углом `phi` (радианы, против часовой при y вверх) к направлению
 * `a→b`. Направление — `atan2(dy, dx)` (эквивалент `atan(k)` референса с поправкой `+π` при `b.x < a.x`,
 * без деления на ноль на вертикали); при `a == b` направление считается `+X` (`atan2(0, 0) = 0`).
 */
export const pointAtAngle = (a: PlanPosition, b: PlanPosition, phi: number, radius: number): PlanPosition => {
  const angle = Math.atan2(b.y - a.y, b.x - a.x) + phi;
  return { x: a.x + radius * Math.cos(angle), y: a.y + radius * Math.sin(angle) };
};

/** Поворот вектора/точки вокруг начала координат на `angle` радиан против часовой при y вверх. */
export const rotateXY = (point: PlanPosition, angle: number): PlanPosition => {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
};
