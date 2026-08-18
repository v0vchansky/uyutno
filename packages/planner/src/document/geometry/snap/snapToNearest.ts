import type { Id } from '../../id';
import type { PlanPosition } from '../../PlannerDocument';
import { manhDist } from '../predicates/distance';
import type { SnapCandidate } from './candidates';

/**
 * Ближайший по **манхэттену** кандидат в радиусе `maxDist` включительно (`≤`, как `findNearest`/`snapToNearest`
 * референса); метрика точечного снапа и хит-теста точки — манхэттен (спека 01 «Пороги», Q34). При равных
 * дистанциях побеждает первый по порядку (строгое `<`). Пустой список, `NaN` в точке или `maxDist` → `null`.
 */
export const findNearest = <T extends PlanPosition>(
  point: PlanPosition,
  candidates: readonly T[],
  maxDist: number,
): T | null => {
  let nearest: T | null = null;
  let minDist = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = manhDist(point, candidate);
    if (distance < minDist) {
      nearest = candidate;
      minDist = distance;
    }
  }
  return minDist <= maxDist ? nearest : null;
};

/**
 * Угловой снап: ближайший по манхэттену кандидат в `snapDist` (включительно) среди тех, чей `id` не в
 * `exceptIds` (перетаскиваемая точка — один id покрывает совладельцев, ADR 0019 E2). Куллинг по вьюпорту —
 * обязанность вызывающего (`cullCandidates` в `getSnapPoint`): здесь всегда весь переданный список.
 */
export const snapToNearest = (
  point: PlanPosition,
  candidates: readonly SnapCandidate[],
  snapDist: number,
  exceptIds: ReadonlySet<Id>,
): SnapCandidate | null =>
  findNearest(
    point,
    exceptIds.size === 0 ? candidates : candidates.filter(candidate => !exceptIds.has(candidate.id)),
    snapDist,
  );
