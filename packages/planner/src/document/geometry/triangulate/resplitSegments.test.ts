import type { PslgEdge, PslgPoint } from './cleanPslg';
import { resplitSegments } from './resplitSegments';

const sortedPairs = (edges: readonly PslgEdge[]): PslgEdge[] =>
  edges.map(([a, b]): PslgEdge => (a < b ? [a, b] : [b, a])).sort((x, y) => x[0] - y[0] || x[1] - y[1]);

describe('resplitSegments', () => {
  it('два перекрывающихся коллинеарных вертикальных ребра → три единичных ребра с общими вершинами', () => {
    const points: PslgPoint[] = [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ];
    const result = resplitSegments(points, [
      [0, 2],
      [1, 3],
    ]);
    expect(result).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it('T-стык коллинеарных горизонталей: конец второго ребра внутри первого → первое разрезано в этой вершине', () => {
    const points: PslgPoint[] = [
      [0, 0],
      [100, 0],
      [50, 0],
      [150, 0],
    ];
    const result = resplitSegments(points, [
      [0, 1],
      [2, 3],
    ]);
    expect(result).toEqual([
      [0, 2],
      [2, 1],
      [1, 3],
    ]);
  });

  it('перпендикулярный T-стык (вершина вертикали на горизонтали) НЕ режется здесь — это работа clean-pslg', () => {
    // Вершина 2 = (50, 0) принадлежит только вертикальной группе, горизонталь 0–1 остаётся целой.
    const points: PslgPoint[] = [
      [0, 0],
      [100, 0],
      [50, 0],
      [50, 50],
    ];
    const result = resplitSegments(points, [
      [0, 1],
      [2, 3],
    ]);
    // Вертикальные группы идут раньше горизонтальных.
    expect(result).toEqual([
      [2, 3],
      [0, 1],
    ]);
  });

  it('разрыв между коллинеарными рёбрами на одной оси остаётся разрывом — мостика нет', () => {
    const points: PslgPoint[] = [
      [0, 0],
      [10, 0],
      [20, 0],
      [30, 0],
    ];
    const result = resplitSegments(points, [
      [0, 1],
      [2, 3],
    ]);
    expect(sortedPairs(result)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('диагональные рёбра проходят без изменений и идут первыми в выходе', () => {
    const points: PslgPoint[] = [
      [0, 0],
      [10, 10],
      [0, 5],
      [0, 20],
      [0, 10],
      [0, 30],
    ];
    const result = resplitSegments(points, [
      [4, 5],
      [0, 1],
      [2, 3],
    ]);
    expect(result[0]).toEqual([0, 1]);
    expect(result).toEqual([
      [0, 1],
      [2, 4],
      [4, 3],
      [3, 5],
    ]);
  });

  it('копии рёбер, а не ссылки на вход', () => {
    const points: PslgPoint[] = [
      [0, 0],
      [10, 10],
      [0, 5],
      [0, 20],
    ];
    const edges: PslgEdge[] = [
      [0, 1],
      [2, 3],
    ];
    const result = resplitSegments(points, edges);
    expect(result).toEqual(edges);
    result.forEach((edge, i) => expect(edge).not.toBe(edges[i]));
  });

  it('разные осевые линии — разные группы: перекрытие по оси между линиями не смешивается', () => {
    const points: PslgPoint[] = [
      [0, 0],
      [0, 10],
      [5, 5],
      [5, 15],
    ];
    const result = resplitSegments(points, [
      [0, 1],
      [2, 3],
    ]);
    expect(sortedPairs(result)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('новых точек не появляется: все индексы < points.length', () => {
    const points: PslgPoint[] = [
      [0, 0],
      [100, 0],
      [50, 0],
      [50, 50],
      [25, 0],
      [75, 0],
    ];
    const result = resplitSegments(points, [
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
    for (const [a, b] of result) {
      expect(a).toBeLessThan(points.length);
      expect(b).toBeLessThan(points.length);
      expect(a).not.toBe(b);
    }
    // Вершина 2 (конец вертикали) в горизонтальную группу не входит: горизонталь режется только в 4 и 5.
    expect(sortedPairs(result)).toEqual([
      [0, 4],
      [1, 5],
      [2, 3],
      [4, 5],
    ]);
  });

  it('детерминизм: повторный вызов даёт равные массивы', () => {
    const points: PslgPoint[] = [
      [0, 0],
      [100, 0],
      [50, 0],
      [50, 50],
      [25, 0],
      [75, 0],
      [3, 3],
      [7, 9],
    ];
    const edges: PslgEdge[] = [
      [0, 1],
      [2, 3],
      [6, 7],
      [4, 5],
    ];
    expect(resplitSegments(points, edges)).toEqual(resplitSegments(points, edges));
  });

  it('обратный порядок концов ребра ([b, a]) даёт тот же результат, что [a, b]', () => {
    const points: PslgPoint[] = [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ];
    const forward = resplitSegments(points, [
      [0, 2],
      [1, 3],
    ]);
    const reversed = resplitSegments(points, [
      [2, 0],
      [3, 1],
    ]);
    expect(reversed).toEqual(forward);
  });

  it('порядок рёбер во входе не влияет на рёбра группы (сортировка вдоль оси)', () => {
    const points: PslgPoint[] = [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ];
    expect(
      resplitSegments(points, [
        [1, 3],
        [0, 2],
      ]),
    ).toEqual(
      resplitSegments(points, [
        [0, 2],
        [1, 3],
      ]),
    );
  });

  it('пустой вход → []', () => {
    expect(resplitSegments([], [])).toEqual([]);
    expect(resplitSegments([[0, 0]], [])).toEqual([]);
  });

  it('одиночное осевое ребро возвращается с концами, упорядоченными вдоль оси', () => {
    expect(
      resplitSegments(
        [
          [0, 0],
          [10, 0],
        ],
        [[1, 0]],
      ),
    ).toEqual([[0, 1]]);
  });

  it('вертикальные и горизонтальные группы: порядок — первое появление группы во входе', () => {
    const points: PslgPoint[] = [
      [0, 0],
      [0, 10],
      [5, 0],
      [5, 10],
      [0, 20],
      [10, 20],
      [0, 30],
      [10, 30],
    ];
    const result = resplitSegments(points, [
      [6, 7],
      [2, 3],
      [4, 5],
      [0, 1],
    ]);
    // Вертикали: x=5 (первая), затем x=0; горизонтали: y=30, затем y=20.
    expect(result).toEqual([
      [2, 3],
      [0, 1],
      [6, 7],
      [4, 5],
    ]);
  });
});
