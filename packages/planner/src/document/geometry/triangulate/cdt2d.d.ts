/**
 * Типы `cdt2d@1.0.0` (ADR 0017 C2): пакет CJS без типов, `@types/cdt2d` не существует — объявление своё,
 * подключается из обёртки `triangulateContours.ts` через `/// <reference path>`, чтобы попадать в программу
 * любого потребителя пакета (платформа компилирует исходники планера напрямую, ADR 0015).
 */
declare module 'cdt2d' {
  /** Вершина `[x, y]`. */
  export type Cdt2dPoint = [number, number];
  /** Ребро-ограничение по индексам вершин. */
  export type Cdt2dEdge = [number, number];
  /** Треугольник по индексам вершин. */
  export type Cdt2dTriangle = [number, number, number];

  export interface Cdt2dOptions {
    /** Довести до Делоне флипами (дефолт `true`). */
    delaunay?: boolean;
    /** Вернуть внутренние грани (дефолт `true`). */
    interior?: boolean;
    /** Вернуть внешние грани (дефолт `true`) — полная триангуляция выпуклой оболочки. */
    exterior?: boolean;
    /** Добавить точку на бесконечности с индексом `-1` (дефолт `false`). */
    infinity?: boolean;
  }

  /**
   * Constrained Delaunay triangulation of a PSLG. Вход должен быть чистым (без пересечений рёбер и T-стыков) —
   * `clean-pslg` обязателен (спайк 0051: на грязном входе молча теряет ограничения).
   */
  function cdt2d(points: readonly Cdt2dPoint[], edges?: readonly Cdt2dEdge[], options?: Cdt2dOptions): Cdt2dTriangle[];

  export default cdt2d;
}
