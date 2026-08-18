import { SORT_AREA_EPS, type SortableContour, sortByArea } from './sortByArea';

const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

const contour = (id: string, kind: 'outer' | 'inner', points: SortableContour['points']) => ({ id, kind, points });

describe('sortByArea', () => {
  it('SORT_AREA_EPS = 10 (ADR 0017 C3)', () => {
    expect(SORT_AREA_EPS).toBe(10);
  });

  it('по убыванию |площади|, ориентация обхода не важна; вход не мутируется', () => {
    const small = contour('small', 'inner', square(0, 0, 10));
    const big = contour('big', 'inner', square(0, 0, 100));
    const mediumCw = contour('medium', 'inner', [...square(0, 0, 50)].reverse());
    const input = [small, big, mediumCw];
    const sorted = sortByArea(input);
    expect(sorted.map(c => c.id)).toEqual(['big', 'medium', 'small']);
    expect(input.map(c => c.id)).toEqual(['small', 'big', 'medium']);
  });

  it('разница площадей < 10: outer после inner независимо от того, кто чуть больше', () => {
    const outerBigger = contour('outer', 'outer', square(0, 0, 10.4)); // 108.16
    const inner = contour('inner', 'inner', square(0, 0, 10)); // 100
    expect(sortByArea([outerBigger, inner]).map(c => c.id)).toEqual(['inner', 'outer']);
    expect(sortByArea([inner, outerBigger]).map(c => c.id)).toEqual(['inner', 'outer']);
  });

  it('разница ровно на пороге (10) и больше — снова по площади; 9.99 — ещё по виду', () => {
    const inner = contour('inner', 'inner', square(0, 0, 10)); // 100
    const outerAt10 = contour('outer', 'outer', square(0, 0, Math.sqrt(110))); // 110 — разница ровно 10
    expect(sortByArea([inner, outerAt10]).map(c => c.id)).toEqual(['outer', 'inner']);
    const outerAt999 = contour('outer', 'outer', square(0, 0, Math.sqrt(109.99)));
    expect(sortByArea([outerAt999, inner]).map(c => c.id)).toEqual(['inner', 'outer']);
    const outer = contour('outer', 'outer', square(0, 0, 11)); // 121 — разница 21
    expect(sortByArea([inner, outer]).map(c => c.id)).toEqual(['outer', 'inner']);
  });

  it('одинаковый вид и почти равная площадь: tie-break (minX, minY) bbox по возрастанию', () => {
    const right = contour('right', 'inner', square(50, 0, 10));
    const left = contour('left', 'inner', square(-50, 0, 10));
    const upper = contour('upper', 'inner', square(-50, 20, 10));
    expect(sortByArea([right, upper, left]).map(c => c.id)).toEqual(['left', 'upper', 'right']);
  });

  it('пустой массив и один контур', () => {
    expect(sortByArea([])).toEqual([]);
    const only = contour('only', 'outer', square(0, 0, 10));
    expect(sortByArea([only])).toEqual([only]);
  });
});
