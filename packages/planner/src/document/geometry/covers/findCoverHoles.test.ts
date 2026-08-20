import * as fc from 'fast-check';

import type { PlanPosition } from '../../PlannerDocument';
import { MIN_CONTOUR_AREA, MIN_SP_RATIO, contourArea, contourPerim } from '../predicates/contourArea';
import { locatePointInContour } from '../predicates/pointInContour';
import { SORT_AREA_EPS } from '../predicates/sortByArea';
import { fcParams } from '../testing/arbitraries';
import { findCoverHoles } from './findCoverHoles';

const rect = (x0: number, y0: number, x1: number, y1: number): PlanPosition[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Контур с `NaN` в одной вершине — не проходит `contourValid` (площадь `NaN`). */
const NAN_CONTOUR: PlanPosition[] = [
  { x: Number.NaN, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];
/** Контур с `Infinity` в одной вершине — площадь `NaN` по той же причине. */
const INFINITE_CONTOUR: PlanPosition[] = [
  { x: 0, y: 0 },
  { x: Number.POSITIVE_INFINITY, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

/**
 * Прямоугольники, попарно **вложенные либо непересекающиеся** — предусловие `compareContoursOnePoint`
 * (рёбра не пересекаются): четыре ячейки шириной 1000 см, в каждой три вложенных квадрата.
 */
const NESTED_FAMILY: PlanPosition[][] = [0, 1, 2, 3].flatMap(cell => {
  const x = cell * 1000;
  return [rect(x, 0, x + 900, 900), rect(x + 200, 200, x + 700, 700), rect(x + 400, 400, x + 500, 500)];
});
const familyIndices = fc.subarray([...NESTED_FAMILY.keys()]);

describe('findCoverHoles', () => {
  it('внутренний контур внутри внешнего становится его дыркой', () => {
    expect(findCoverHoles([rect(0, 0, 100, 100)], [rect(40, 40, 60, 60)])).toEqual({ holes: [[0]], orphans: [] });
  });

  it('несколько дырок у одного пола — в порядке входного массива', () => {
    expect(findCoverHoles([rect(0, 0, 300, 100)], [rect(200, 40, 260, 60), rect(40, 40, 60, 60)])).toEqual({
      holes: [[0, 1]],
      orphans: [],
    });
  });

  it('дырка без внешнего хозяина — сирота (на удаление)', () => {
    expect(findCoverHoles([rect(0, 0, 100, 100)], [rect(500, 500, 600, 600)])).toEqual({
      holes: [[]],
      orphans: [0],
    });
  });

  it('внешних полов нет вовсе — все внутренние сироты', () => {
    expect(findCoverHoles([], [rect(0, 0, 100, 100), rect(200, 0, 300, 100)])).toEqual({
      holes: [],
      orphans: [0, 1],
    });
  });

  it('комната в комнате: дырка достаётся меньшему (внутреннему) полу, а не большему', () => {
    const outer = [rect(0, 0, 100, 100), rect(20, 20, 80, 80)];
    const inner = [rect(40, 40, 60, 60)];
    expect(findCoverHoles(outer, inner)).toEqual({ holes: [[], [0]], orphans: [] });
    // Порядок входа роли не играет: обход задан площадью, а не индексами.
    expect(findCoverHoles([outer[1]!, outer[0]!], inner)).toEqual({ holes: [[0], []], orphans: [] });
  });

  it('порог SORT_AREA_EPS: при разнице площадей больше порога порядок решает площадь', () => {
    const big = rect(0, 0, 100, 100);
    const small = rect(1, 1, 99, 99);
    expect(Math.abs(10000 - 98 * 98)).toBeGreaterThan(SORT_AREA_EPS);
    expect(findCoverHoles([big, small], [rect(40, 40, 60, 60)])).toEqual({ holes: [[], [0]], orphans: [] });
  });

  it('порог SORT_AREA_EPS: при разнице меньше порога порядок решает tie-break bbox — вложенный всё равно первый', () => {
    const big = rect(0, 0, 100, 100);
    const small = rect(0.001, 0.001, 99.999, 99.999);
    expect(Math.abs(10000 - 99.998 * 99.998)).toBeLessThan(SORT_AREA_EPS);
    expect(findCoverHoles([big, small], [rect(40, 40, 60, 60)])).toEqual({ holes: [[], [0]], orphans: [] });
  });

  it('дырка расходуется: два вложенных пола не делят одну и ту же дырку', () => {
    const result = findCoverHoles([rect(0, 0, 100, 100), rect(20, 20, 80, 80)], [rect(40, 40, 60, 60)]);
    expect(result.holes.flat()).toEqual([0]);
  });

  it('внутренний контур, лишь касающийся внешнего снаружи, — сирота', () => {
    expect(findCoverHoles([rect(0, 0, 100, 100)], [rect(100, 0, 200, 100)])).toEqual({
      holes: [[]],
      orphans: [0],
    });
  });

  it('внутренний контур, совпавший с внешним, дыркой не становится (coincide — не вложенность)', () => {
    expect(findCoverHoles([rect(0, 0, 100, 100)], [rect(0, 0, 100, 100)])).toEqual({
      holes: [[]],
      orphans: [0],
    });
  });

  it('дырка, прижатая к границе внешнего пола общим ребром, остаётся дыркой', () => {
    expect(findCoverHoles([rect(0, 0, 100, 100)], [rect(0, 40, 50, 60)])).toEqual({ holes: [[0]], orphans: [] });
  });

  it('пустые входы — пустой результат', () => {
    expect(findCoverHoles([], [])).toEqual({ holes: [], orphans: [] });
    expect(findCoverHoles([rect(0, 0, 100, 100)], [])).toEqual({ holes: [[]], orphans: [] });
  });

  it('вырожденный внутренний контур хозяина не находит: < 3 точек, нулевая площадь, площадь < 50 см²', () => {
    const degenerate = [
      [],
      [{ x: 40, y: 40 }],
      [
        { x: 40, y: 40 },
        { x: 40, y: 40 },
        { x: 40, y: 40 },
      ],
      rect(40, 40, 45, 45),
    ];
    expect(findCoverHoles([rect(0, 0, 100, 100)], degenerate)).toEqual({ holes: [[]], orphans: [0, 1, 2, 3] });
  });

  it('вырожденный внешний пол хозяином не становится — его дырка уходит валидному полу', () => {
    expect(findCoverHoles([[{ x: 40, y: 40 }], rect(0, 0, 100, 100)], [rect(40, 40, 60, 60)])).toEqual({
      holes: [[], [0]],
      orphans: [],
    });
  });

  it('порог MIN_CONTOUR_AREA у внутреннего контура: ровно 50 см² — дырка, 25 см² — сирота', () => {
    // 10 × 5: площадь ровно на пороге (гейт `>=`), периметр 30 → ratio ≈ 1.67 > MIN_SP_RATIO.
    const onThreshold = rect(40, 40, 50, 45);
    expect(Math.abs(contourArea(onThreshold))).toBe(MIN_CONTOUR_AREA);
    expect(Math.abs(contourArea(onThreshold)) / contourPerim(onThreshold)).toBeGreaterThan(MIN_SP_RATIO);
    expect(findCoverHoles([rect(0, 0, 100, 100)], [onThreshold])).toEqual({ holes: [[0]], orphans: [] });

    const belowThreshold = rect(40, 40, 45, 45);
    expect(Math.abs(contourArea(belowThreshold))).toBeLessThan(MIN_CONTOUR_AREA);
    expect(findCoverHoles([rect(0, 0, 100, 100)], [belowThreshold])).toEqual({ holes: [[]], orphans: [0] });
  });

  it('порог MIN_SP_RATIO у внутреннего контура: сливер с площадью выше порога всё равно сирота', () => {
    // 200 × 0.4: площадь 80 см² выше порога площади, но ratio ≈ 0.2 — второй гейт `contourValid`.
    const sliver = rect(40, 40, 240, 40.4);
    expect(Math.abs(contourArea(sliver))).toBeGreaterThan(MIN_CONTOUR_AREA);
    expect(Math.abs(contourArea(sliver)) / contourPerim(sliver)).toBeLessThan(MIN_SP_RATIO);
    expect(findCoverHoles([rect(0, 0, 300, 100)], [sliver])).toEqual({ holes: [[]], orphans: [0] });
  });

  it('не-конечные координаты внутреннего контура: хозяина нет, контур — сирота', () => {
    expect(findCoverHoles([rect(0, 0, 100, 100)], [NAN_CONTOUR])).toEqual({ holes: [[]], orphans: [0] });
    expect(findCoverHoles([rect(0, 0, 100, 100)], [INFINITE_CONTOUR])).toEqual({ holes: [[]], orphans: [0] });
  });

  it('не-конечные координаты внешнего контура: хозяином не становится, дырка уходит валидному соседу', () => {
    // Регресс: `contourValid` стоял только на `inner`, и `NaN`-контур (тест по точке отвечает «внутри»)
    // забирал живую дырку себе.
    expect(findCoverHoles([NAN_CONTOUR], [rect(20, 20, 60, 60)])).toEqual({ holes: [[]], orphans: [0] });
    expect(findCoverHoles([INFINITE_CONTOUR], [rect(20, 20, 60, 60)])).toEqual({ holes: [[]], orphans: [0] });
    expect(findCoverHoles([NAN_CONTOUR, rect(0, 0, 100, 100)], [rect(20, 20, 60, 60)])).toEqual({
      holes: [[], [0]],
      orphans: [],
    });
  });

  it('обмотка по часовой и отрицательные координаты: вложенность та же', () => {
    const ccwOuter = rect(-100, -100, 0, 0);
    const ccwInner = rect(-60, -60, -40, -40);
    const owned = { holes: [[0]], orphans: [] };
    expect(findCoverHoles([ccwOuter], [ccwInner])).toEqual(owned);
    expect(findCoverHoles([[...ccwOuter].reverse()], [[...ccwInner].reverse()])).toEqual(owned);
    // Смешанная обмотка (обвод по часовой, дырка против) — тот же ответ: знак площади здесь роли не играет.
    expect(findCoverHoles([[...ccwOuter].reverse()], [ccwInner])).toEqual(owned);
    // Отрицательные координаты не ломают порядок «меньший пол забирает дырку первым».
    expect(findCoverHoles([rect(-100, -100, 0, 0), rect(-80, -80, -20, -20)], [ccwInner])).toEqual({
      holes: [[], [0]],
      orphans: [],
    });
  });

  it('property: каждый внутренний контур ровно один раз — либо дырка одного хозяина, либо сирота', () => {
    fc.assert(
      fc.property(familyIndices, familyIndices, (outerIndices, innerIndices) => {
        const outer = outerIndices.map(index => NESTED_FAMILY[index]!);
        const inner = innerIndices.map(index => NESTED_FAMILY[index]!);
        const { holes, orphans } = findCoverHoles(outer, inner);
        expect(holes).toHaveLength(outer.length);
        expect([...holes.flat(), ...orphans].sort((a, b) => a - b)).toEqual(inner.map((_, index) => index));
      }),
      fcParams,
    );
  });

  it('property: дырка вложена в своего хозяина — все её вершины внутри обвода, площадь меньше', () => {
    fc.assert(
      fc.property(familyIndices, familyIndices, (outerIndices, innerIndices) => {
        const outer = outerIndices.map(index => NESTED_FAMILY[index]!);
        const inner = innerIndices.map(index => NESTED_FAMILY[index]!);
        findCoverHoles(outer, inner).holes.forEach((owned, ownerIndex) => {
          for (const hole of owned) {
            for (const point of inner[hole]!) {
              expect(locatePointInContour(point, outer[ownerIndex]!)).not.toBe('outside');
            }
            expect(Math.abs(contourArea(inner[hole]!))).toBeLessThan(Math.abs(contourArea(outer[ownerIndex]!)));
          }
        });
      }),
      fcParams,
    );
  });

  it('вход не мутируется', () => {
    const outer = [rect(0, 0, 100, 100), rect(20, 20, 80, 80)];
    const inner = [rect(40, 40, 60, 60)];
    const snapshot = JSON.stringify({ outer, inner });
    findCoverHoles(outer, inner);
    expect(JSON.stringify({ outer, inner })).toBe(snapshot);
  });
});
