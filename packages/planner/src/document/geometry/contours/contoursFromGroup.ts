import type { PlanPosition } from '../../PlannerDocument';
import { angleBetweenLines } from '../predicates/angleBetweenLines';
import type { Triangulation } from '../triangulate/triangulateContours';

/** Смещение виртуальной «предыдущей точки» слева от стартовой вершины обхода, см (референс: `x − 10`). */
const VIRTUAL_PREV_OFFSET = 10;

export interface GroupContours {
  /** Внешний обвод группы по индексам вершин триангуляции; `null` — обход не удался (soft-fail). */
  outline: number[] | null;
  /** Дырки — замкнутые петли, оставшиеся в графе после снятия обвода и dead-end вершин. */
  holes: number[][];
  /** Хоть один обход оборвался (runaway walk / вершина без продолжения) — движок логирует, результат частичный. */
  softFail: boolean;
}

/**
 * Обвод группы треугольников по её fixed-рёбрам (ADR 0017 C6, `contoursFromGroup` референса — «crown jewel»
 * dd03): граф соседства вершин из fixed-рёбер треугольников группы → первый контур — обвод: старт с вершины
 * min-X (при равенстве — min-Y, канонично), виртуальная предыдущая точка `[x − 10, y]`, на каждом шаге —
 * сосед с **максимальным** углом `angleBetweenLines(prev→curr, neighbour→curr)` (самый левый поворот, область
 * справа); дырки — после `clearDict` (снять вершины обвода, итеративно вырезать вершины степени ≤ 1)
 * повторные обходы с **минимальным** углом на первом шаге (обратная обмотка), пока граф не пуст.
 * Guard runaway walk: длина обхода больше числа вершин графа или вершина без продолжения → обход `null`,
 * `softFail = true`. Ориентация выхода здесь не нормализуется — это делает `rebuildContours` по знаку площади.
 *
 * `ignored` — индексы fixed-рёбер, которые границей не являются и в граф не попадают (интерьерные cut-рёбра
 * зон, `areas/cutEdges`): они fixed для триангуляции, но внутри группы это хорда, а хорда сбила бы выбор
 * соседа по экстремальному углу и осталась бы «дыркой» после `clearDict`. **В отличие от референса:** он
 * хорды не исключает — cut-пары попадают в тот же массив ограничений без пометки, и он полагается на то,
 * что хорда ограничивает группу, подчищая висяки в `clearDict`. У нас группы, разделённые только cut-ребром,
 * склеиваются обратно (ADR 0017 C6), поэтому хорда внутри группы реальна и её надо снимать явно.
 */
export const contoursFromGroup = (
  { vertices, edges, triangleEdges }: Pick<Triangulation, 'vertices' | 'edges' | 'triangleEdges'>,
  group: readonly number[],
  ignored?: ReadonlySet<number>,
): GroupContours => {
  const adjacency = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    let list = adjacency.get(a);
    if (!list) {
      list = [];
      adjacency.set(a, list);
    }
    if (!list.includes(b)) list.push(b);
  };
  for (const t of group) {
    for (const e of triangleEdges[t]!) {
      const edge = edges[e]!;
      if (!edge.fixed || ignored?.has(e)) continue;
      link(edge.a, edge.b);
      link(edge.b, edge.a);
    }
  }

  const outline = walkContour(vertices, adjacency, false);
  const holes: number[][] = [];
  let softFail = outline === null;
  if (outline) {
    clearDict(adjacency, outline);
    while (adjacency.size > 0) {
      const hole = walkContour(vertices, adjacency, true);
      if (!hole) {
        softFail = true;
        break;
      }
      holes.push(hole);
      clearDict(adjacency, hole);
    }
  }
  return { outline, holes, softFail };
};

/** Снятие использованных вершин и итеративное вырезание dead-end вершин (степень ≤ 1) до стабилизации. */
const clearDict = (adjacency: Map<number, number[]>, used: readonly number[]): void => {
  for (const index of used) adjacency.delete(index);
  let removed = true;
  while (removed) {
    removed = false;
    for (const [index, neighbours] of adjacency) {
      const alive = neighbours.filter(n => adjacency.has(n));
      if (alive.length !== neighbours.length) {
        adjacency.set(index, alive);
        removed = true;
      }
      if (alive.length <= 1) {
        adjacency.delete(index);
        removed = true;
      }
    }
  }
};

/** Один обход: `inner` — обратная обмотка на первом шаге (дырка). `null` — soft-fail. */
const walkContour = (
  vertices: readonly PlanPosition[],
  adjacency: Map<number, number[]>,
  inner: boolean,
): number[] | null => {
  let start = -1;
  for (const index of adjacency.keys()) {
    if (start === -1) {
      start = index;
      continue;
    }
    const p = vertices[index]!;
    const s = vertices[start]!;
    if (p.x < s.x || (p.x === s.x && p.y < s.y)) start = index;
  }
  if (start === -1) return null;

  const limit = adjacency.size;
  const result: number[] = [];
  let current = start;
  let previous = -1;
  do {
    if (result.length > limit) return null;
    const clockwise = !(inner && result.length === 0);
    result.push(current);
    const next = nextVertex(vertices, adjacency, current, previous, clockwise);
    if (next === -1) return null;
    previous = current;
    current = next;
  } while (current !== start);
  return result;
};

/** Сосед с экстремальным углом поворота; `-1` — у вершины нет продолжения. */
const nextVertex = (
  vertices: readonly PlanPosition[],
  adjacency: Map<number, number[]>,
  current: number,
  previous: number,
  clockwise: boolean,
): number => {
  const target = vertices[current]!;
  const prev = previous === -1 ? { x: target.x - VIRTUAL_PREV_OFFSET, y: target.y } : vertices[previous]!;
  const neighbours = adjacency.get(current);
  if (!neighbours || neighbours.length <= 1) return -1;

  let maxAngle = 0;
  let minAngle = Number.MAX_VALUE;
  let maxIndex = -1;
  let minIndex = -1;
  for (const neighbour of neighbours) {
    const angle = angleBetweenLines(prev, target, vertices[neighbour]!, target);
    if (angle > maxAngle) {
      maxAngle = angle;
      maxIndex = neighbour;
    }
    if (angle < minAngle) {
      minAngle = angle;
      minIndex = neighbour;
    }
  }
  if (maxIndex === -1 || minIndex === -1) return -1;
  return clockwise ? maxIndex : minIndex;
};
