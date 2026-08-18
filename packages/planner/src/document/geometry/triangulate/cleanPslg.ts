// Ambient-объявление `clean-pslg` (свой `.d.ts` рядом, `@types/*` нет — ADR 0017 C2) подключается triple-slash, а не
// `import`: файл — не модуль, а `import` его не втянет; так объявление попадает в программу любого потребителя
// (платформа компилирует исходники планера напрямую), а не только в tsconfig пакета.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./clean-pslg.d.ts" />
import cleanPSLG from 'clean-pslg';

/** Вершина PSLG `[x, y]` и ребро по индексам вершин — формат `clean-pslg`/`cdt2d`. */
export type PslgPoint = [number, number];
export type PslgEdge = [number, number];

export interface Pslg {
  points: PslgPoint[];
  edges: PslgEdge[];
}

/**
 * Чистая обёртка над `clean-pslg` (ADR 0017 C2/C6): библиотека мутирует вход на месте — здесь вход копируется,
 * а из результата отфильтровываются вырожденные петли `[i, i]`, которые библиотека оставляет после разрезания
 * рёбер в собственной вершине (спайк 0051). Индексы вершин результата **не** соответствуют входным: при
 * слиянии дублей библиотека переиндексирует массив, точки пересечений добавляются в конец — вызывающий
 * маппит вершины по координатам, не по индексам. Точки пересечений — ближайшие float к точным рациональным.
 */
export const cleanPslg = (points: readonly Readonly<PslgPoint>[], edges: readonly Readonly<PslgEdge>[]): Pslg => {
  const pointsCopy: PslgPoint[] = points.map(([x, y]) => [x, y]);
  const edgesCopy: PslgEdge[] = edges.map(([a, b]) => [a, b]);
  cleanPSLG(pointsCopy, edgesCopy);
  return { points: pointsCopy, edges: edgesCopy.filter(([a, b]) => a !== b) };
};
