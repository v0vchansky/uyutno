import type { PlanPosition } from '../../PlannerDocument';
import { angleBetweenLines } from '../predicates/angleBetweenLines';
import { dedupeConsecutivePoints } from '../predicates/dedupeConsecutivePoints';
import { euclDist } from '../predicates/distance';
import { lineIntersectLine } from '../predicates/lineIntersectLine';
import { offsetSegment, type OffsetSide } from '../predicates/offsetPoint';
import { pointInBounds } from '../predicates/pointInBounds';
import { pointOnSegment } from '../predicates/pointOnSegment';

/** Толщина ленты по умолчанию, см (спека 01 «Ограничения и пороги», ADR 0017 C3): инструменты «Стены»/«Прямоугольник» передают её как `width` (в v0 не меняется). */
export const DEFAULT_WALL_WIDTH = 10;

/**
 * Порог «митра → плоский торец», рад (0.75π = 135° отклонения от прямого хода; спека 01 «Митра углов»,
 * ADR 0017 C5): угол в вершине `ang ∈ (RE_MITER_ANGLE, 2π − RE_MITER_ANGLE)` — поворот резче 135°.
 */
export const RE_MITER_ANGLE = Math.PI * 0.75;

/**
 * Квад ленты одного сегмента `[A, C, D, B]`: `A` — начало грани офсета, `C` — конец грани офсета,
 * `D` — конец сегмента на нарисованной линии, `B` — начало сегмента на нарисованной линии.
 * Соседние квады делят `A = C`, `B = D` предыдущего (митрованное ребро) — кроме плоского торца.
 */
export type WallBlock = readonly [PlanPosition, PlanPosition, PlanPosition, PlanPosition];

/** Соседи стартовой точки на существующей стене (T-стык): концы двух лучей из `points[0]` (снап — 0062). */
export type StartNeighbourSegments = readonly [PlanPosition, PlanPosition];

/** Поворот резче порога — митра отменяется (в открытой полилинии — только вместе со спайком вне bbox). */
const isSharpTurn = (angle: number): boolean => angle > RE_MITER_ANGLE && angle < 2 * Math.PI - RE_MITER_ANGLE;

/**
 * «Тук-ин» T-стыка (спека 01 «Начало стены на существующей стене»): грань офсета первого сегмента
 * пересекается с обоими соседними лучами `start→N`; берутся только пересечения, лежащие на луче-отрезке;
 * из двух — ближайшее к концу грани (`offsetEnd`) — менее глубокий надрез. Нет пересечений → `null` (butt).
 */
const tuckIntoNeighbours = (
  offsetStart: PlanPosition,
  offsetEnd: PlanPosition,
  start: PlanPosition,
  neighbours: StartNeighbourSegments,
): PlanPosition | null => {
  const hits = neighbours.map(neighbour => {
    const hit = lineIntersectLine(offsetStart, offsetEnd, start, neighbour, { asSegment: false });
    return hit && pointOnSegment(hit, start, neighbour) ? hit : null;
  });
  const [first, second] = hits;
  if (first && second) return euclDist(first, offsetEnd) > euclDist(second, offsetEnd) ? second : first;
  return first ?? second ?? null;
};

/** Грани офсета соседних сегментов в вершине `p1`: `[L0, L01]` для `p0→p1`, `[L12, L2]` для `p1→p2`. */
const offsetsAround = (
  p0: PlanPosition,
  p1: PlanPosition,
  p2: PlanPosition,
  width: number,
  side: OffsetSide,
): { l0: PlanPosition; l01: PlanPosition; l12: PlanPosition; l2: PlanPosition } => {
  // Нулевых сегментов нет (дедуп на входе), поэтому офсет всегда определён.
  const [l0, l01] = offsetSegment(p0, p1, width, side)!;
  const [l12, l2] = offsetSegment(p1, p2, width, side)!;
  return { l0, l01, l12, l2 };
};

const copy = (point: PlanPosition): PlanPosition => ({ x: point.x, y: point.y });

const block = (a: PlanPosition, c: PlanPosition, d: PlanPosition, b: PlanPosition): WallBlock => [
  copy(a),
  copy(c),
  copy(d),
  copy(b),
];

