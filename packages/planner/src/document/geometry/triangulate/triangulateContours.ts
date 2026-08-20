// Ambient-объявление `cdt2d` (свой `.d.ts` рядом, `@types/*` нет — ADR 0017 C2) подключается triple-slash, а не
// `import`: файл — не модуль, а `import` его не втянет; так объявление попадает в программу любого потребителя
// (платформа компилирует исходники планера напрямую), а не только в tsconfig пакета.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./cdt2d.d.ts" />
import cdt2d from 'cdt2d';

import type { PlanPosition } from '../../PlannerDocument';
import { quantize } from '../../quantize';
import { contourArea } from '../predicates/contourArea';
import { pointInContour, pointInContours } from '../predicates/pointInContour';
import { triangleCenter, triangleIsNarrow } from '../predicates/triangle';
import { cleanPslg, type PslgEdge, type PslgPoint } from './cleanPslg';
import { groupTriangles } from './groupTriangles';
import { resplitSegments } from './resplitSegments';

/** Набор контуров одной роли — незамкнутые массивы вершин (без дубля первой точки). */
export type ContourSet = readonly (readonly PlanPosition[])[];

export interface TriangulateContoursInput {
  /** Обводы тел стен (fill). */
  outer: ContourSet;
  /** Полости-комнаты: область, чей ближайший объемлющий контур — `inner`, не fill (см. `innermostKind`). */
  inner: ContourSet;
  /** Ограничивающие контуры (полы, 2b): fill только внутри них. */
  bound?: ContourSet;
  /** Вычитаемые контуры (полы, 2b): fill только вне их. */
  subtract?: ContourSet;
  /**
   * Отдельные fixed-рёбра (cut-пары зон, 2b): треугольники ложатся по границе зоны, и `groups` делятся по
   * ней — по этому делению зоне раздаются её треугольники. Комнат такое деление не порождает: интерьерные
   * cut-рёбра (`areas/cutEdges`) склеиваются обратно в `rebuildContours`.
   */
  cutPairs?: readonly (readonly [PlanPosition, PlanPosition])[];
}

/** Треугольник по индексам вершин `Triangulation.vertices`, порядок вершин — как отдал `cdt2d`. */
export type TriangleIndices = [number, number, number];

/** Ребро half-edge-lite: неориентированное (`a < b`), `fixed` — совпало с ребром-ограничением входа. */
export interface TriangulationEdge {
  a: number;
  b: number;
  fixed: boolean;
  /** Индексы инцидентных треугольников: один — ребро на выпуклой оболочке, два — внутреннее. */
  triangles: number[];
}

/**
 * Ближайший объемлющий контур центроида: `'outer'` — тело стены, `'inner'` — объявленная полость,
 * `null` — вне всех контуров (exterior или полость, замкнутая только телами стен).
 */
export type InnermostKind = 'outer' | 'inner' | null;

/**
 * Связная группа треугольников (flood-fill через не-fixed рёбра) с классификацией центроида
 * репрезентативного (не-узкого) треугольника против входных наборов (ADR 0017 C6).
 */
export interface TriangleGroup {
  /** Индексы треугольников группы (`Triangulation.triangles`). */
  triangles: number[];
  /**
   * Тело стены: счётчик референса `inside(outer) > inside(inner)` **или** ближайший объемлющий контур — `outer`
   * (см. `innermostKind`), с bound∩/subtract-семантикой (`classifyFill`).
   */
  fill: boolean;
  /** Хоть одно ребро группы лежит на выпуклой оболочке (один инцидентный треугольник). */
  touchesHull: boolean;
  /** Вид ближайшего (наименьшего по площади) контура, строго содержащего центроид; при равной площади — `inner`. */
  innermost: InnermostKind;
  /** Сколько `outer` / `inner` контуров строго содержат центроид (счётчик референса). */
  insideOuter: number;
  insideInner: number;
}

export interface Triangulation {
  /** Вершины — квантованные (0.001) координаты, включая точки пересечений от `clean-pslg`. */
  vertices: PlanPosition[];
  triangles: TriangleIndices[];
  edges: TriangulationEdge[];
  /** Для каждого треугольника — индексы его трёх рёбер в `edges` (сторона `i` — между вершинами `i` и `i+1`). */
  triangleEdges: [number, number, number][];
  /**
   * Группы, разделённые fixed-рёбрами; группы из одних узких треугольников (`triangleIsNarrow`) отброшены —
   * их треугольники ни в одной группе.
   */
  groups: TriangleGroup[];
}

