import { rebuildContours } from '../contours/rebuildContours';
import { type ContourRelation, compareContours } from '../predicates/compareContours';
import { type CoverShape, contourPositions } from './coverShape';
import { findCoverHoles } from './findCoverHoles';

/**
 * Отношения `compareContours`, при которых два пола обязаны стать одним.
 *
 * Список референса — буквально `INTERSECT | BELONG | CONTACT_BELONG` **и он асимметричен**:
 * `findRelatedCovers` всегда получает новый пол первым аргументом, поэтому «старый внутри нового»
 * (`CONTAIN`/`CONTACT_CONTAIN`) там просто не встречается. Наш `coversRelated` вызывается на паре без
 * выделенного «нового», поэтому список **симметризован** — это осознанное расхождение с реверсом, а не
 * его пересказ: без `contain`/`contactContain` результат зависел бы от порядка индексов.
 *
 * `contact` (только общая граница) в списке нет — он добавляется режимом `contact: true` (см. `mergeCovers`),
 * потому что по ADR 0017 C9 «merge INTERSECT — авто, CONTACT — по решению UI». `coincide` идёт вместе с
 * `contact`: совпавшие обводы — заведомо один пол.
 */
export const MERGING_RELATIONS: readonly ContourRelation[] = [
  'intersect',
  'belong',
  'contain',
  'contactBelong',
  'contactContain',
];

/** Те же отношения плюс касание и совпадение — режим `contact: true`. */
export const MERGING_RELATIONS_WITH_CONTACT: readonly ContourRelation[] = [...MERGING_RELATIONS, 'contact', 'coincide'];

export interface CoversRelatedOptions {
  /** Считать ли чистое касание (и совпадение обводов) поводом слиться. Дефолт — `true`, см. `mergeCovers`. */
  contact?: boolean;
}

/**
 * Пара полов, которые обязаны слиться: отношение обводов входит в список режима.
 *
 * **Дырка соседа отношения не создаёт.** Пол, обвод которого лежит **строго** внутри выреза другого пола
 * (`belong` без касания — например, площадка на дне шахты), с этим полом не связан: их роднит только обвод,
 * материала они не делят, и слияние отдало бы шахте материал и флаг потолка внешнего пола (спека 02,
 * «первый пол-донор»). Референс сравнивает и с дырками соседа (`findRelatedCovers`), но у него дырки —
 * самостоятельные записи `arrCovers`; у нас они внутри `CoverShape`, поэтому проверка явная. Касание
 * границы выреза (`contactBelong`) связью **остаётся**: такой пол примыкает к материалу соседа и должен
 * зарастить свою часть выреза.
 */
export const coversRelated = (a: CoverShape, b: CoverShape, { contact = true }: CoversRelatedOptions = {}): boolean => {
  const relations = contact ? MERGING_RELATIONS_WITH_CONTACT : MERGING_RELATIONS;
  if (!relations.includes(compareContours(a.outline, b.outline))) return false;
  return !insideHoleOf(a, b) && !insideHoleOf(b, a);
};

/** Обвод `a` лежит строго внутри одного из вырезов `b` (касание границы выреза не считается). */
const insideHoleOf = (a: CoverShape, b: CoverShape): boolean =>
  b.holes.some(hole => compareContours(a.outline, hole) === 'belong');

/**
 * Группы индексов полов, которые должны слиться в один — **транзитивное замыкание** `coversRelated`
 * (A перекрыл B, B перекрыл C → все три в одной группе, даже если A и C не касаются).
 *
 * Порядок детерминирован и стабилен: группы идут по возрастанию наименьшего индекса-участника, участники
 * внутри группы — по возрастанию. Пол, ни с кем не связанный, даёт группу из одного индекса, поэтому
 * результат всегда покрывает все индексы `covers` ровно один раз.
 */
export const relatedCoverGroups = (covers: readonly CoverShape[], options: CoversRelatedOptions = {}): number[][] => {
  const parent = covers.map((_, index) => index);
  // Union-find по индексам: корень группы — всегда наименьший индекс, поэтому порядок групп не зависит
  // от порядка объединений. Сжатие путей — чтобы `relatedCoverGroups` оставался линейным на длинных цепочках.
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    let current = index;
    while (parent[current] !== root) {
      const next = parent[current]!;
      parent[current] = root;
      current = next;
    }
    return root;
  };
  for (let i = 0; i < covers.length; i++) {
    for (let j = i + 1; j < covers.length; j++) {
      if (!coversRelated(covers[i]!, covers[j]!, options)) continue;
      const [a, b] = [find(i), find(j)];
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < covers.length; i++) {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(i);
    else groups.set(root, [i]);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, group]) => group);
};

