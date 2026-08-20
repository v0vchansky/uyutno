import { COORDINATE_QUANTUM } from '../document/quantize';
import { coordinateKey, createPointWeld, dedupeCycle, sameArray } from './normalizeIds';

const q = COORDINATE_QUANTUM;

/** Индекс «ключ → id», какой строит `normalize` по точкам этажа. */
const index = (points: Record<string, [number, number]>): Map<string, string> =>
  new Map(Object.entries(points).map(([id, [x, y]]) => [coordinateKey({ x, y }), id]));

describe('coordinateKey', () => {
  it('тождество — квантованная координата: 0.0004 и 0 — одна точка, 0.0006 — уже другая', () => {
    expect(coordinateKey({ x: 0.0004, y: -0.0004 })).toBe(coordinateKey({ x: 0, y: 0 }));
    expect(coordinateKey({ x: 0.0006, y: 0 })).not.toBe(coordinateKey({ x: 0, y: 0 }));
  });
});

describe('dedupeCycle', () => {
  it('схлопывает подряд идущие дубли, в том числе на замыкании петли', () => {
    expect(dedupeCycle(['a', 'a', 'b', 'b', 'c', 'a'])).toEqual(['a', 'b', 'c']);
    expect(dedupeCycle(['a', 'b', 'a', 'b'])).toEqual(['a', 'b', 'a', 'b']);
    expect(dedupeCycle(['a', 'a', 'a'])).toEqual(['a']);
    expect(dedupeCycle([])).toEqual([]);
  });
});

describe('sameArray', () => {
  it('поэлементно по ссылке: равные по значению, но разные объекты — не «то же самое»', () => {
    const item = { id: 'a' };
    expect(sameArray([item], [item])).toBe(true);
    expect(sameArray([item], [{ id: 'a' }])).toBe(false);
    expect(sameArray([item], [item, item])).toBe(false);
    expect(sameArray([], [])).toBe(true);
  });
});

describe('createPointWeld (ADR 0016 B4, ADR 0017 C1)', () => {
  it('точное совпадение ключа: координата квантуется, точка этажа переиспользуется', () => {
    const weld = createPointWeld(index({ p1: [10, 20] }));
    expect(weld({ x: 10.0001, y: 19.9999 })).toEqual({ x: 10, y: 20 });
  });

  it('в пределах кванта по каждой оси: вершина берёт координату существующей точки', () => {
    const weld = createPointWeld(index({ p1: [174.009, -492.579] }));
    // Ровно тот дрейф, из-за которого `normalize` переставал быть идемпотентным: пересечение,
    // посчитанное триангуляцией полов, отличается от угла комнаты на квант по каждой оси.
    expect(weld({ x: 174.01, y: -492.578 })).toEqual({ x: 174.009, y: -492.579 });
    expect(weld({ x: 174.008, y: -492.58 })).toEqual({ x: 174.009, y: -492.579 });
  });

  it('дальше кванта хоть по одной оси — своя новая точка, только квантование', () => {
    const weld = createPointWeld(index({ p1: [0, 0] }));
    expect(weld({ x: 2 * q, y: 0 })).toEqual({ x: 2 * q, y: 0 });
    expect(weld({ x: q, y: 2 * q })).toEqual({ x: q, y: 2 * q });
  });

  it('без кандидатов — квантованный вход как есть', () => {
    const weld = createPointWeld(new Map());
    expect(weld({ x: 1.23456, y: -7.65432 })).toEqual({ x: 1.235, y: -7.654 });
  });

  it('несколько кандидатов в радиусе: выигрывает наименьший id — правило детерминировано', () => {
    const points = { b: [q, 0] as [number, number], a: [-q, 0] as [number, number] };
    expect(createPointWeld(index(points))({ x: 0, y: 0 })).toEqual({ x: -q, y: 0 });
    // Порядок вставки в индекс на результат не влияет.
    expect(createPointWeld(index({ a: points.a, b: points.b }))({ x: 0, y: 0 })).toEqual({ x: -q, y: 0 });
  });

  it('точное совпадение сильнее соседа с меньшим id', () => {
    const weld = createPointWeld(index({ a: [-q, 0], z: [0, 0] }));
    expect(weld({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('идемпотентность: повторное приваривание уже приваренной координаты ничего не меняет', () => {
    const weld = createPointWeld(index({ p1: [5, 5] }));
    const once = weld({ x: 5 + q, y: 5 - q });
    expect(weld(once)).toEqual(once);
  });

  it('индекс живой: точка, зарегистрированная по ходу normalize, сразу становится кандидатом', () => {
    const idByKey = index({ p1: [0, 0] });
    const weld = createPointWeld(idByKey);
    expect(weld({ x: 100 + q, y: 100 })).toEqual({ x: 100 + q, y: 100 });
    idByKey.set(coordinateKey({ x: 100, y: 100 }), 'n1');
    expect(weld({ x: 100 + q, y: 100 })).toEqual({ x: 100, y: 100 });
  });
});