const openBlocks = (
  input: readonly PlanPosition[],
  width: number,
  side: OffsetSide,
  startNeighbourSegments?: StartNeighbourSegments,
): WallBlock[] => {
  const points =
    input.length > 2 && euclDist(input[input.length - 1]!, input[input.length - 2]!) < width
      ? input.slice(0, -1)
      : input;
  const n = points.length;
  const [firstOffsetStart, firstOffsetEnd] = offsetSegment(points[0]!, points[1]!, width, side)!;
  const tuck = startNeighbourSegments
    ? tuckIntoNeighbours(firstOffsetStart, firstOffsetEnd, points[0]!, startNeighbourSegments)
    : null;

  const result: WallBlock[] = [];
  let a = tuck ?? firstOffsetStart;
  let b = points[0]!;
  for (let i = 1; i < n - 1; i++) {
    const p0 = points[i - 1]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const { l0, l01, l12, l2 } = offsetsAround(p0, p1, p2, width, side);
    let c = lineIntersectLine(l0, l01, l12, l2, { asSegment: false }) ?? l01;
    const d = p1;
    const angle = angleBetweenLines(p0, p1, p1, p2);
    if (isSharpTurn(angle) && !pointInBounds(c, d, l2)) {
      c = l01;
      result.push(block(a, c, d, b));
      a = l12;
      b = p1;
    } else {
      result.push(block(a, c, d, b));
      a = c;
      b = d;
    }
  }
  const [, lastOffsetEnd] = offsetSegment(points[n - 2]!, points[n - 1]!, width, side)!;
  result.push(block(a, lastOffsetEnd, points[n - 1]!, b));
  return result;
};

const closedBlocks = (points: readonly PlanPosition[], width: number, side: OffsetSide): WallBlock[] => {
  const n = points.length;
  if (n < 3) return [];
  const result: WallBlock[] = [];
  let a: PlanPosition | null = null;
  let b: PlanPosition | null = null;
  // Обход вершин 1..n, затем снова 1: первая посещённая только задаёт `A/B`, последняя замыкает ленту.
  for (let k = 1; k <= n + 1; k++) {
    const p0 = points[(k - 1) % n]!;
    const p1 = points[k % n]!;
    const p2 = points[(k + 1) % n]!;
    const { l0, l01, l12, l2 } = offsetsAround(p0, p1, p2, width, side);
    let c = lineIntersectLine(l0, l01, l12, l2, { asSegment: false }) ?? l01;
    const d = p1;
    const angle = angleBetweenLines(p0, p1, p1, p2);
    if (isSharpTurn(angle)) {
      c = l01;
      if (a && b) result.push(block(a, c, d, b));
      a = l12;
      b = p1;
    } else {
      if (a && b) result.push(block(a, c, d, b));
      a = c;
      b = d;
    }
  }
  return result;
};

/**
 * Лента стены — per-segment квады с митрингом (ADR 0017 C5, спека 01 «Митра углов», «Крайние случаи»).
 * Односторонняя: одна грань — сама нарисованная линия, офсет откладывается на `width` в сторону `side`
 * от направления обхода. Митра — пересечение соседних граней офсета как прямых; параллельные/вырожденные
 * соседи → плоский торец (`null`-guard). Отказ от митры (плоские перпендикулярные торцы, не bevel):
 * открытая полилиния — поворот резче `RE_MITER_ANGLE` **и** апекс `C` вне bbox `[P1, L2]`; замкнутая —
 * только по углу (Q32). Гарды: ≤ 1 точки → `[]`; две точки ближе `width` → `[]`; последний сегмент открытой
 * короче `width` — отбрасывается; `closed` с < 3 различных точек → `[]`; `width` не положительная или
 * не-конечная координата во входе → `[]` (валидация — обязанность команды, ядро не роняется).
 * Подряд идущие совпадающие точки (L_EPS) схлопываются заранее — нулевых сегментов внутри нет.
 * Концы открытой — butt-капы; старт может «врезаться» в существующую стену (`startNeighbourSegments`;
 * при `closed` игнорируется — у петли старта нет).
 * Замкнутость — явный признак, обход по модулю длины; выходные точки — новые plain-объекты.
 */
export const blocksFromContour = (
  input: readonly PlanPosition[],
  width: number,
  side: OffsetSide,
  closed: boolean,
  startNeighbourSegments?: StartNeighbourSegments,
): WallBlock[] => {
  if (!(width > 0)) return [];
  if (!input.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) return [];
  const points = dedupeConsecutivePoints(input, closed);
  if (points.length <= 1) return [];
  if (points.length === 2 && euclDist(points[0]!, points[1]!) < width) return [];
  return closed ? closedBlocks(points, width, side) : openBlocks(points, width, side, startNeighbourSegments);
};
