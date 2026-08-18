import type { PlanPosition } from '../../PlannerDocument';
import { checkContact } from './checkContact';
import { findMinMax } from './findMinMax';
import { lineIntersectLine } from './lineIntersectLine';
import { locatePointInContour, pointInContour } from './pointInContour';
import { L_EPS } from './pointsMatch';

/**
 * Восемь исходов классификации пары контуров (ADR 0017 C4, keep 1:1 — downstream опирается на все восемь,
 * не сводить к булевой алгебре): `belong` — A внутри B, `contain` — B внутри A, `contact*` — то же плюс
 * общий кусок границы, `contact` — снаружи с общей границей, `coincide` — все вершины и середины рёбер
 * каждого лежат на границе другого.
 */
export type ContourRelation =
  'belong' | 'contain' | 'outside' | 'contact' | 'contactBelong' | 'contactContain' | 'intersect' | 'coincide';

/** bbox контуров разнесены со слаком `L_EPS` — заведомо `outside`. */
const boundsOutside = (a: readonly PlanPosition[], b: readonly PlanPosition[]): boolean => {
  const boundsA = findMinMax(a);
  const boundsB = findMinMax(b);
  if (!boundsA || !boundsB) return true;
  return (
    boundsA.maxX < boundsB.minX - L_EPS ||
    boundsA.minX > boundsB.maxX + L_EPS ||
    boundsA.maxY < boundsB.minY - L_EPS ||
    boundsA.minY > boundsB.maxY + L_EPS
  );
};

/** Вершины и середины рёбер `subject` против `other`: есть ли точки строго внутри / строго снаружи. */
const classifyAgainst = (
  subject: readonly PlanPosition[],
  other: readonly PlanPosition[],
): { inside: boolean; outside: boolean } => {
  const flags = { inside: false, outside: false };
  const n = subject.length;
  const account = (point: PlanPosition) => {
    const location = locatePointInContour(point, other);
    if (location === 'inside') flags.inside = true;
    else if (location === 'outside') flags.outside = true;
  };
  for (let i = 0; i < n; i++) {
    const a = subject[i]!;
    const b = subject[(i + 1) % n]!;
    account(a);
    if (flags.inside && flags.outside) return flags;
    account({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    if (flags.inside && flags.outside) return flags;
  }
  return flags;
};

/**
 * Классификация пары контуров (незамкнутые массивы вершин): bbox-предфильтр → внутренние рёберные
 * пересечения (`lineIntersectLine`, `vertices: false`) → вершины и середины рёбер A против B (граница —
 * B_EPS, in/out — ray casting) → `checkContact` один раз → симметрично B против A → порядок веток
 * `intersect → belong → contain → outside/contact → coincide → intersect`. Пустой контур — `outside`.
 */
export const compareContours = (a: readonly PlanPosition[], b: readonly PlanPosition[]): ContourRelation => {
  if (boundsOutside(a, b)) return 'outside';

  const n = a.length;
  const m = b.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (lineIntersectLine(a[i]!, a[(i + 1) % n]!, b[j]!, b[(j + 1) % m]!, { vertices: false })) {
        return 'intersect';
      }
    }
  }

  const aInB = classifyAgainst(a, b);
  if (aInB.inside && aInB.outside) return 'intersect';
  const contact = checkContact(a, b);
  if (aInB.inside) return contact ? 'contactBelong' : 'belong';

  const bInA = classifyAgainst(b, a);
  if (bInA.inside && bInA.outside) return 'intersect';
  if (bInA.inside) return contact ? 'contactContain' : 'contain';

  if (aInB.outside && bInA.outside) return contact ? 'contact' : 'outside';
  if (!aInB.outside && !bInA.outside) return 'coincide';
  return 'intersect';
};

/** Дешёвая классификация по первой свободной вершине; `coincide` вместо `undefined` референса. */
export type OnePointRelation = 'belong' | 'contain' | 'outside' | 'coincide';

/**
 * Аппроксимация без рёберных пересечений (ADR 0017 C4, rework: полный union): первая вершина A не на границе
 * B — внутри → `belong`, снаружи → переход к B; первая вершина B не на границе A — внутри → `contain`,
 * снаружи → `outside`; все вершины на границах друг друга → `coincide`. Корректна только когда рёбра
 * заведомо не пересекаются (дырки после триангуляции, вложенность зон).
 */
export const compareContoursOnePoint = (a: readonly PlanPosition[], b: readonly PlanPosition[]): OnePointRelation => {
  for (const point of a) {
    const location = locatePointInContour(point, b);
    if (location === 'boundary') continue;
    if (location === 'inside') return 'belong';
    break;
  }
  for (const point of b) {
    const location = locatePointInContour(point, a);
    if (location === 'boundary') continue;
    return location === 'inside' ? 'contain' : 'outside';
  }
  return 'coincide';
};

/** Шаг сетки best-effort теста площади: `REATTACH_GRID × REATTACH_GRID` узлов по bbox первого контура (ADR 0017 C7). */
export const REATTACH_GRID = 10;

export type AreaRelation = 'intersect' | 'outside';

/**
 * Вероятностный тест перекрытия по площади (ADR 0017 C4/C7): сетка `REATTACH_GRID²` по bbox контура A
 * (узлы `min + size · i / grid`, `i = 0..grid−1` — правая/верхняя кромки не семплируются); хоть один узел
 * строго внутри обоих → `intersect`. Пропускает перекрытия мельче ячейки — только для пере-привязки
 * атрибутов комнат, где ошибка не фатальна. Пустой A → `outside`.
 */
export const compareContoursByArea = (a: readonly PlanPosition[], b: readonly PlanPosition[]): AreaRelation => {
  const bounds = findMinMax(a);
  if (!bounds) return 'outside';
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  for (let i = 0; i < REATTACH_GRID; i++) {
    for (let j = 0; j < REATTACH_GRID; j++) {
      const point = { x: bounds.minX + (width * i) / REATTACH_GRID, y: bounds.minY + (height * j) / REATTACH_GRID };
      if (pointInContour(point, a) && pointInContour(point, b)) return 'intersect';
    }
  }
  return 'outside';
};
