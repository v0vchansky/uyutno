import { findMinMax } from './findMinMax';

describe('findMinMax', () => {
  it('bbox набора точек, отрицательные координаты', () => {
    expect(
      findMinMax([
        { x: 3, y: -1 },
        { x: -7, y: 4 },
        { x: 0, y: 0 },
      ]),
    ).toEqual({ minX: -7, minY: -1, maxX: 3, maxY: 4 });
  });

  it('одна точка — вырожденный bbox; пусто — null', () => {
    expect(findMinMax([{ x: 2, y: 3 }])).toEqual({ minX: 2, minY: 3, maxX: 2, maxY: 3 });
    expect(findMinMax([])).toBeNull();
  });
});