/** Ключ квантованной координаты — тождество вершин бит-в-бит (ADR 0017 C3). */
const vertexKey = (x: number, y: number): string => `${x}|${y}`;
const edgeKey = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Обвязка триангуляции (ADR 0017 C6, семь шагов dd01 с rework): квантование входа → дедуп вершин/рёбер
 * hash-map по квантованному ключу → `resplitSegments` (осевые коллинеарные перекрытия/T-стыки) → `clean-pslg`
 * (общие пересечения) → квантование и повторный дедуп вершин результата (тот же вход, что увидит `rebuild`
 * на хранимых контурах) → `cdt2d({ exterior: true })` (полная триангуляция оболочки) → half-edge-lite с
 * `fixed` по отсортированной паре → flood-fill групп по не-fixed рёбрам явным стеком → sliver-safe
 * репрезентативный треугольник → центроид-классификация против четырёх наборов контуров.
 * Плоские массивы на выходе, без глобального пула; вход не мутируется.
 */
export const triangulateContours = ({
  outer,
  inner,
  bound = [],
  subtract = [],
  cutPairs = [],
}: TriangulateContoursInput): Triangulation => {
  const points: PslgPoint[] = [];
  const pointIndex = new Map<string, number>();
  const rawEdges: PslgEdge[] = [];
  const edgeSet = new Set<string>();

  const indexOf = (p: PlanPosition): number => {
    const x = quantize(p.x);
    const y = quantize(p.y);
    const key = vertexKey(x, y);
    let index = pointIndex.get(key);
    if (index === undefined) {
      index = points.length;
      points.push([x, y]);
      pointIndex.set(key, index);
    }
    return index;
  };
  const addSegment = (a: PlanPosition, b: PlanPosition): void => {
    const ia = indexOf(a);
    const ib = indexOf(b);
    if (ia === ib) return;
    const key = edgeKey(ia, ib);
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    rawEdges.push([ia, ib]);
  };

  // Порядок наборов — как у референса (inner, outer, bound, subtract): влияет только на нумерацию вершин.
  for (const set of [inner, outer, bound, subtract]) {
    for (const contour of set) {
      const n = contour.length;
      if (n < 2) continue;
      for (let i = 0; i < n; i++) addSegment(contour[i]!, contour[(i + 1) % n]!);
    }
  }
  for (const [a, b] of cutPairs) addSegment(a, b);

  const cleaned = cleanPslg(points, resplitSegments(points, rawEdges));
  const { vertices, edges: constraintEdges } = requantize(cleaned);

  const triangles =
    vertices.length >= 3
      ? cdt2d(
          vertices.map(v => [v.x, v.y]),
          constraintEdges,
          { exterior: true },
        )
      : [];

  const fixedKeys = new Set(constraintEdges.map(([a, b]) => edgeKey(a, b)));
  const edges: TriangulationEdge[] = [];
  const edgeIndex = new Map<string, number>();
  const triangleEdges: [number, number, number][] = triangles.map((triangle, t) => {
    const sides: number[] = [];
    for (let i = 0; i < 3; i++) {
      const a = triangle[i]!;
      const b = triangle[(i + 1) % 3]!;
      const key = edgeKey(a, b);
      let index = edgeIndex.get(key);
      if (index === undefined) {
        index = edges.length;
        edges.push({ a: Math.min(a, b), b: Math.max(a, b), fixed: fixedKeys.has(key), triangles: [] });
        edgeIndex.set(key, index);
      }
      edges[index]!.triangles.push(t);
      sides.push(index);
    }
    return sides as [number, number, number];
  });

  const structure = { vertices, triangles, edges, triangleEdges };
  const rawGroups = groupTriangles(
    structure,
    triangles.map((_, t) => t),
    true,
  );
  const measured = [
    ...outer.map(points => ({ kind: 'outer' as const, points, area: Math.abs(contourArea(points)) })),
    ...inner.map(points => ({ kind: 'inner' as const, points, area: Math.abs(contourArea(points)) })),
  ];

  const groups: TriangleGroup[] = [];
  for (const group of rawGroups) {
    const representative = group.find(t => {
      const [a, b, c] = triangles[t]!;
      return !triangleIsNarrow(vertices[a]!, vertices[b]!, vertices[c]!);
    });
    // Группа из одних сливеров: центроид ненадёжен — группа отбрасывается целиком (референс: «bad group»).
    if (representative === undefined) continue;
    const [a, b, c] = triangles[representative]!;
    const center = triangleCenter(vertices[a]!, vertices[b]!, vertices[c]!);
    const innermost = innermostKind(center, measured);
    const insideOuter = pointInContours(center, outer);
    const insideInner = pointInContours(center, inner);
    const touchesHull = group.some(t => triangleEdges[t]!.some(e => edges[e]!.triangles.length === 1));
    groups.push({
      triangles: group,
      fill: classifyFill(center, insideOuter > insideInner || innermost === 'outer', bound, subtract),
      touchesHull,
      innermost,
      insideOuter,
      insideInner,
    });
  }

  return { ...structure, groups };
};

