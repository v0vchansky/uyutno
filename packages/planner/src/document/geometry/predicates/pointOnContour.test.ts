import { pointOnContour } from './pointOnContour';
import { B_EPS } from './pointOnSegment';

const SQUARE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe('pointOnContour', () => {
  it('точки на рёбрах, включая замыкающее last→first, и вершины — true', () => {
    expect(pointOnContour({ x: 50, y: 0 }, SQUARE)).toBe(true);
    expect(pointOnContour({ x: 0, y: 50 }, SQUARE)).toBe(true); // замыкающее ребро (0,100)→(0,0)
    expect(pointOnContour({ x: 100, y: 100 }, SQUARE)).toBe(true);
  });

  it('внутри и снаружи — false; коридор B_EPS по обе стороны ребра', () => {
    expect(pointOnContour({ x: 50, y: 50 }, SQUARE)).toBe(false);
    expect(pointOnContour({ x: 150, y: 50 }, SQUARE)).toBe(false);
    expect(pointOnContour({ x: 50, y: B_EPS * 0.99 }, SQUARE)).toBe(true);
    expect(pointOnContour({ x: 50, y: -B_EPS * 0.99 }, SQUARE)).toBe(true);
    expect(pointOnContour({ x: 50, y: B_EPS * 1.01 }, SQUARE)).toBe(false);
  });

  it('вырожденные контуры: пусто и одна точка — false; две точки — одно ребро', () => {
    expect(pointOnContour({ x: 0, y: 0 }, [])).toBe(false);
    expect(pointOnContour({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toBe(false);
    expect(
      pointOnContour({ x: 5, y: 0 }, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBe(true);
  });

  it('свой accuracy', () => {
    expect(pointOnContour({ x: 50, y: 0.5 }, SQUARE, 1)).toBe(true);
  });
});
