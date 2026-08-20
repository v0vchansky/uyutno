import { polygonCentroid } from './roomAnchor';

describe('polygonCentroid', () => {
  it('у прямоугольника центроид — центр bbox, ориентация обхода на результат не влияет', () => {
    const ccw = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
    ];
    expect(polygonCentroid(ccw)).toEqual({ x: 200, y: 150 });
    expect(polygonCentroid([...ccw].reverse())).toEqual({ x: 200, y: 150 });
  });

  it('у треугольника центроид — среднее вершин', () => {
    const centroid = polygonCentroid([
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 0, y: 300 },
    ]);
    expect(centroid!.x).toBeCloseTo(100, 9);
    expect(centroid!.y).toBeCloseTo(100, 9);
  });

  it('у Г-образной комнаты центроид площади уходит от среднего вершин', () => {
    // Квадрат 200×200 с вырезанным углом 100×100: центр тяжести смещён от середины bbox к «толстой» части.
    const centroid = polygonCentroid([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ])!;
    expect(centroid.x).toBeCloseTo(83.3333333, 5);
    expect(centroid.y).toBeCloseTo(83.3333333, 5);
    // Среднее вершин у этой фигуры — (100, 100); центроид площади с ним не совпадает.
    expect(centroid.x).not.toBeCloseTo(100, 3);
  });

  it('центроид не зависит от того, с какой вершины начат обход', () => {
    const loop = [
      { x: 10, y: 10 },
      { x: 210, y: 10 },
      { x: 210, y: 110 },
      { x: 10, y: 110 },
    ];
    const rotated = [...loop.slice(2), ...loop.slice(0, 2)];
    expect(polygonCentroid(rotated)).toEqual(polygonCentroid(loop));
  });

  it('меньше трёх вершин — null', () => {
    expect(polygonCentroid([])).toBeNull();
    expect(polygonCentroid([{ x: 0, y: 0 }])).toBeNull();
    expect(
      polygonCentroid([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toBeNull();
  });

  it('вырожденная площадь (точки на одной прямой) — null, вызывающий подставит свой якорь', () => {
    expect(
      polygonCentroid([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 },
        { x: 300, y: 0 },
      ]),
    ).toBeNull();
    // Совпавшие вершины — тот же вырожденный случай.
    expect(
      polygonCentroid([
        { x: 5, y: 5 },
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ]),
    ).toBeNull();
  });

  it('обе стороны порога вырожденности: площадь чуть выше — центроид есть, чуть ниже — null', () => {
    // Треугольник с основанием 1 см и высотой h: площадь = h/2. Порог — 1e-6 см².
    const sliver = (height: number) => [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: height },
    ];
    expect(polygonCentroid(sliver(3e-6))).not.toBeNull();
    expect(polygonCentroid(sliver(1e-6))).toBeNull();
  });

  it('не конечные координаты — null, а не NaN в результате', () => {
    expect(
      polygonCentroid([
        { x: 0, y: 0 },
        { x: Number.NaN, y: 0 },
        { x: 0, y: 100 },
      ]),
    ).toBeNull();
    expect(
      polygonCentroid([
        { x: 0, y: 0 },
        { x: Number.POSITIVE_INFINITY, y: 0 },
        { x: 0, y: 100 },
      ]),
    ).toBeNull();
  });
});
