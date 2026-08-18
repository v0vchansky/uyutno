import type { PlanPosition } from '../../PlannerDocument';
import { contourSelfIntersected } from '../predicates/contourSelfIntersected';
import { contourValid } from '../predicates/contourArea';
import { euclDist } from '../predicates/distance';
import { pointsMatch } from '../predicates/pointsMatch';

/** Минимальная длина одной стены/ребра контура, см (спека 01 «Ограничения и пороги», ADR 0017 C3). */
export const MIN_WALL_LENGTH = 15;
/** Минимум точек замкнутого контура стен — треугольник. */
export const MIN_CONTOUR_POINTS = 3;
/** Минимум точек «Комнаты по точкам» (спека 01 «Меньше 4 точек в Polyline Room»). */
export const POLYLINE_ROOM_MIN_POINTS = 4;

/**
 * Причина отказа на завершении рисования (спека 01 «Крайние случаи»; отказ молчаливый — решение E):
 * `tooFewPoints` — меньше `minPoints`; `duplicatePoints` — две точки в одном месте (L_EPS); `shortEdge` —
 * ребро короче `minEdgeLength`; `selfIntersected` — трансверсальное самопересечение; `degenerate` —
 * замкнутый контур не проходит `contourValid` (площадь/сливер).
 */
export type ContourRejectReason = 'tooFewPoints' | 'duplicatePoints' | 'shortEdge' | 'selfIntersected' | 'degenerate';

/** Исход валидации без исключений: `ok` или первая (по порядку проверок) причина отказа. */
export type ContourValidation = { ok: true } | { ok: false; reason: ContourRejectReason };

export interface ValidateContourOptions {
  /** `true` (дефолт) — замкнутая петля: есть замыкающее ребро, проверяется площадь; `false` — открытая полилиния. */
  closed?: boolean;
  /** Минимум точек; дефолт `MIN_CONTOUR_POINTS`, для «Комнаты по точкам» — `POLYLINE_ROOM_MIN_POINTS`. */
  minPoints?: number;
  /** Минимальная длина ребра, см; дефолт `MIN_WALL_LENGTH`; `0` — не проверять. */
  minEdgeLength?: number;
}

/**
 * Валидация контура на завершении рисования (ADR 0017 C4/C10; спека 01 «Ограничения», «Крайние случаи»).
 * Порядок проверок: число точек → дубли → короткие рёбра → самопересечение → вырожденность (только
 * `closed`). Не мутирует и не чинит вход — дедуп делает вызывающий (`dedupeConsecutivePoints`) до вызова.
 */
export const validateContour = (
  points: readonly PlanPosition[],
  { closed = true, minPoints = MIN_CONTOUR_POINTS, minEdgeLength = MIN_WALL_LENGTH }: ValidateContourOptions = {},
): ContourValidation => {
  const n = points.length;
  if (n < minPoints) return { ok: false, reason: 'tooFewPoints' };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (pointsMatch(points[i]!, points[j]!)) return { ok: false, reason: 'duplicatePoints' };
    }
  }
  const edges = closed ? n : n - 1;
  for (let i = 0; i < edges; i++) {
    if (euclDist(points[i]!, points[(i + 1) % n]!) < minEdgeLength) return { ok: false, reason: 'shortEdge' };
  }
  if (contourSelfIntersected(points, closed)) return { ok: false, reason: 'selfIntersected' };
  if (closed && !contourValid(points)) return { ok: false, reason: 'degenerate' };
  return { ok: true };
};
