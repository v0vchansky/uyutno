import type { Id } from '../document/id';
import type { PlanPosition } from '../document/PlannerDocument';
import { COORDINATE_QUANTUM, quantize } from '../document/quantize';

/**
 * Общие кирпичи дисциплины id нормализации (ADR 0017 C1) — то, чем фазы (1)–(6) `normalize` пользуются
 * одинаково: ключ тождества квантованной координаты, схлопывание дублей в петле и поэлементное сравнение
 * массивов, на котором держится «в черновик пишем только фактическое изменение» (и, следовательно,
 * идемпотентность `normalize` по ссылке — ADR 0018 D3).
 */

/** Ключ квантованной координаты — тождество точек (ADR 0017 C1/C3), тот же, что у `areaSupported`. */
export const coordinateKey = (position: PlanPosition): string => `${quantize(position.x)}|${quantize(position.y)}`;

/** Схлопывание подряд идущих одинаковых id (в том числе на замыкании) — две вершины квантовались в одну точку. */
export const dedupeCycle = (ids: readonly Id[]): Id[] => {
  const result: Id[] = [];
  for (const id of ids) {
    if (result[result.length - 1] !== id) result.push(id);
  }
  while (result.length > 1 && result[0] === result[result.length - 1]) result.pop();
  return result;
};

/** Поэлементное равенство по ссылке: «набор не изменился» → узел черновика не переписываем. */
export const sameArray = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/** Приваривание координаты к существующей точке этажа — см. `createPointWeld`. */
export type WeldPoint = (position: PlanPosition) => PlanPosition;

/** Смещения соседних клеток решётки квантования — ровно «в пределах одного кванта по каждой оси». */
const NEIGHBOUR_STEPS = [-COORDINATE_QUANTUM, 0, COORDINATE_QUANTUM] as const;

/**
 * Приваривание вершины к уже существующей точке этажа: если в пределах **одного кванта** по каждой оси
 * (0.001 см, ADR 0016 B1) точка уже есть, вершина берёт её координату — и, следовательно, через `idOf` её id.
 *
 * **Зачем это полам и зонам и не нужно контурам.** Вершины контуров приходят из одной триангуляции
 * (`rebuildContours` по хранимым `outer`/`inner`), поэтому тождество квантованного ключа их и опознаёт.
 * Полы же строятся **другой** триангуляцией — со своими `bound`/`subtract` (`rebuildCovers`, `findAutoCovers`,
 * `mergeCovers`), где точки пересечений считает `clean-pslg` на другом наборе отрезков. Один и тот же по
 * смыслу угол получает там координату, отличающуюся от угла комнаты на квант; на следующем прогоне
 * `normalize` эта вершина сама идёт во вход и даёт новый сдвиг — то есть `normalize` перестаёт быть
 * идемпотентным (ADR 0018 D3), на чём держится restore undo/redo. Приваривание закрывает ровно это и
 * заодно буквально выполняет ADR 0016 B4: «полы и зоны, приваренные к углу комнаты, ссылаются на тот же id —
 * угол пола едет за углом стены».
 *
 * **Детерминированность.** Точное совпадение ключа выигрывает всегда; среди восьми соседних клеток берётся
 * точка с **наименьшим id** (при uuidv7 — старшая по времени, то есть та, к которой уже привязано больше
 * всего). Порядок обхода клеток на результат не влияет, и повторный прогон на том же наборе точек даёт то же.
 *
 * Индекс `idByKey` — живой: `idOf` регистрирует в нём новые точки по ходу `normalize`, поэтому вершина пола
 * приваривается и к точке, заведённой контуром или зоной на этом же прогоне. Функция идемпотентна по
 * значению (`weld(weld(p))` равно `weld(p)`: координата приваренной точки — уже точный ключ) и вход не мутирует.
 */
export const createPointWeld =
  (idByKey: ReadonlyMap<string, Id>): WeldPoint =>
  position => {
    const x = quantize(position.x);
    const y = quantize(position.y);
    if (idByKey.has(`${x}|${y}`)) return { x, y };
    let best: { id: Id; x: number; y: number } | null = null;
    for (const dx of NEIGHBOUR_STEPS) {
      for (const dy of NEIGHBOUR_STEPS) {
        if (dx === 0 && dy === 0) continue;
        const cx = quantize(x + dx);
        const cy = quantize(y + dy);
        const id = idByKey.get(`${cx}|${cy}`);
        if (id !== undefined && (best === null || id < best.id)) best = { id, x: cx, y: cy };
      }
    }
    return best === null ? { x, y } : { x: best.x, y: best.y };
  };
