import type { Id } from '../../id';
import type { PlanPosition } from '../../PlannerDocument';
import type { Bounds } from '../predicates/findMinMax';
import { boundsContain } from '../viewport';

/**
 * Кандидат снапа — плоская запись без ссылок на документ (ADR 0019 E2): координаты вершины и её id
 * (`exceptIds`, источник гайда, `hit`), плюс соседи по кольцу контура — только для биссектрисы
 * (`bisectorSnap`); у вершины без кольца (осиротевшая точка, конец открытой полилинии) их нет.
 * Пул собирает индекс `engine/` (все `layout.points` этажа) + `draftCandidates` рисуемого контура.
 */
export interface SnapCandidate extends PlanPosition {
  id: Id;
  prev?: PlanPosition;
  next?: PlanPosition;
}

/** Отрезок плана — ребро контура для `findNearSegments` и подавления гайдов «точка на стене». */
export interface Segment {
  a: PlanPosition;
  b: PlanPosition;
}

/** Пара выравнивателей одной оси по полуплоскостям вторичной оси: `[M, P]` — «минус» (меньше) и «плюс» (не меньше). */
export type AlignerPair = readonly [SnapCandidate | null, SnapCandidate | null];

export const NO_ALIGNERS: AlignerPair = Object.freeze([null, null] as const);

/**
 * Куллинг по видимой области — всегда on и для всех веток снапа (спека 01 «Куллинг», rework dd09: у референса
 * при `farPoints === undefined` куллинг молча выключался, а угловой снап не куллился вовсе). Кандидат с `NaN`
 * границу не проходит.
 */
export const cullCandidates = (candidates: readonly SnapCandidate[], bounds: Bounds): readonly SnapCandidate[] =>
  candidates.filter(candidate => boundsContain(bounds, candidate));

/** Префикс синтетических id точек рисуемого контура: в документе их ещё нет, id нужен для `exceptIds`/гайдов. */
export const DRAFT_ID_PREFIX = 'draft:';

/**
 * Кандидаты из зафиксированных точек рисуемого контура (пул референса включал `rawCont.points`, аудит dd09 keep):
 * id — `draft:<index>`, соседи по полилинии — для биссектрисы во внутренних вершинах; концы открытой полилинии
 * соседей не получают (референс замыкал кольцо через живой курсор — биссектриса «угла» с самим курсором
 * смысла не имеет).
 */
export const draftCandidates = (points: readonly PlanPosition[]): SnapCandidate[] =>
  points.map((point, index) => {
    const candidate: SnapCandidate = { id: `${DRAFT_ID_PREFIX}${index}`, x: point.x, y: point.y };
    const neighbours = ringNeighbours(points, index, false);
    if (neighbours) {
      candidate.prev = neighbours.prev;
      candidate.next = neighbours.next;
    }
    return candidate;
  });

/**
 * Соседи вершины `index` в кольце (`closed`) или полилинии: кольцо — от трёх вершин, у полилинии концы без соседей.
 * `null` — соседей нет.
 */
export const ringNeighbours = (
  points: readonly PlanPosition[],
  index: number,
  closed: boolean,
): { prev: PlanPosition; next: PlanPosition } | null => {
  const count = points.length;
  if (closed) {
    if (count < 3) return null;
    return { prev: points[(index - 1 + count) % count]!, next: points[(index + 1) % count]! };
  }
  const prev = points[index - 1];
  const next = points[index + 1];
  return prev && next ? { prev, next } : null;
};

/**
 * Рёбра кольца (замкнутого контура) как отрезки; менее двух вершин — рёбер нет, две — одно ребро (референс давал
 * два встречных `(p0,p1)`, `(p1,p0)` — для `findNearSegments` это ответ `[p1, p1]`; контур короче трёх вершин в
 * документе не живёт, различие осознанное).
 */
export const ringSegments = (points: readonly PlanPosition[]): Segment[] => {
  if (points.length < 2) return [];
  if (points.length === 2) return [{ a: points[0]!, b: points[1]! }];
  return points.map((a, index) => ({ a, b: points[(index + 1) % points.length]! }));
};
