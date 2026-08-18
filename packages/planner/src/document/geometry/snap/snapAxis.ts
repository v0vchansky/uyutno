import type { Id } from '../../id';
import type { PlanPosition } from '../../PlannerDocument';
import { manhDist } from '../predicates/distance';
import { B_EPS } from '../predicates/pointOnSegment';
import { L_EPS } from '../predicates/pointsMatch';
import { NO_ALIGNERS, type AlignerPair, type SnapCandidate } from './candidates';

/** Ось выравнивания: `'x'` — вертикаль `x = Q.x` (подменяет `x`), `'y'` — горизонталь `y = Q.y` (подменяет `y`). */
export type Axis = 'x' | 'y';

const other = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x');

/**
 * Выравниватели по одной оси — по два кандидата на ось (формулы 1:1 с `snapX`/`snapY` референса, аудит dd09 keep):
 * пул делится по полуплоскостям вторичной оси относительно курсора — `M` («минус»: `Q.y < P.y` для оси `x`),
 * `P` («плюс»: `Q.y ≥ P.y`); в каждой первичный ключ — расстояние до оси `|P.x − Q.x|`, вторичный — вдоль оси
 * `|P.y − Q.y|`, оба с допуском `L_EPS` (равные по оси — побеждает ближайшая вдоль); затем отсечка по оси
 * `> snapDist` и взаимное отсечение сторон с допуском `B_EPS` — выживает строго лучшая, либо **обе**, если
 * их оси совпадают в `±B_EPS` (две вершины на одной вертикали — гайд в обе стороны). Расстояния — по одной
 * координате, не манхэттен (спека 01 «Пороги»). `exceptIds` и кандидаты с `NaN` пропускаются; куллинг — у вызывающего.
 */
export const snapAxis = (
  axis: Axis,
  point: PlanPosition,
  candidates: readonly SnapCandidate[],
  snapDist: number,
  exceptIds: ReadonlySet<Id>,
): AlignerPair => {
  const secondary = other(axis);
  let minDistM = Number.POSITIVE_INFINITY;
  let minDistP = Number.POSITIVE_INFINITY;
  let minSideDistM = Number.POSITIVE_INFINITY;
  let minSideDistP = Number.POSITIVE_INFINITY;
  let alignerM: SnapCandidate | null = null;
  let alignerP: SnapCandidate | null = null;

  for (const candidate of candidates) {
    if (exceptIds.has(candidate.id)) continue;
    const dist = Math.abs(point[axis] - candidate[axis]);
    const sideDist = Math.abs(point[secondary] - candidate[secondary]);
    // `NaN` во вторичной координате: сравнение полуплоскостей ложно, и без гарда такой кандидат прошёл бы в `P`
    // (первичный ключ сравнивается с `∞`); по первичной оси `NaN` отсекается самими сравнениями ниже.
    if (Number.isNaN(sideDist)) continue;
    if (candidate[secondary] < point[secondary]) {
      if (dist < minDistM - L_EPS || (dist < minDistM + L_EPS && sideDist < minSideDistM - L_EPS)) {
        alignerM = candidate;
        minDistM = dist;
        minSideDistM = sideDist;
      }
    } else if (dist < minDistP - L_EPS || (dist < minDistP + L_EPS && sideDist < minSideDistP - L_EPS)) {
      alignerP = candidate;
      minDistP = dist;
      minSideDistP = sideDist;
    }
  }

  if (minDistM > snapDist) alignerM = null;
  if (minDistP > snapDist) alignerP = null;
  if (minDistM > minDistP + B_EPS) alignerM = null;
  if (minDistP > minDistM + B_EPS) alignerP = null;
  return alignerM || alignerP ? [alignerM, alignerP] : NO_ALIGNERS;
};

/** Вертикали через кандидатов (`x = Q.x`); см. `snapAxis`. */
export const snapX = (
  point: PlanPosition,
  candidates: readonly SnapCandidate[],
  snapDist: number,
  exceptIds: ReadonlySet<Id>,
): AlignerPair => snapAxis('x', point, candidates, snapDist, exceptIds);

/** Горизонтали через кандидатов (`y = Q.y`); см. `snapAxis`. */
export const snapY = (
  point: PlanPosition,
  candidates: readonly SnapCandidate[],
  snapDist: number,
  exceptIds: ReadonlySet<Id>,
): AlignerPair => snapAxis('y', point, candidates, snapDist, exceptIds);

/** Представитель оси из пары: единственный выживший, из двух — ближний к курсору по манхэттену всей точки. */
export const pickAligner = (pair: AlignerPair, point: PlanPosition): SnapCandidate | null => {
  const [m, p] = pair;
  if (m && p) return manhDist(m, point) > manhDist(p, point) ? p : m;
  return m ?? p;
};

export interface PerpendicularSnap {
  /** Курсор с подменёнными по осям координатами (одной или обеими); `null` — ни одного выравнивателя. */
  point: PlanPosition | null;
  alignerX: SnapCandidate | null;
  alignerY: SnapCandidate | null;
  /** Сырые пары `[M, P]` — для расширенных гайдов к «проигравшим» кандидатам (`guidesFor`). */
  rawAlignersX: AlignerPair;
  rawAlignersY: AlignerPair;
}

/**
 * Свод осей в точку (1:1 с `snapPerpendicular` референса): по каждой оси `snapX`/`snapY`, представитель —
 * `pickAligner`; координаты курсора подменяются **поосно независимо** (`x` от `alignerX`, `y` от `alignerY`).
 */
export const snapPerpendicular = (
  point: PlanPosition,
  candidates: readonly SnapCandidate[],
  snapDist: number,
  exceptIds: ReadonlySet<Id>,
): PerpendicularSnap => {
  const rawAlignersX = snapX(point, candidates, snapDist, exceptIds);
  const rawAlignersY = snapY(point, candidates, snapDist, exceptIds);
  const alignerX = pickAligner(rawAlignersX, point);
  const alignerY = pickAligner(rawAlignersY, point);
  const snapped =
    alignerX || alignerY ? { x: alignerX ? alignerX.x : point.x, y: alignerY ? alignerY.y : point.y } : null;
  return { point: snapped, alignerX, alignerY, rawAlignersX, rawAlignersY };
};
