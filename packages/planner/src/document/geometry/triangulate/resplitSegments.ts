import { L_EPS } from '../predicates/pointsMatch';
import type { PslgEdge, PslgPoint } from './cleanPslg';

/**
 * Пересборка коллинеарных **осевых** рёбер (ADR 0017 C6, `resplitSegments` референса): рёбра, лежащие на одной
 * вертикали (`|Δx| < L_EPS`) или горизонтали (`|Δy| < L_EPS`), группируются по координате оси; внутри группы
 * концы сортируются вдоль оси, покрытые хотя бы одним ребром промежутки между соседними концами
 * переиздаются по одному ребру на промежуток. Так перекрывающиеся стены и T-стыки на осевых линиях получают
 * общие вершины **бит-в-бит** без вычисления пересечений (в дополнение к `clean-pslg`, который закрывает
 * общий/диагональный случай). Диагональные рёбра проходят без изменений; новых вершин не появляется.
 *
 * Группировка — hash-map по квантованной координате оси (вход квантован до 0.001, ADR 0016 B1), не O(n²)
 * перебор референса. Порядок выхода: диагональные, затем вертикальные группы, затем горизонтальные —
 * детерминирован порядком первого появления группы. Рёбра нулевой длины на входе не ожидаются
 * (их отсеивает дедуп `triangulateContours`).
 */
export const resplitSegments = (
  points: readonly Readonly<PslgPoint>[],
  edges: readonly Readonly<PslgEdge>[],
): PslgEdge[] => {
  const vertical = new Map<number, PslgEdge[]>();
  const horizontal = new Map<number, PslgEdge[]>();
  const diagonal: PslgEdge[] = [];

  for (const edge of edges) {
    const a = points[edge[0]]!;
    const b = points[edge[1]]!;
    if (Math.abs(a[0] - b[0]) < L_EPS) {
      pushGroup(vertical, a[0], edge);
    } else if (Math.abs(a[1] - b[1]) < L_EPS) {
      pushGroup(horizontal, a[1], edge);
    } else {
      diagonal.push([edge[0], edge[1]]);
    }
  }

  const result = diagonal;
  for (const group of vertical.values()) result.push(...rebuildGroup(points, group, 1));
  for (const group of horizontal.values()) result.push(...rebuildGroup(points, group, 0));
  return result;
};

/** Ключ группы — координата оси как есть: вход квантован, `Map` сравнивает по SameValueZero (`-0` = `0`). */
const pushGroup = (groups: Map<number, PslgEdge[]>, key: number, edge: Readonly<PslgEdge>): void => {
  const group = groups.get(key);
  const copy: PslgEdge = [edge[0], edge[1]];
  if (group) group.push(copy);
  else groups.set(key, [copy]);
};

/** Одна группа коллинеарных осевых рёбер → рёбра по покрытым промежуткам между отсортированными концами. */
const rebuildGroup = (points: readonly Readonly<PslgPoint>[], group: PslgEdge[], axis: 0 | 1): PslgEdge[] => {
  const indices: number[] = [];
  const seen = new Set<number>();
  for (const [a, b] of group) {
    if (!seen.has(a)) {
      seen.add(a);
      indices.push(a);
    }
    if (!seen.has(b)) {
      seen.add(b);
      indices.push(b);
    }
  }
  // Сортировка вдоль оси; при равной координате — по индексу, чтобы порядок не зависел от порядка входа.
  indices.sort((i, j) => points[i]![axis] - points[j]![axis] || i - j);
  const position = new Map<number, number>();
  indices.forEach((index, order) => position.set(index, order));

  const covered = new Array<boolean>(Math.max(indices.length - 1, 0)).fill(false);
  for (const [a, b] of group) {
    const from = Math.min(position.get(a)!, position.get(b)!);
    const to = Math.max(position.get(a)!, position.get(b)!);
    for (let k = from; k < to; k++) covered[k] = true;
  }

  const result: PslgEdge[] = [];
  for (let k = 0; k < covered.length; k++) {
    if (covered[k]) result.push([indices[k]!, indices[k + 1]!]);
  }
  return result;
};