/**
 * Квантование координат результата `clean-pslg` до 0.001 (ADR 0016 B1) с повторным дедупом вершин по ключу:
 * `normalize` сохранит именно эти координаты, и `rebuild` на хранимых контурах триангулирует ту же геометрию.
 * Рёбра переиндексируются; ставшие вырожденными — отбрасываются.
 */
const requantize = ({
  points,
  edges,
}: {
  points: PslgPoint[];
  edges: PslgEdge[];
}): {
  vertices: PlanPosition[];
  edges: PslgEdge[];
} => {
  const vertices: PlanPosition[] = [];
  const remap = new Array<number>(points.length);
  const index = new Map<string, number>();
  points.forEach(([px, py], i) => {
    const x = quantize(px);
    const y = quantize(py);
    const key = vertexKey(x, y);
    let mapped = index.get(key);
    if (mapped === undefined) {
      mapped = vertices.length;
      vertices.push({ x, y });
      index.set(key, mapped);
    }
    remap[i] = mapped;
  });
  const seen = new Set<string>();
  const result: PslgEdge[] = [];
  for (const [a, b] of edges) {
    const ra = remap[a]!;
    const rb = remap[b]!;
    if (ra === rb) continue;
    const key = edgeKey(ra, rb);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push([ra, rb]);
  }
  return { vertices, edges: result };
};

/**
 * Вид ближайшего объемлющего контура (наше дополнение к счётчику `inside(outer) > inside(inner)` референса —
 * см. JSDoc `rebuildContours`): среди контуров, строго содержащих точку, берётся наименьший по площади;
 * при равной площади — `inner` (полость, нарисованная поверх сплошного тела, вырезает его — как у референса).
 * На вложенном (непересекающемся) наборе это ровно «непосредственный родитель» в дереве контуров.
 */
const innermostKind = (
  point: PlanPosition,
  contours: readonly { kind: 'outer' | 'inner'; points: readonly PlanPosition[]; area: number }[],
): InnermostKind => {
  let best: { kind: 'outer' | 'inner'; area: number } | null = null;
  for (const contour of contours) {
    if (!pointInContour(point, contour.points)) continue;
    if (
      best === null ||
      contour.area < best.area ||
      (contour.area === best.area && contour.kind === 'inner' && best.kind === 'outer')
    ) {
      best = contour;
    }
  }
  return best?.kind ?? null;
};

/**
 * Гейты fill по референсу (dd01, шаг 6) поверх базовой классификации `base` (счётчик или ближайший объемлющий — `outer`):
 * при наличии `bound`/`subtract` fill только там, где `bound` покрывает не слабее `subtract` (оба набора), где есть
 * хоть один `bound` (только bound) или где нет ни одного `subtract` (только subtract); иначе группа не fill.
 */
const classifyFill = (point: PlanPosition, base: boolean, bound: ContourSet, subtract: ContourSet): boolean => {
  if (bound.length > 0 && subtract.length > 0) {
    return pointInContours(point, bound) >= pointInContours(point, subtract) && base;
  }
  if (bound.length > 0) return pointInContours(point, bound, true) > 0 && base;
  if (subtract.length > 0) return pointInContours(point, subtract) === 0 && base;
  return base;
};
