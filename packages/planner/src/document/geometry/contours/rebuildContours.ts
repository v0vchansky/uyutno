import type { PlanPosition } from '../../PlannerDocument';
import { contourFaces } from '../areas/areaEdges';
import { interiorCutEdges } from '../areas/cutEdges';
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
  /** Индексы треугольников группы **по возрастанию** — и у одиночной группы, и у склейки через cut-рёбра. */
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
 * граница и без стены. **Исключение — интерьерные cut-рёбра зон** (`detectRooms`). Контракт пригоден шагу 6
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
  // Грани контуров нужны только для классификации cut-рёбер: без зон их не собираем (горячий путь — каждая
  // транзакция, ADR 0017 C11 «полный синхронный recompute»).
  const cutPairs = filtered.cutPairs ?? [];
  const cutEdges =
    cutPairs.length === 0
      ? EMPTY_CUT_EDGES
      : interiorCutEdges(triangulation, cutPairs, contourFaces([...filtered.outer, ...filtered.inner]));
  const fillGroups = triangulation.groups.filter(group => group.fill);
  const fillTriangles = separateContacting
    ? fillGroups.map(group => group.triangles)
    : groupTriangles(
        triangulation,
        fillGroups.flatMap(group => group.triangles),
        false,
      );
  const roomTriangles = detectRooms(triangulation, cutEdges);

  let softFail = false;
  const trace = (groups: readonly (readonly number[])[]): ContourGroup[] => {
    const result: ContourGroup[] = [];
    for (const triangles of groups) {
      const traced = contoursFromGroup(triangulation, triangles, cutEdges);
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

/** Общий пустой набор cut-рёбер — планы без зон не аллоцируют его на каждой транзакции. */
const EMPTY_CUT_EDGES: ReadonlySet<number> = new Set<number>();

/** Критерий комнаты — см. JSDoc `rebuildContours`. */
const isRoom = (group: TriangleGroup): boolean => !group.fill && (!group.touchesHull || group.innermost === 'inner');

/**
 * **Cut-пары зон и критерий комнаты** (ADR 0017 C6). Рёбра зоны идут в триангуляцию как fixed — иначе
 * треугольники не легли бы по границе зоны и крышку зоны нечем было бы
 * набрать. Но fixed-ребро делит группы, а наш критерий («не-fill группа без ребра на выпуклой оболочке
 * **или** ближайший объемлющий контур — `inner`») смотрит на группу: обе половинки разрезанной комнаты
 * прошли бы его, и зона молча удваивала бы записи `rooms[]`.
 *
 * Правило: **интерьерное cut-ребро — не граница комнаты.** Не-fill группы, разделённые только такими
 * рёбрами, склеиваются обратно (DSU по рёбрам из `interiorCutEdges`), и склейка считается комнатой, лишь
 * когда критерий проходит **каждая** её часть. «Каждая», а не «хоть одна», потому что склейка обязана
 * быть консервативной: у зоны, вылезшей за комнату (такую отбракует стадия (3), но в триангуляцию она уже
 * попала), кусок экстерьера, отрезанный её рёбрами, критерий проходит — но склеивается с настоящим
 * экстерьером, который его не проходит, и фантомной комнаты не возникает. Ребро зоны «по стене» в набор
 * не входит и остаётся барьером — там граница комнаты настоящая.
 *
 * Что не меняется: `triangulation.groups` по-прежнему разрезаны cut-рёбрами — по ним 2b/0070 раздаёт
 * треугольники зоне (центр репрезентативного треугольника группы через `pointInContour(area.points)`;
 * у референса это буквально **первый** треугольник группы, sliver-safe выбор — наш), а склейка живёт
 * только здесь, в детекции комнат. Без cut-рёбер (`cuts.size === 0`) функция тождественна прежнему
 * `groups.filter(isRoom)` — и по составу, и по порядку; порядок треугольников в обеих ветках
 * возрастающий (`groupTriangles` сортирует каждую группу, склейка сортирует результат).
 *
 * Гварды объединения (ребро не с двумя инцидентными треугольниками; треугольник не в не-fill группе)
 * пропускают склейку, тогда как из графа обвода такое ребро снимается безусловно. Расхождения не
 * возникает: ребро с одним инцидентным треугольником лежит на оболочке (группа заведомо exterior),
 * а fill/не-fill соседство бывает только на грани контура — такое ребро в набор не попадает вовсе
 * (`interiorCutEdges` его отсеивает), поэтому «хорда снята, а группы не склеены» невозможно.
 */
const detectRooms = (triangulation: Triangulation, cuts: ReadonlySet<number>): number[][] => {
  const nonFill = triangulation.groups.filter(group => !group.fill);
  if (cuts.size === 0) return nonFill.filter(isRoom).map(group => group.triangles);

  const groupOf = new Map<number, number>();
  nonFill.forEach((group, index) => group.triangles.forEach(t => groupOf.set(t, index)));
  const parent = nonFill.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    for (let i = index; parent[i] !== root;) {
      const next = parent[i]!;
      parent[i] = root;
      i = next;
    }
    return root;
  };
  for (const index of cuts) {
    const edge = triangulation.edges[index]!;
    if (edge.triangles.length !== 2) continue;
    const left = groupOf.get(edge.triangles[0]!);
    const right = groupOf.get(edge.triangles[1]!);
    if (left === undefined || right === undefined) continue;
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  }

  const merged = new Map<number, number[]>();
  nonFill.forEach((_, index) => {
    const root = find(index);
    const parts = merged.get(root);
    if (parts) parts.push(index);
    else merged.set(root, [index]);
  });
  const rooms: number[][] = [];
  for (const parts of merged.values()) {
    if (!parts.every(index => isRoom(nonFill[index]!))) continue;
    rooms.push(parts.flatMap(index => nonFill[index]!.triangles).sort((a, b) => a - b));
  }
  return rooms;
};

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
