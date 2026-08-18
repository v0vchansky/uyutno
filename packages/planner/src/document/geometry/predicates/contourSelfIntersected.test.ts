import * as fc from 'fast-check';

import { arbConvexPolygon, fcParams } from '../testing/arbitraries';
import { contourSelfIntersected } from './contourSelfIntersected';

describe('contourSelfIntersected', () => {
  const SQUARE = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const BOWTIE = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ];

  it('простой квадрат — нет; «бабочка» — да', () => {
    expect(contourSelfIntersected(SQUARE)).toBe(false);
    expect(contourSelfIntersected(BOWTIE)).toBe(true);
  });

  it('пересечение через замыкающее ребро ловится только при closed = true', () => {
    // Открытая полилиния 0→1→2→3 не пересекается, замыкающее ребро 3→0 пересекает 1→2.
    const hook = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 5 },
    ];
    expect(contourSelfIntersected(hook, true)).toBe(true);
    expect(contourSelfIntersected(hook, false)).toBe(false);
  });

  it('открытая полилиния с пересечением внутренних рёбер — да', () => {
    expect(contourSelfIntersected(BOWTIE, false)).toBe(true);
  });

  it('касание вершиной ребра (не трансверсально) и общая вершина — нет (как референс)', () => {
    const touching = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 5, y: 0 }, // вершина на ребре 0→1
      { x: 0, y: 10 },
    ];
    expect(contourSelfIntersected(touching)).toBe(false);
  });

  it('вырожденные: < 3 точек, дубли, коллинеарные — нет', () => {
    expect(contourSelfIntersected([])).toBe(false);
    expect(
      contourSelfIntersected([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBe(false);
    expect(
      contourSelfIntersected([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ]),
    ).toBe(false);
    expect(
      contourSelfIntersected([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBe(false);
  });

  it('property: выпуклый многоугольник никогда не самопересекается', () => {
    fc.assert(
      fc.property(arbConvexPolygon, polygon => {
        expect(contourSelfIntersected(polygon)).toBe(false);
      }),
      fcParams,
    );
  });
});
