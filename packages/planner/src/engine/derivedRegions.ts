import { contourArea } from '../document/geometry/predicates/contourArea';
import { pointInContour } from '../document/geometry/predicates/pointInContour';
import { triangleCenter, triangleIsNarrow } from '../document/geometry/predicates/triangle';
import type { Triangulation } from '../document/geometry/triangulate/triangulateContours';
import type { Id } from '../document/id';
import type { PlanPosition } from '../document/PlannerDocument';
import { coordinateKey } from './normalizeIds';
import type { Triangle } from './rebuild';

/**
 * Общие кирпичи стадии производного (задача 0070) — то, чем полы, зоны и вырезы пользуются одинаково:
 * «какой области принадлежит группа треугольников», «какой контур из набора её объемлет» и «как перевести
 * треугольники триангуляции в id точек этажа». Живут отдельно, потому что триангуляций у rebuild две
 * (контуры этажа и полы), а правила адресации у них одни.
 */

/**
 * Точка-представитель группы треугольников: центроид её первого **не узкого** треугольника. Группа целиком
 * лежит по одну сторону каждого входного контура (все они — fixed-рёбра триангуляции), поэтому одной точки
 * достаточно, чтобы ответить «внутри ли группа такого-то контура».
 *
 * Sliver-safe выбор — наше расхождение с референсом: `findAreasTriangles` (`plannercore.js:60081`) берёт
 * **первый** треугольник группы, и на сливере его центроид может лечь в B_EPS-зону границы, то есть зона
 * потеряла бы или прихватила лишний кусок крышки. Приём тот же, что в `triangulateContours` и
 * `covers/coverRegionPoint`; `null` — группа из одних сливеров (ядро такие отбрасывает ещё до классификации,
 * так что на практике недостижимо, но тип обязывает обработать).
 */
export const regionPoint = (triangulation: Triangulation, triangles: readonly number[]): PlanPosition | null => {
  const { vertices, triangles: indices } = triangulation;
  for (const index of triangles) {
    const [a, b, c] = indices[index]!;
    const [va, vb, vc] = [vertices[a]!, vertices[b]!, vertices[c]!];
    if (!triangleIsNarrow(va, vb, vc)) return triangleCenter(va, vb, vc);
  }
  return null;
};

/**
 * Индекс **ближайшего объемлющего** контура набора: среди строго содержащих точку берётся наименьший по
 * модулю площади; `null` — точку не содержит ни один. То же правило, что у `innermostKind` триангуляции:
 * на вложенном (непересекающемся) наборе — а хранимые полы и комнаты после нормализации всегда такие —
 * это ровно «непосредственный родитель». Нужно там, где ответ «внутри какого-то» недостаточен: пол в
 * дырке другого пола принадлежит внутреннему, комната в комнате — внутренней.
 *
 * Расхождение с референсом осознанное: `findRoomsForCovers` (`plannercore.js:55324`) перебирает комнаты и
 * оставляет полу **последнюю** совпавшую — при комнате в комнате результат зависит от порядка массива.
 */
export const innermostIndex = (point: PlanPosition, contours: readonly (readonly PlanPosition[])[]): number | null => {
  let best: number | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  contours.forEach((contour, index) => {
    if (!pointInContour(point, contour)) return;
    const area = Math.abs(contourArea(contour));
    if (best !== null && area >= bestArea) return;
    best = index;
    bestArea = area;
  });
  return best;
};

/** Перевод индексов триангуляции в id точек этажа — вершина без id значит «layout не нормализован». */
export interface TriangleResolver {
  /** Id точки этажа по индексу вершины; `null` — такой точки в `layout.points` нет. */
  vertex: (index: number) => Id | null;
  /** Треугольники по индексам; треугольник с вершиной без id пропускается, факт уходит в `onMissing` один раз. */
  triangles: (indices: readonly number[]) => Triangle[];
}

/**
 * Резолвер вершин триангуляции в id точек этажа по тождеству квантованной координаты (та же дисциплина,
 * что у `normalize`, ADR 0017 C1). `onMissing` зовётся **не более одного раза** на резолвер: один
 * ненормализованный этаж не должен заливать лог сотней одинаковых предупреждений.
 */
export const createTriangleResolver = (
  triangulation: Triangulation,
  idByKey: ReadonlyMap<string, Id>,
  onMissing: () => void,
): TriangleResolver => {
  const ids = triangulation.vertices.map(vertex => idByKey.get(coordinateKey(vertex)) ?? null);
  let reported = false;
  const vertex = (index: number): Id | null => ids[index] ?? null;
  return {
    vertex,
    triangles: indices => {
      const out: Triangle[] = [];
      for (const index of indices) {
        const [a, b, c] = triangulation.triangles[index]!;
        const ia = vertex(a);
        const ib = vertex(b);
        const ic = vertex(c);
        if (ia === null || ib === null || ic === null) {
          if (!reported) {
            reported = true;
            onMissing();
          }
          continue;
        }
        out.push([ia, ib, ic]);
      }
      return out;
    },
  };
};
