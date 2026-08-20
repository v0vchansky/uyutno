import * as fc from 'fast-check';

import type { PlanPosition } from '../../PlannerDocument';
import { contourArea } from '../predicates/contourArea';
import { fcParams } from '../testing/arbitraries';
import type { CoverShape } from './coverShape';
import {
  MERGING_RELATIONS,
  MERGING_RELATIONS_WITH_CONTACT,
  coversRelated,
  mergeCovers,
  relatedCoverGroups,
} from './mergeCovers';

const rect = (x0: number, y0: number, x1: number, y1: number): PlanPosition[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const cover = (outline: PlanPosition[], holes: PlanPosition[][] = []): CoverShape => ({ outline, holes });
/** Вершины подряд: `clearContour` коллинеарные точки не удаляет (спека 01 — это законные точки пользователя). */
const path = (...pairs: readonly (readonly [number, number])[]): PlanPosition[] => pairs.map(([x, y]) => ({ x, y }));

const SEPARATE = { contact: false } as const;

/** Геометрический ключ набора полов: порядок групп контрактом не является, сравниваем множества. */
const key = (covers: readonly CoverShape[]): string[] =>
  covers
    .map(item =>
      [item.outline, ...item.holes].map(loop => loop.map(point => `${point.x},${point.y}`).join(' ')).join(' | '),
    )
    .sort();

/** Пара из регресса на обрыв обхода: вершина `SPIKE` — в одном кванте (0.001 см) от ребра `SLIVER`. */
const SPIKE: PlanPosition[] = [
  { x: 99.999, y: 0 },
  { x: 100, y: 150 },
  { x: 0, y: 0 },
];
const SLIVER: PlanPosition[] = [
  { x: 100, y: 100 },
  { x: 100, y: 0 },
  { x: 75, y: 0 },
];

/** Полы на сетке 50 см: соседние прямоугольники пересекаются, касаются и вкладываются друг в друга. */
const arbGridCover: fc.Arbitrary<CoverShape> = fc
  .record({
    x: fc.integer({ min: 0, max: 6 }),
    y: fc.integer({ min: 0, max: 6 }),
    w: fc.integer({ min: 1, max: 3 }),
    h: fc.integer({ min: 1, max: 3 }),
  })
  .map(({ x, y, w, h }) => cover(rect(x * 50, y * 50, (x + w) * 50, (y + h) * 50)));

describe('coversRelated / relatedCoverGroups', () => {
  it('пересекающиеся полы связаны, разнесённые — нет', () => {
    expect(coversRelated(cover(rect(0, 0, 100, 100)), cover(rect(50, 0, 150, 100)))).toBe(true);
    expect(coversRelated(cover(rect(0, 0, 100, 100)), cover(rect(500, 0, 600, 100)))).toBe(false);
  });

  it('вложенность связывает в обе стороны (belong и contain) — список симметризован относительно референса', () => {
    const big = cover(rect(0, 0, 200, 200));
    const small = cover(rect(50, 50, 150, 150));
    expect(coversRelated(big, small)).toBe(true);
    expect(coversRelated(small, big)).toBe(true);
    expect(MERGING_RELATIONS).toContain('contain');
    expect(MERGING_RELATIONS).toContain('contactContain');
  });

  it('вложенность с общим куском границы (contactBelong / contactContain) связывает в любом режиме', () => {
    const big = cover(rect(0, 0, 200, 200));
    const flush = cover(rect(0, 50, 100, 150));
    expect(coversRelated(big, flush, SEPARATE)).toBe(true);
    expect(coversRelated(flush, big, SEPARATE)).toBe(true);
  });

  it('чистое касание: по умолчанию связывает (спека 02, косвенное касание), с `contact: false` — нет', () => {
    const a = cover(rect(0, 0, 100, 100));
    const b = cover(rect(100, 0, 200, 100));
    expect(coversRelated(a, b)).toBe(true);
    expect(coversRelated(a, b, SEPARATE)).toBe(false);
    expect(MERGING_RELATIONS).not.toContain('contact');
    expect(MERGING_RELATIONS_WITH_CONTACT).toContain('contact');
  });

  it('совпавшие обводы — заведомо один пол: связаны в дефолтном режиме, раздельны при `contact: false`', () => {
    const a = cover(rect(0, 0, 100, 100));
    const b = cover(rect(0, 0, 100, 100));
    expect(coversRelated(a, b)).toBe(true);
    expect(coversRelated(a, b, SEPARATE)).toBe(false);
  });

  it('пустой обвод ни с чем не связан (bbox-предфильтр `compareContours`)', () => {
    expect(coversRelated(cover([]), cover(rect(0, 0, 100, 100)))).toBe(false);
    expect(coversRelated(cover([]), cover([]))).toBe(false);
  });

  it('пол строго внутри чужого выреза (площадка в шахте) не связан — материал они не делят', () => {
    const outer = cover(rect(0, 0, 200, 200), [rect(60, 60, 140, 140)]);
    const shaft = cover(rect(80, 80, 120, 120));
    expect(coversRelated(outer, shaft)).toBe(false);
    expect(coversRelated(shaft, outer)).toBe(false);
    expect(relatedCoverGroups([outer, shaft])).toEqual([[0], [1]]);
  });

  it('пол, прижатый к границе чужого выреза, связан: он примыкает к материалу соседа', () => {
    const outer = cover(rect(0, 0, 200, 200), [rect(60, 60, 140, 140)]);
    const patch = cover(rect(60, 60, 100, 140));
    expect(coversRelated(outer, patch)).toBe(true);
    expect(coversRelated(patch, outer)).toBe(true);
  });

  it('транзитивное замыкание: A и C лишь касаются, но оба пересекают B — одна группа', () => {
    const covers = [cover(rect(0, 0, 100, 100)), cover(rect(50, 0, 150, 100)), cover(rect(100, 0, 200, 100))];
    expect(relatedCoverGroups(covers, SEPARATE)).toEqual([[0, 1, 2]]);
  });

  it('группы идут по возрастанию наименьшего индекса, участники — по возрастанию', () => {
    const covers = [
      cover(rect(0, 0, 100, 100)),
      cover(rect(500, 0, 600, 100)),
      cover(rect(50, 0, 150, 100)),
      cover(rect(550, 0, 650, 100)),
    ];
    expect(relatedCoverGroups(covers)).toEqual([
      [0, 2],
      [1, 3],
    ]);
  });

  it('цепочка `parent` длиной ≥ 2: группа приходит к уже слитой с меньшим корнем позже (сжатие путей)', () => {
    // Порядок пар (i < j): (1,4) даёт parent[4] = 1, (3,5) — parent[5] = 3, и только затем (4,5) сводит
    // корни 3 и 1 → parent[3] = 1. К финальному обходу у 5 цепочка 5 → 3 → 1, которую сжимает `find`.
    const covers = [
      cover(rect(1000, 0, 1100, 100)),
      cover(rect(0, 0, 100, 100)),
      cover(rect(1200, 0, 1300, 100)),
      cover(rect(270, 0, 370, 100)),
      cover(rect(90, 0, 190, 100)),
      cover(rect(180, 0, 280, 100)),
    ];
    expect(relatedCoverGroups(covers)).toEqual([[0], [1, 3, 4, 5], [2]]);
    const result = mergeCovers(covers);
    expect(result.sources).toEqual([[0], [1, 3, 4, 5], [2]]);
    // Цепочка полов слилась в одно тело 0..370 × 0..100 без дырок.
    expect(result.covers[1]!.holes).toEqual([]);
    expect(contourArea(result.covers[1]!.outline)).toBe(370 * 100);
  });

  it('каждый индекс попадает ровно в одну группу; пустой вход — пустой результат', () => {
    const covers = [cover(rect(0, 0, 100, 100)), cover(rect(500, 0, 600, 100)), cover(rect(50, 0, 150, 100))];
    expect(relatedCoverGroups(covers).flat().sort()).toEqual([0, 1, 2]);
    expect(relatedCoverGroups([])).toEqual([]);
    expect(relatedCoverGroups([cover(rect(0, 0, 100, 100))])).toEqual([[0]]);
  });
});

describe('mergeCovers', () => {
  it('пересекающиеся полы становятся одним телом; sources — вся группа', () => {
    const result = mergeCovers([cover(rect(0, 0, 100, 100)), cover(rect(50, 0, 150, 100))]);
    expect(result.softFail).toBe(false);
    expect(result.covers).toHaveLength(1);
    expect(result.covers[0]!.outline).toEqual(
      path([0, 0], [50, 0], [100, 0], [150, 0], [150, 100], [100, 100], [50, 100], [0, 100]),
    );
    expect(contourArea(result.covers[0]!.outline)).toBeGreaterThan(0);
    expect(result.sources).toEqual([[0, 1]]);
  });

  it('вложенный пол растворяется во внешнем — обвод внешнего, ложной дырки на его месте нет', () => {
    const result = mergeCovers([cover(rect(0, 0, 200, 200)), cover(rect(50, 50, 150, 150))]);
    expect(result.covers).toHaveLength(1);
    expect(result.covers[0]!.outline).toEqual(rect(0, 0, 200, 200));
    expect(result.covers[0]!.holes).toEqual([]);
    expect(result.sources).toEqual([[0, 1]]);
  });

  it('пол закрыл часть чужого выреза — незакрытый остаток остаётся дыркой (площадь не теряется)', () => {
    const result = mergeCovers([cover(rect(0, 0, 200, 200), [rect(60, 60, 140, 140)]), cover(rect(60, 60, 100, 140))]);
    expect(result.covers).toHaveLength(1);
    expect(result.covers[0]!.holes).toEqual([path([100, 60], [100, 140], [140, 140], [140, 60])]);
    expect(contourArea(result.covers[0]!.holes[0]!)).toBeLessThan(0);
    // Остаток выреза — ровно правая половина исходного: 40 × 80 см².
    expect(Math.abs(contourArea(result.covers[0]!.holes[0]!))).toBe(40 * 80);
  });

  it('вырез, которого сосед не коснулся, сохраняется целиком', () => {
    const result = mergeCovers([cover(rect(0, 0, 200, 200), [rect(60, 60, 140, 140)]), cover(rect(150, 0, 300, 200))]);
    expect(result.covers).toHaveLength(1);
    expect(result.covers[0]!.holes).toEqual([path([60, 60], [60, 140], [140, 140], [140, 60])]);
    expect(contourArea(result.covers[0]!.holes[0]!)).toBeLessThan(0);
  });

  it('вырез, закрытый соседом целиком, зарастает', () => {
    const result = mergeCovers([cover(rect(0, 0, 200, 200), [rect(80, 80, 120, 120)]), cover(rect(60, 60, 140, 250))]);
    expect(result.covers).toHaveLength(1);
    expect(result.covers[0]!.holes).toEqual([]);
  });

  it('касающиеся полы: по умолчанию сливаются, при `contact: false` остаются на местах своими ссылками', () => {
    const left = cover(rect(0, 0, 100, 100));
    const right = cover(rect(100, 0, 200, 100));
    const merged = mergeCovers([left, right]);
    expect(merged.covers).toHaveLength(1);
    expect(merged.sources).toEqual([[0, 1]]);

    const separate = mergeCovers([left, right], SEPARATE);
    expect(separate.covers[0]).toBe(left);
    expect(separate.covers[1]).toBe(right);
    expect(separate.sources).toEqual([[0], [1]]);
  });

  it('пол в шахте не забирает материал внешнего: две записи, свои индексы-источники', () => {
    const outer = cover(rect(0, 0, 200, 200), [rect(60, 60, 140, 140)]);
    const shaft = cover(rect(80, 80, 120, 120));
    const result = mergeCovers([outer, shaft]);
    expect(result.covers).toEqual([outer, shaft]);
    expect(result.sources).toEqual([[0], [1]]);
  });

  it('несвязанный пол между двумя связанными не меняет порядок выхода', () => {
    const covers = [cover(rect(0, 0, 100, 100)), cover(rect(500, 0, 600, 100)), cover(rect(50, 0, 150, 100))];
    const result = mergeCovers(covers);
    expect(result.sources).toEqual([[0, 2], [1]]);
    expect(result.covers[0]!.outline).toEqual(
      path([0, 0], [50, 0], [100, 0], [150, 0], [150, 100], [100, 100], [50, 100], [0, 100]),
    );
    expect(result.covers[1]).toBe(covers[1]);
  });

  it('транзитивная группа из трёх сливается в один обвод', () => {
    const result = mergeCovers(
      [cover(rect(0, 0, 100, 100)), cover(rect(50, 0, 150, 100)), cover(rect(100, 0, 200, 100))],
      SEPARATE,
    );
    expect(result.covers).toHaveLength(1);
    expect(result.covers[0]!.outline).toEqual(
      path([0, 0], [50, 0], [100, 0], [150, 0], [200, 0], [200, 100], [150, 100], [100, 100], [50, 100], [0, 100]),
    );
    expect(result.sources).toEqual([[0, 1, 2]]);
  });

  it('одиночный пол проходит насквозь той же ссылкой (перетриангуляции нет)', () => {
    const single = cover(rect(0, 0, 100, 100));
    const result = mergeCovers([single]);
    expect(result.covers[0]).toBe(single);
    expect(result.sources).toEqual([[0]]);
  });

  it('sources — своя копия массива группы: правка одной записи не задевает соседнюю и внутреннее состояние', () => {
    const covers = [cover(rect(0, 0, 100, 100)), cover(rect(50, 0, 150, 100)), cover(rect(50, 40, 150, 60))];
    const result = mergeCovers(covers);
    expect(result.sources).toEqual([[0, 1, 2]]);
    const groups = relatedCoverGroups(covers);
    result.sources[0]!.push(99);
    expect(groups).toEqual([[0, 1, 2]]);
    // Повторный вызов не видит правки предыдущего результата.
    expect(mergeCovers(covers).sources).toEqual([[0, 1, 2]]);
  });

  it('вырожденный пол проходит насквозь: слияние его не касается, отбраковка — не его дело', () => {
    const degenerate = cover([{ x: 10, y: 10 }]);
    const result = mergeCovers([degenerate]);
    expect(result.covers).toEqual([degenerate]);
  });

  it('пустой вход — пустой результат без исключений', () => {
    expect(mergeCovers([])).toEqual({ covers: [], sources: [], softFail: false });
  });

  it('вход не мутируется', () => {
    const covers = [cover(rect(0, 0, 200, 200), [rect(60, 60, 140, 140)]), cover(rect(60, 60, 100, 140))];
    const snapshot = JSON.stringify(covers);
    mergeCovers(covers);
    expect(JSON.stringify(covers)).toBe(snapshot);
  });

  it('слияние идемпотентно: повторный прогон на результате ничего не меняет', () => {
    const once = mergeCovers([cover(rect(0, 0, 100, 100)), cover(rect(50, 0, 150, 100))]);
    const twice = mergeCovers(once.covers);
    expect(twice.covers).toEqual(once.covers);
    expect(twice.sources).toEqual([[0]]);
  });

  it('идемпотентность держится и на результате с дыркой', () => {
    const once = mergeCovers([cover(rect(0, 0, 200, 200), [rect(60, 60, 140, 140)]), cover(rect(60, 60, 100, 140))]);
    const twice = mergeCovers(once.covers);
    expect(twice.covers).toEqual(once.covers);
  });

  it('обрыв обхода внутри группы: softFail = true, тело группы в результат не попадает', () => {
    // Регресс, найденный фаззингом и минимизированный до явных координат: вершина (99.999, 0) стоит в одном
    // кванте (0.001 см) от ребра соседа, точка их пересечения после квантования слипается с существующей
    // вершиной. В слитой группе (`separateContacting: false`) остаются fixed-рёбра без продолжения, и обход
    // упирается в вершину без соседа. Контракт: исключения нет, группа пропущена, флаг виден вызывающему.
    const result = mergeCovers([cover(SPIKE), cover(SLIVER)]);
    expect(relatedCoverGroups([cover(SPIKE), cover(SLIVER)])).toEqual([[0, 1]]);
    expect(result.softFail).toBe(true);
    expect(result.covers).toEqual([]);
    expect(result.sources).toEqual([]);
  });

  it('softFail агрегируется по группам: сломалась одна — флаг в результате, остальные полы целы', () => {
    const intact = cover(rect(1000, 1000, 1100, 1100));
    const result = mergeCovers([cover(SPIKE), cover(SLIVER), intact]);
    expect(result.softFail).toBe(true);
    expect(result.sources).toEqual([[2]]);
    expect(result.covers[0]).toBe(intact);
  });

  it('обмотка по часовой и отрицательные координаты: слияние то же, ориентация выхода — по конвенции', () => {
    const left = rect(-100, -100, 0, 0);
    const right = rect(-50, -100, 50, 0);
    const ccw = mergeCovers([cover(left), cover(right)]);
    const cw = mergeCovers([cover([...left].reverse()), cover([...right].reverse())]);
    expect(cw.covers).toEqual(ccw.covers);
    expect(ccw.covers).toHaveLength(1);
    expect(contourArea(ccw.covers[0]!.outline)).toBeGreaterThan(0);
    expect(contourArea(ccw.covers[0]!.outline)).toBe(150 * 100);

    // Дырка в отрицательных координатах остаётся дыркой и приходит по часовой.
    const withHole = mergeCovers([
      cover([...rect(-200, -200, 0, 0)].reverse(), [[...rect(-140, -140, -60, -60)].reverse()]),
      cover([...rect(-140, -140, -100, -60)].reverse()),
    ]);
    expect(withHole.covers).toHaveLength(1);
    expect(contourArea(withHole.covers[0]!.outline)).toBeGreaterThan(0);
    expect(withHole.covers[0]!.holes).toHaveLength(1);
    expect(contourArea(withHole.covers[0]!.holes[0]!)).toBe(-(40 * 80));
  });

  it('property: `sources` — перестановка индексов входа, обводы > 0, дырки < 0', () => {
    fc.assert(
      fc.property(fc.array(arbGridCover, { minLength: 1, maxLength: 4 }), covers => {
        const result = mergeCovers(covers);
        expect(result.sources).toHaveLength(result.covers.length);
        // Группа, распавшаяся на несколько тел, повторяет свои индексы у каждого тела — разбиение проверяем
        // по различным группам: вместе они покрывают каждый индекс входа ровно один раз.
        const distinct = [...new Set(result.sources.map(group => group.join(',')))];
        expect(distinct.flatMap(group => group.split(',').map(Number)).sort((a, b) => a - b)).toEqual(
          covers.map((_, index) => index),
        );
        for (const item of result.covers) {
          expect(contourArea(item.outline)).toBeGreaterThan(0);
          for (const hole of item.holes) expect(contourArea(hole)).toBeLessThan(0);
          for (const point of [...item.outline, ...item.holes.flat()]) {
            expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
          }
        }
      }),
      fcParams,
    );
  });

  it('property: слияние идемпотентно — второй прогон повторяет геометрию первого и никого не сливает', () => {
    fc.assert(
      fc.property(fc.array(arbGridCover, { minLength: 1, maxLength: 4 }), covers => {
        const once = mergeCovers(covers);
        const twice = mergeCovers(once.covers);
        expect(key(twice.covers)).toEqual(key(once.covers));
        expect(twice.sources).toEqual(once.covers.map((_, index) => [index]));
      }),
      fcParams,
    );
  });
});
