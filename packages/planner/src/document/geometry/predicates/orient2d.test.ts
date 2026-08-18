import * as fc from 'fast-check';
import { orient2d as robustOrient2d } from 'robust-predicates';

import { arbPoint, fcParams } from '../testing/arbitraries';
import { orient2d, orientationSign } from './orient2d';

const O = { x: 0, y: 0 };
const X = { x: 1, y: 0 };
const Y = { x: 0, y: 1 };

describe('orient2d', () => {
  it('знак по конвенции ядра: > 0 — против часовой при y вверх (ADR 0017 C2, тест обязателен)', () => {
    expect(orient2d(O, X, Y)).toBeGreaterThan(0);
    expect(orient2d(O, Y, X)).toBeLessThan(0);
    expect(orient2d({ x: 3, y: 3 }, { x: 5, y: 3 }, { x: 4, y: 7 })).toBeGreaterThan(0);
  });

  it('совпадает с наивным (b − a) × (c − a) на простых входах и равен удвоенной площади', () => {
    expect(orient2d(O, X, Y)).toBe(1);
    expect(orient2d(O, { x: 2, y: 0 }, { x: 0, y: 3 })).toBe(6);
    expect(orient2d({ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 0, y: 1 })).toBe(4);
  });

  it('знак библиотеки противоположен наивному — обёртка инвертирует (верифицировано спайком 0051)', () => {
    expect(robustOrient2d(0, 0, 1, 0, 0, 1)).toBe(-1);
    expect(orient2d(O, X, Y)).toBe(1);
  });

  it('коллинеарные тройки — точный ноль (не -0), включая совпадающие точки', () => {
    expect(orient2d(O, X, { x: 2, y: 0 })).toBe(0);
    expect(Object.is(orient2d(O, X, { x: 2, y: 0 }), 0)).toBe(true);
    expect(orient2d(O, O, X)).toBe(0);
    expect(orient2d(O, O, O)).toBe(0);
    expect(orient2d({ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 })).toBe(0);
  });

  it('устойчив там, где наивный cross ошибается (почти коллинеарные тройки с хвостами float)', () => {
    // Классический пример: наивный cross даёт ненулевой шум противоположного знака или 0.
    const a = { x: 0.1, y: 0.1 };
    const b = { x: 0.2, y: 0.2 };
    const c = { x: 0.3, y: 0.3 };
    expect(orient2d(a, b, c)).toBe(0);
    const d = { x: 0.30000000000000004, y: 0.3 };
    expect(orient2d(a, b, d)).toBeLessThan(0);
  });

  it('property: знак антисимметричен к перестановке двух точек и инвариантен к циклическому сдвигу', () => {
    // Гарантия библиотеки — точный знак, а не бит-в-бит величина (у денормалов хвосты различаются).
    fc.assert(
      fc.property(arbPoint, arbPoint, arbPoint, (a, b, c) => {
        const abc = orientationSign(a, b, c);
        expect(orientationSign(b, c, a)).toBe(abc);
        expect(orientationSign(c, a, b)).toBe(abc);
        expect(orientationSign(a, c, b)).toBe(0 - abc);
        expect(Number.isNaN(orient2d(a, b, c))).toBe(false);
      }),
      fcParams,
    );
  });

  it('NaN во входе — NaN (валидацию делает команда фасада), знак → 0', () => {
    expect(orient2d({ x: Number.NaN, y: 0 }, X, Y)).toBeNaN();
    expect(orientationSign({ x: Number.NaN, y: 0 }, X, Y)).toBe(0);
  });
});

describe('orientationSign', () => {
  it('1 / -1 / 0', () => {
    expect(orientationSign(O, X, Y)).toBe(1);
    expect(orientationSign(O, Y, X)).toBe(-1);
    expect(orientationSign(O, X, { x: 5, y: 0 })).toBe(0);
  });
});
