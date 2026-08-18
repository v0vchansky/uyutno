import type { PlanPosition } from '../../PlannerDocument';
import { contourArea, contourValid } from '../predicates/contourArea';
import { groupTriangles } from '../triangulate/groupTriangles';
import {
  type ContourSet,
  type TriangleGroup,
  type Triangulation,
  type TriangulateContoursInput,
  triangulateContours,
} from '../triangulate/triangulateContours';
import { clearContour } from './clearContour';
import { contoursFromGroup } from './contoursFromGroup';

export interface RebuildContoursInput extends TriangulateContoursInput {
  /**
   * `false` (дефолт, стены): касающиеся fill-группы сливаются через общие fixed-рёбра — квады ленты становятся
   * одним телом; `true` (полы, 2b): каждая fill-группа остаётся отдельной.
   */
  separateContacting?: boolean;
}

/** Обвод одной группы: индексы вершин `triangulation.vertices`, треугольники — индексы `triangulation.triangles`. */
export interface ContourGroup {
  /** Против часовой при y вверх (`contourArea > 0`), начало — вершина min-X (при равенстве min-Y). */
  outline: number[];
  /** По часовой (`contourArea < 0`), то же правило начала. Дырки — по членству в группе, не containment-тестом. */
  holes: number[][];
  triangles: number[];
}

export interface RebuildContoursResult {
  triangulation: Triangulation;
  /** Тела стен: fill-группы (слитые, если не `separateContacting`) с валидным обводом. */
  walls: ContourGroup[];
  /** Комнаты: не-fill группы без ребра на выпуклой оболочке либо объявленные полости (центроид внутри `inner`). */
  rooms: ContourGroup[];
  /** Хоть один обход оборвался (guard runaway walk); группа пропущена или её дырки неполны — движок логирует. */
  softFail: boolean;
}

/**
 * Публичная чистая функция ядра (ADR 0017 C6): `filterContours` (`clearContour` каждого входного контура,
 * негодные отбрасываются) → `triangulateContours` → группы → boundary walk каждой группы → нормализация
 * ориентации по знаку площади (обводы > 0, дырки < 0) → `clearContour` → `contourValid` → канонический старт.
 *
 * **Классификация центроида** — fill, если счётчик референса `inside(outer) > inside(inner)` (ADR 0017 C6)
 * **или** ближайший объемлющий контур (наименьший по площади из содержащих) — `outer`. Одного счётчика мало при
 * нашем решении «Комната по точкам = `inner`» (ADR 0019): стены, нарисованные внутри нарисованной комнаты, он
 * вырезает (1 outer против 1 inner), а после слияния теряет кратность (два перекрывающихся квада внутри `inner`:
 * 2 > 1 на сыром входе, 1 > 1 после нормализации — стены «проваливались» бы на втором прогоне). Одного правила
 * ближайшего контура тоже мало: комната, нарисованная поперёк стены, вырезала бы кусок стены (наименьший
 * содержащий — её `inner`), тогда как счётчик (2 outer > 1 inner) стену сохраняет и режет комнату надвое.
 * На вложенном (непересекающемся) наборе — а хранимые контуры после нормализации всегда такие — правила совпадают.
 * **Классы групп:** fill — тело стены (`walls`); **комната** — не-fill группа, у которой нет ребра на выпуклой
 * оболочке триангуляции (замкнута телами стен), **либо** чей ближайший объемлющий контур — `inner`
 * (объявленная полость: «Комната по точкам» без стен, спека 01 «Polyline Room»); остальное — exterior.
 * Не-fill группы не сливаются через fixed-рёбра (в отличие от референса): ребро нарисованной комнаты —
 * граница и без стены; как это совместить с cut-парами зон — 2b (ADR 0017 C6). Контракт пригоден шагу 6
 * (юнион луток — `walls[].outline`) и полам (bound/subtract, `separateContacting`, `walls[].holes`).
 */
export const rebuildContours = ({
  separateContacting = false,
  ...input
}: RebuildContoursInput): RebuildContoursResult => {
  const filtered: TriangulateContoursInput = {
    outer: filterContours(input.outer),
    inner: filterContours(input.inner),
    bound: filterContours(input.bound ?? []),
    subtract: filterContours(input.subtract ?? []),
    cutPairs: input.cutPairs ?? [],
  };
  const triangulation = triangulateContours(filtered);
  const fillGroups = triangulation.groups.filter(group => group.fill);
  const fillTriangles = separateContacting
    ? fillGroups.map(group => group.triangles)
    : groupTriangles(
        triangulation,
        fillGroups.flatMap(group => group.triangles),
        false,
      );
  const roomTriangles = triangulation.groups.filter(isRoom).map(group => group.triangles);

  let softFail = false;
  const trace = (groups: readonly (readonly number[])[]): ContourGroup[] => {
    const result: ContourGroup[] = [];
    for (const triangles of groups) {
      const traced = contoursFromGroup(triangulation, triangles);
      if (traced.softFail) softFail = true;
      if (!traced.outline) continue;
      const outline = finishLoop(triangulation.vertices, traced.outline, 'ccw');
      if (!outline) continue;
      const holes: number[][] = [];
      for (const hole of traced.holes) {
        const finished = finishLoop(triangulation.vertices, hole, 'cw');
        if (finished) holes.push(finished);
      }
      result.push({ outline, holes, triangles: [...triangles] });
    }
    return result;
  };

  return { triangulation, walls: trace(fillTriangles), rooms: trace(roomTriangles), softFail };
};

/** Критерий комнаты — см. JSDoc `rebuildContours`. */
const isRoom = (group: TriangleGroup): boolean => !group.fill && (!group.touchesHull || group.innermost === 'inner');

/** `filterContours` референса: чистка каждого контура, негодные — вон. */
const filterContours = (contours: ContourSet): PlanPosition[][] => {
  const result: PlanPosition[][] = [];
  for (const contour of contours) {
    const cleaned = clearContour(contour);
    if (cleaned) result.push(cleaned);
  }
  return result;
};

/**
 * Ориентация по знаку площади (наша конвенция `contourArea`: > 0 — против часовой при y вверх), чистка,
 * валидность, канонический старт с вершины min-X/min-Y. `null` — петля негодна.
 */
const finishLoop = (
  vertices: readonly PlanPosition[],
  loop: readonly number[],
  winding: 'ccw' | 'cw',
): number[] | null => {
  const positions = loop.map(index => vertices[index]!);
  const area = contourArea(positions);
  if (area === 0) return null;
  const oriented = (winding === 'ccw') === area > 0 ? [...loop] : [...loop].reverse();
  const orientedPositions = oriented.map(index => vertices[index]!);
  const cleaned = clearContour(orientedPositions);
  if (!cleaned || !contourValid(cleaned)) return null;
  const indexOf = new Map<PlanPosition, number>();
  oriented.forEach((index, i) => indexOf.set(orientedPositions[i]!, index));
  const indices = cleaned.map(position => indexOf.get(position)!);
  return rotateToMin(vertices, indices);
};

/** Циклический сдвиг к вершине с минимальным `x` (при равенстве — минимальным `y`). */
const rotateToMin = (vertices: readonly PlanPosition[], loop: number[]): number[] => {
  let best = 0;
  for (let i = 1; i < loop.length; i++) {
    const p = vertices[loop[i]!]!;
    const b = vertices[loop[best]!]!;
    if (p.x < b.x || (p.x === b.x && p.y < b.y)) best = i;
  }
  return [...loop.slice(best), ...loop.slice(0, best)];
};
