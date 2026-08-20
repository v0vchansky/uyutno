import type { PlanPosition } from '../../PlannerDocument';
import type { ContourGroup, RebuildContoursResult } from '../contours/rebuildContours';
import { triangleCenter, triangleIsNarrow } from '../predicates/triangle';

/**
 * Пол как plain-геометрия: незамкнутые массивы вершин, ориентация — конвенция `rebuildContours`
 * (обвод против часовой, `contourArea > 0`; дырки по часовой, `contourArea < 0`). Общий словарь всех
 * функций `covers/`, поэтому живёт отдельным файлом, а не в одной из них.
 */
export interface CoverShape {
  outline: PlanPosition[];
  holes: PlanPosition[][];
}

/**
 * Петля индексов вершин триангуляции → координаты. Точки **копируются**: соседние группы делят вершины
 * триангуляции, а куски полов делить объекты не должны (их потом замораживает immer в снимке документа).
 */
export const contourPositions = (result: RebuildContoursResult, loop: readonly number[]): PlanPosition[] => {
  const { vertices } = result.triangulation;
  return loop.map(index => ({ x: vertices[index]!.x, y: vertices[index]!.y }));
};

/**
 * Группы `rebuildContours` в `CoverShape`, где дырки берутся из `group.holes` — повторных обходов графа
 * fixed-рёбер группы.
 *
 * **Только для путей с `separateContacting: true`** (`rebuildCovers`, `findAutoCovers`): там группа разрезана
 * по всем fixed-рёбрам, поэтому каждое ребро графа — граница группы, и повторный обход не может вернуть
 * внутреннюю хорду. При `separateContacting: false` это неверно (петля fixed-рёбер внутри залитой группы
 * вернулась бы «дыркой», а настоящий остаток выреза — нет), и дырки берутся из не-fill групп —
 * `rebuildContours(...).rooms`, как у референса (`rebuildRelatedCovers`); так делает `mergeCovers`.
 */
export const coverShapes = (result: RebuildContoursResult, groups: readonly ContourGroup[]): CoverShape[] =>
  groups.map(group => ({
    outline: contourPositions(result, group.outline),
    holes: group.holes.map(hole => contourPositions(result, hole)),
  }));

/**
 * Точка-представитель области группы: центроид её первого не-узкого треугольника. Группа целиком лежит по
 * одну сторону каждого входного контура (все они — fixed-рёбра триангуляции), поэтому одной точки хватает,
 * чтобы ответить «внутри ли группа такого-то набора контуров». Sliver-safe приём — тот же, что в
 * `triangulateContours`; `null` группа вернуть не может (группы из одних сливеров ядро отбрасывает как
 * «bad group» ещё до классификации), но тип обязывает обработать — вызывающие трактуют `null` как «нет».
 */
export const coverRegionPoint = (result: RebuildContoursResult, group: ContourGroup): PlanPosition | null => {
  const { vertices, triangles } = result.triangulation;
  for (const index of group.triangles) {
    const [a, b, c] = triangles[index]!;
    const [va, vb, vc] = [vertices[a]!, vertices[b]!, vertices[c]!];
    if (!triangleIsNarrow(va, vb, vc)) return triangleCenter(va, vb, vc);
  }
  return null;
};
