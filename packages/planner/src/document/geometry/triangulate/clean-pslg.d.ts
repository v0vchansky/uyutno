/**
 * Типы `clean-pslg@1.1.2` (ADR 0017 C2): CJS без типов, `@types/clean-pslg` не существует — объявление своё,
 * подключается из обёртки `cleanPslg.ts` через `/// <reference path>` (см. `cdt2d.d.ts`).
 */
declare module 'clean-pslg' {
  /**
   * Санитизация PSLG итеративным snap rounding: пересечения рёбер и T-стыки → общие вершины, дубли
   * вершин/рёбер сливаются. **Мутирует `points`/`edges` на месте**, возвращает `true`, если что-то менялось;
   * в `edges` могут остаться петли `[i, i]` (спайк 0051) — их фильтрует обёртка.
   */
  function cleanPSLG(points: [number, number][], edges: [number, number][], colors?: unknown[]): boolean;

  export default cleanPSLG;
}