export interface MergeCoversResult {
  covers: CoverShape[];
  /** `sources[i]` — индексы входных полов, из которых собран `covers[i]` (группа целиком, своя копия массива). */
  sources: number[][];
  /** Хоть один обход оборвался внутри `rebuildContours` — движок логирует (стадия 0069). */
  softFail: boolean;
}

/**
 * Слияние связанных полов (ADR 0017 C9, спека 02 «Слияние соседних полов»): каждая группа
 * `relatedCoverGroups` перетриангулируется как объединение — `rebuildContours(outer = обводы группы,
 * inner = дырки группы, separateContacting: false)`, как у референса (`rebuildRelatedCovers`).
 * `separateContacting: false` здесь обязателен: пересекающиеся полы дают три fill-группы (только A,
 * перекрытие, только B), и слить их в одно тело можно лишь через общие fixed-рёбра.
 *
 * **Дырки результата — не-fill группы (`rebuildContours(...).rooms`), а не повторные обходы графа.**
 * Так делает референс, и только так остаток частично закрытого выреза получается верным: залитая часть
 * выреза становится полом, незакрытая остаётся дыркой. Повторный обход графа fixed-рёбер на этом пути
 * вернул бы исходную петлю выреза, а внутренняя петля (вложенный пол) стала бы ложной дыркой.
 * Ориентация приводится к конвенции `CoverShape` (обвод против часовой, дырки по часовой) с сохранением
 * канонического старта; принадлежность дырки телу — тем же `findCoverHoles`, что и на хранимых контурах.
 *
 * **`contact` (дефолт `true`).** Спека 02 «Слияние соседних полов», третий пункт: полы, соприкоснувшиеся
 * или пересёкшиеся **косвенно** — из-за правки стен, — объединяются автоматически, без запроса; диалог
 * «Объединить?» существует только при ручном рисовании. Какой режим применить, решает стадия пересборки
 * (0069): фаза (4) `rebuildCovers` идёт с `separateContacting: true` и касающиеся полы не склеивает, а
 * фаза (5) при появлении авто-пола сливает связанные полы **включая касание** — как референс
 * (`findAutoCovers` сливает всё набранное `findRelatedCovers`). `contact: false` оставлен ручному
 * рисованию (0071), где на касание пользователю показывают выбор.
 *
 * Пол, ни с кем не связанный, проходит насквозь **той же ссылкой**: перетриангуляция единственного контура
 * ничего не меняет по смыслу, но может сдвинуть вершины (`clearContour`) и стоит времени. Наружу таким
 * образом отдаются входные объекты `CoverShape` — вызывающий их не мутирует; массивы `sources` — всегда
 * свои копии. Порядок выхода повторяет порядок групп, то есть относительный порядок несвязанных полов
 * сохраняется.
 *
 * Кто из доноров отдаёт данные слитому полу (материал, флаг «скрыть потолок») — не здесь: `sources`
 * отдаёт индексы группы в порядке возрастания, «первый пол-донор» спеки 02 выбирает стадия 0069 через
 * `matchCoverRecords`. Вход не мутируется.
 */
export const mergeCovers = (covers: readonly CoverShape[], options: CoversRelatedOptions = {}): MergeCoversResult => {
  const result: MergeCoversResult = { covers: [], sources: [], softFail: false };
  for (const group of relatedCoverGroups(covers, options)) {
    if (group.length === 1) {
      result.covers.push(covers[group[0]!]!);
      result.sources.push([...group]);
      continue;
    }
    const rebuilt = rebuildContours({
      outer: group.map(index => covers[index]!.outline),
      inner: group.flatMap(index => covers[index]!.holes),
      separateContacting: false,
    });
    if (rebuilt.softFail) result.softFail = true;
    const bodies = rebuilt.walls.map(body => contourPositions(rebuilt, body.outline));
    const holes = rebuilt.rooms.map(room => reverseLoop(contourPositions(rebuilt, room.outline)));
    const { holes: owned } = findCoverHoles(bodies, holes);
    bodies.forEach((outline, index) => {
      result.covers.push({ outline, holes: owned[index]!.map(hole => holes[hole]!) });
      result.sources.push([...group]);
    });
  }
  return result;
};

/** Смена обмотки с сохранением стартовой вершины (канонический старт `rebuildContours` — min-X/min-Y). */
const reverseLoop = <T>(loop: readonly T[]): T[] => [loop[0]!, ...loop.slice(1).reverse()];
