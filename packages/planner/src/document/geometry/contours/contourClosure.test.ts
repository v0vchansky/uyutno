import { euclDist, manhDist } from '../predicates/distance';
import { CLOSE_EPS, contourClosure } from './contourClosure';

const POINTS = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
];
const walls = { lastRadius: 10, distance: euclDist };

describe('contourClosure', () => {
  it('CLOSE_EPS = 0.1 см (спека 01, ADR 0017 C3)', () => {
    expect(CLOSE_EPS).toBe(0.1);
  });

  it('кандидат у первой точки в пределах CLOSE_EPS — first (петля); ровно на пороге — включительно', () => {
    expect(contourClosure({ x: 0.05, y: 0.05 }, POINTS, walls)).toBe('first');
    expect(contourClosure({ x: 0.1, y: 0 }, POINTS, walls)).toBe('first');
    expect(contourClosure({ x: 0.1001, y: 0 }, POINTS, walls)).toBeNull();
  });

  it('кандидат у последней точки в пределах lastRadius (толщина стены) — last; дальше — null', () => {
    expect(contourClosure({ x: 100, y: 110 }, POINTS, walls)).toBe('last');
    expect(contourClosure({ x: 100, y: 110.001 }, POINTS, walls)).toBeNull();
    expect(contourClosure({ x: 50, y: 50 }, POINTS, walls)).toBeNull();
  });

  it('метрику задаёт вызывающий: манхэттен строже евклида на диагонали', () => {
    const candidate = { x: 107, y: 107 }; // евклид 9.9 ≤ 10, манхэттен 14 > 10
    expect(contourClosure(candidate, POINTS, walls)).toBe('last');
    expect(contourClosure(candidate, POINTS, { lastRadius: 10, distance: manhDist })).toBeNull();
  });

  it('свой firstRadius', () => {
    expect(contourClosure({ x: 3, y: 0 }, POINTS, { ...walls, firstRadius: 5 })).toBe('first');
  });

  it('первая точка приоритетнее последней, когда обе в допуске (крошечный контур)', () => {
    const tiny = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(contourClosure({ x: 0.05, y: 0 }, tiny, walls)).toBe('first');
  });

  it('меньше трёх точек — петля невозможна: у первой точки не замыкает, у последней — last', () => {
    const two = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(contourClosure({ x: 0, y: 0 }, two, walls)).toBeNull();
    expect(contourClosure({ x: 100, y: 5 }, two, walls)).toBe('last');
    expect(contourClosure({ x: 0, y: 5 }, [{ x: 0, y: 0 }], walls)).toBe('last');
  });

  it('без точек — null', () => {
    expect(contourClosure({ x: 0, y: 0 }, [], walls)).toBeNull();
  });
});
