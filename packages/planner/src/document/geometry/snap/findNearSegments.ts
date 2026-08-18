import type { PlanPosition } from '../../PlannerDocument';
import type { StartNeighbourSegments } from '../band/blocksFromContour';
import { manhDist } from '../predicates/distance';
import { B_EPS, pointOnSegment } from '../predicates/pointOnSegment';
import type { Segment } from './candidates';

/**
 * Соседи точки на существующей стене (1:1 с `findNearSegments` референса, аудит dd09 keep) — для автовыбора
 * стороны ленты при старте от чужой стены (`autoOffsetSide`) и тук-ина T-стыка (`blocksFromContour`,
 * `startNeighbourSegments`). Сначала — вершина: у каждого ребра конец, совпавший с точкой по манхэттену `< B_EPS`,
 * даёт **другой** конец; ровно два таких — ответ (обычная вершина степени 2), иначе при любом совпадении —
 * `null` (степень ≠ 2: конец открытой полилинии, узел трёх и более стен — сторона неопределима). Без совпадений —
 * ребро, на котором точка лежит (`pointOnSegment`, `B_EPS`): ровно одно → его концы, иначе `null`. Порядок пары —
 * как в списке рёбер (тип — `StartNeighbourSegments` ленты, её вход).
 */
export const findNearSegments = (point: PlanPosition, segments: readonly Segment[]): StartNeighbourSegments | null => {
  const atVertex: PlanPosition[] = [];
  for (const { a, b } of segments) {
    if (manhDist(point, a) < B_EPS) atVertex.push(b);
    else if (manhDist(point, b) < B_EPS) atVertex.push(a);
  }
  if (atVertex.length === 2) return [atVertex[0]!, atVertex[1]!];
  if (atVertex.length !== 0) return null;

  const onEdge: PlanPosition[] = [];
  for (const { a, b } of segments) {
    if (pointOnSegment(point, a, b, B_EPS)) onEdge.push(a, b);
  }
  return onEdge.length === 2 ? [onEdge[0]!, onEdge[1]!] : null;
};
