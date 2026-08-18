import type { PlanPosition } from '../../PlannerDocument';
import { euclDist } from './distance';
import { L_EPS } from './pointsMatch';

/**
 * Точка на биссектрисе угла `AOB` — середина между единичными ортами `O→A` и `O→B` (на расстоянии ≤ 1 от `O`).
 * `null`, если орты противоположны (середина ближе `L_EPS` к `O`, угол развёрнутый) или один из лучей
 * вырожден (`A` или `B` совпадает с `O` ближе `L_EPS` — направление не определено).
 */
export const bisectorPoint = (o: PlanPosition, a: PlanPosition, b: PlanPosition): PlanPosition | null => {
  const oa = euclDist(o, a);
  const ob = euclDist(o, b);
  if (!(oa >= L_EPS) || !(ob >= L_EPS)) return null;
  const c = {
    x: o.x + ((a.x - o.x) / oa + (b.x - o.x) / ob) / 2,
    y: o.y + ((a.y - o.y) / oa + (b.y - o.y) / ob) / 2,
  };
  if (euclDist(o, c) < L_EPS) return null;
  return c;
};
