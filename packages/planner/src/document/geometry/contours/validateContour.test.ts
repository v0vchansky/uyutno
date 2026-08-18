import * as fc from 'fast-check';

import { arbConvexPolygon, fcParams } from '../testing/arbitraries';
import { MIN_CONTOUR_POINTS, MIN_WALL_LENGTH, POLYLINE_ROOM_MIN_POINTS, validateContour } from './validateContour';

const SQUARE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe('validateContour', () => {
  it('константы (спека 01)', () => {
    expect(MIN_WALL_LENGTH).toBe(15);
    expect(MIN_CONTOUR_POINTS).toBe(3);
    expect(POLYLINE_ROOM_MIN_POINTS).toBe(4);
  });

  it('обычная комната — ok (замкнутая и как открытая полилиния)', () => {
    expect(validateContour(SQUARE)).toEqual({ ok: true });
    expect(validateContour(SQUARE, { closed: false })).toEqual({ ok: true });
  });

  it('tooFewPoints: меньше minPoints; для «Комнаты по точкам» — 4', () => {
    expect(validateContour(SQUARE.slice(0, 2))).toEqual({ ok: false, reason: 'tooFewPoints' });
    expect(validateContour(SQUARE.slice(0, 3))).toEqual({ ok: true });
    expect(validateContour(SQUARE.slice(0, 3), { minPoints: POLYLINE_ROOM_MIN_POINTS })).toEqual({
      ok: false,
      reason: 'tooFewPoints',
    });
    expect(validateContour([])).toEqual({ ok: false, reason: 'tooFewPoints' });
  });

  it('duplicatePoints: две точки в одном месте (L_EPS), в т.ч. несмежные — раньше проверки рёбер', () => {
    expect(validateContour([...SQUARE, { x: 0, y: 0 }])).toEqual({ ok: false, reason: 'duplicatePoints' });
    expect(validateContour([SQUARE[0]!, SQUARE[1]!, SQUARE[1]!, SQUARE[2]!, SQUARE[3]!])).toEqual({
      ok: false,
      reason: 'duplicatePoints',
    });
    // Контур, вернувшийся в свою вершину: (50,50) дважды.
    const revisit = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 50, y: 50 },
    ];
    expect(validateContour(revisit)).toEqual({ ok: false, reason: 'duplicatePoints' });
  });

  it('shortEdge: ребро короче 15 см — отказ; ровно 15 — ok; порог включает замыкающее ребро только при closed', () => {
    const shortLast = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 10 }, // замыкающее ребро до (0,0) — 10 см
    ];
    expect(validateContour(shortLast)).toEqual({ ok: false, reason: 'shortEdge' });
    expect(validateContour(shortLast, { closed: false })).toEqual({ ok: true });
    const exact = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 15 },
    ];
    expect(validateContour(exact)).toEqual({ ok: true });
    expect(validateContour(exact.map(p => ({ ...p, y: p.y === 15 ? 14.999 : p.y })))).toEqual({
      ok: false,
      reason: 'shortEdge',
    });
  });

  it('minEdgeLength: свой порог и 0 — не проверять', () => {
    const tiny = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(validateContour(tiny)).toEqual({ ok: false, reason: 'shortEdge' });
    expect(validateContour(tiny, { minEdgeLength: 5 })).toEqual({ ok: true });
    expect(validateContour(tiny, { minEdgeLength: 0 })).toEqual({ ok: true });
  });

  it('selfIntersected: «бабочка» — отказ (замкнутая и открытая с внутренним пересечением)', () => {
    const bowtie = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(validateContour(bowtie)).toEqual({ ok: false, reason: 'selfIntersected' });
    expect(validateContour(bowtie, { closed: false })).toEqual({ ok: false, reason: 'selfIntersected' });
    // Открытая полилиния, чьё замыкание пересеклось бы, — как открытая ok.
    const hook = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 50 },
    ];
    expect(validateContour(hook)).toEqual({ ok: false, reason: 'selfIntersected' });
    expect(validateContour(hook, { closed: false })).toEqual({ ok: true });
  });

  it('degenerate: коллинеарный контур и сливер — только для closed', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ];
    expect(validateContour(line)).toEqual({ ok: false, reason: 'degenerate' });
    expect(validateContour(line, { closed: false })).toEqual({ ok: true });
    const sliver = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1.99 },
      { x: 0, y: 1.99 },
    ];
    // Ребро 1.99 см короче 15 — сначала shortEdge; с отключённым порогом — degenerate по S/P.
    expect(validateContour(sliver)).toEqual({ ok: false, reason: 'shortEdge' });
    expect(validateContour(sliver, { minEdgeLength: 0 })).toEqual({ ok: false, reason: 'degenerate' });
  });

  it('NaN во входе — отказ без исключения (NaN-ребро «короче» порога не бывает → самопересечения нет → degenerate)', () => {
    const broken = [{ x: Number.NaN, y: 0 }, ...SQUARE.slice(1)];
    expect(validateContour(broken).ok).toBe(false);
  });

  it('property: выпуклый многоугольник (без порога длины ребра) валиден', () => {
    fc.assert(
      fc.property(arbConvexPolygon, polygon => {
        const result = validateContour(polygon, { minEdgeLength: 0 });
        expect(result).toEqual({ ok: true });
      }),
      fcParams,
    );
  });
});
