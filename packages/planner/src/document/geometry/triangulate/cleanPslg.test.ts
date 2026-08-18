import { type PslgEdge, type PslgPoint, cleanPslg } from './cleanPslg';

/** Пример из README `clean-pslg`: четыре ребра, пересекающиеся в (0.5, 0.5); в выходе библиотеки есть петля `[8, 8]`. */
const readmePoints: PslgPoint[] = [
  [0.25, 0.5],
  [0.75, 0.5],
  [0.5, 0.25],
  [0.5, 0.75],
  [0.25, 0.25],
  [0.75, 0.75],
  [0.25, 0.75],
  [0.75, 0.25],
];
const readmeEdges: PslgEdge[] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
];

const clone = <T extends readonly (readonly number[])[]>(items: T): number[][] => items.map(item => [...item]);

describe('cleanPslg', () => {
  it('вход не мутируется: массивы и вложенные пары те же, результат — другие объекты', () => {
    const points = clone(readmePoints) as PslgPoint[];
    const edges = clone(readmeEdges) as PslgEdge[];
    const result = cleanPslg(points, edges);
    expect(points).toEqual(readmePoints);
    expect(edges).toEqual(readmeEdges);
    expect(result.points).not.toBe(points);
    expect(result.edges).not.toBe(edges);
    result.points.forEach((point, i) => expect(point).not.toBe(points[i]));
  });

  it('пересечение рёбер даёт вершину пересечения и разрезает рёбра (пример README)', () => {
    const { points, edges } = cleanPslg(readmePoints, readmeEdges);
    expect(points).toHaveLength(9);
    expect(points[8]).toEqual([0.5, 0.5]);
    // Каждое из четырёх рёбер разрезано пополам: 8 рёбер, все инцидентны новой вершине 8.
    expect(edges).toHaveLength(8);
    for (const [a, b] of edges) expect(a === 8 || b === 8).toBe(true);
    const others = edges.map(([a, b]) => (a === 8 ? b : a)).sort((x, y) => x - y);
    expect(others).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('петли `[i, i]` из выхода библиотеки отфильтрованы (README показывает `[8, 8]`)', () => {
    const { edges } = cleanPslg(readmePoints, readmeEdges);
    expect(edges.some(([a, b]) => a === b)).toBe(false);
  });

  it('петля из ребра между дублями точек — исчезает вместе с дублями', () => {
    const { points, edges } = cleanPslg(
      [
        [0, 0],
        [1, 0],
        [0, 0],
      ],
      [
        [0, 1],
        [0, 2],
      ],
    );
    expect(points).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(edges.every(([a, b]) => a !== b)).toBe(true);
    // Индексы результата — валидные, ребро соединяет две разные точки (0,0)–(1,0).
    const [edge] = edges;
    const ends = [points[edge![0]], points[edge![1]]];
    expect(ends).toEqual(
      expect.arrayContaining([
        [0, 0],
        [1, 0],
      ]),
    );
  });

  it('дубли точек и рёбер схлопываются', () => {
    const { points, edges } = cleanPslg(
      [
        [0, 0],
        [10, 0],
        [10, 0],
        [0, 0],
      ],
      [
        [0, 1],
        [3, 2],
        [1, 0],
      ],
    );
    expect(points).toHaveLength(2);
    expect(edges).toHaveLength(1);
  });

  it('T-стык: вершина другого ребра на середине ребра — ребро разрезано, новых точек нет', () => {
    const { points, edges } = cleanPslg(
      [
        [0, 0],
        [100, 0],
        [50, 0],
        [50, 50],
      ],
      [
        [0, 1],
        [2, 3],
      ],
    );
    expect(points).toHaveLength(4);
    expect(edges).toHaveLength(3);
  });

  it('чистый вход возвращается эквивалентным (без изменений структуры)', () => {
    const points: PslgPoint[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const edges: PslgEdge[] = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ];
    const result = cleanPslg(points, edges);
    expect(result.points).toEqual(points);
    expect(result.edges).toHaveLength(4);
  });

  it('пустой вход → пустой результат', () => {
    expect(cleanPslg([], [])).toEqual({ points: [], edges: [] });
  });

  it('точки без рёбер сохраняются, рёбер нет', () => {
    const result = cleanPslg(
      [
        [0, 0],
        [1, 1],
      ],
      [],
    );
    expect(result.points).toHaveLength(2);
    expect(result.edges).toEqual([]);
  });
});
