import * as fc from 'fast-check';

import { arbContour, arbConvexPolygon, fcParams } from '../testing/arbitraries';
import { MIN_CONTOUR_AREA, MIN_SP_RATIO, contourArea, contourPerim, contourValid } from './contourArea';

const SQUARE_CCW = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];
const SQUARE_CW = [...SQUARE_CCW].reverse();

describe('contourArea', () => {
  it('знаковая: против часовой (y вверх) > 0, по часовой < 0 — конвенция ядра, не референса', () => {
    expect(contourArea(SQUARE_CCW)).toBe(100);
    expect(contourArea(SQUARE_CW)).toBe(-100);
  });

  it('невыпуклый контур, отрицательные координаты, циклический сдвиг не меняет площадь', () => {
    const l = [
      { x: -10, y: -10 },
      { x: 10, y: -10 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: -10, y: 10 },
    ];
    expect(contourArea(l)).toBe(300);
    expect(contourArea([...l.slice(2), ...l.slice(0, 2)])).toBe(300);
  });

  it('вырожденные: < 3 точек — 0; коллинеарные — 0; треугольник', () => {
    expect(contourArea([])).toBe(0);
    expect(
      contourArea([
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ]),
    ).toBe(0);
    expect(
      contourArea([
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 10 },
      ]),
    ).toBe(0);
    expect(
      contourArea([
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 0, y: 3 },
      ]),
    ).toBe(6);
  });

  it('property: реверс меняет знак, выпуклый CCW-многоугольник — площадь > 0', () => {
    fc.assert(
      fc.property(arbContour, contour => {
        expect(contourArea([...contour].reverse())).toBeCloseTo(-contourArea(contour), 6);
      }),
      fcParams,
    );
    fc.assert(
      fc.property(arbConvexPolygon, polygon => {
        expect(contourArea(polygon)).toBeGreaterThan(0);
      }),
      fcParams,
    );
  });
});

describe('contourPerim', () => {
  it('сумма рёбер с замыкающим; < 2 точек — 0; две точки — туда-обратно', () => {
    expect(contourPerim(SQUARE_CCW)).toBe(40);
    expect(contourPerim([])).toBe(0);
    expect(contourPerim([{ x: 0, y: 0 }])).toBe(0);
    expect(
      contourPerim([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ]),
    ).toBe(10);
  });
});

describe('contourValid', () => {
  it('константы (ADR 0017 C3)', () => {
    expect(MIN_CONTOUR_AREA).toBe(50);
    expect(MIN_SP_RATIO).toBe(1);
  });

  it('обычная комната — валидна; ориентация не важна', () => {
    expect(contourValid(SQUARE_CCW)).toBe(true);
    expect(contourValid(SQUARE_CW)).toBe(true);
  });

  it('порог площади: 50 см² — да, чуть меньше — нет (квадрат √50 — S/P = √50/4 > 1)', () => {
    const side = Math.sqrt(50);
    const square = (s: number) => [
      { x: 0, y: 0 },
      { x: s, y: 0 },
      { x: s, y: s },
      { x: 0, y: s },
    ];
    expect(contourValid(square(side + 1e-6))).toBe(true);
    expect(contourValid(square(side - 1e-6))).toBe(false);
  });

  it('порог S/P: длинный узкий контур с большой площадью, но отношением < 1 — сливер', () => {
    // 1000 × 1.99: площадь 1990, периметр 2003.98 → отношение < 1.
    const sliver = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1.99 },
      { x: 0, y: 1.99 },
    ];
    expect(contourValid(sliver)).toBe(false);
    // 1000 × 2.01: 2010 / 2004.02 > 1.
    const ok = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 2.01 },
      { x: 0, y: 2.01 },
    ];
    expect(contourValid(ok)).toBe(true);
  });

  it('вырожденные: пусто, коллинеарные, дубли — невалидны без NaN', () => {
    expect(contourValid([])).toBe(false);
    expect(
      contourValid([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 },
      ]),
    ).toBe(false);
    expect(
      contourValid([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ]),
    ).toBe(false);
  });
});
