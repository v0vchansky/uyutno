import * as fc from 'fast-check';

import type { PlanPosition } from '../../PlannerDocument';
import { quantize } from '../../quantize';
import { manhDist } from '../predicates/distance';
import { arbQuantizedPoint, fcParams } from '../testing/arbitraries';
import type { Viewport } from '../viewport';
import type { SnapCandidate } from './candidates';
import { ORTHO_FIRST_ID, ORTHO_LAST_ID } from './orthogonalSnap';
import {
  DEFAULT_SNAP_FLAGS,
  getSnapPoint,
  POINT_SNAP_OFF_RADIUS,
  SNAP_DIST,
  type SnapFlags,
  type SnapParams,
} from './getSnapPoint';

const c = (id: string, x: number, y: number, prev?: PlanPosition, next?: PlanPosition): SnapCandidate => {
  const candidate: SnapCandidate = { id, x, y };
  if (prev) candidate.prev = prev;
  if (next) candidate.next = next;
  return candidate;
};

/** Базовый зум: 1 px = 1 см, канвас 1000×1000 → видимый bbox ±500 см вокруг нуля. */
const viewport: Viewport = { scale: 1, center: { x: 0, y: 0 }, width: 1000, height: 1000 };
const snapDist = 10;

const flags = (patch: Partial<SnapFlags> = {}): SnapFlags => ({ ...DEFAULT_SNAP_FLAGS, ...patch });
const params = (patch: Partial<SnapParams> = {}): SnapParams => ({ snapDist, viewport, flags: flags(), ...patch });

/** Угол `O(0, 0)` с соседями по осям — биссектриса `y = x`. */
const cornerO = c('O', 0, 0, { x: 100, y: 0 }, { x: 0, y: 100 });
/** Вертикаль `x = 50` (точка далеко по y — сама не снапится). */
const vertical50 = c('V', 50, 300);
/** Горизонталь `y = 50`. */
const horizontal50 = c('H', 300, 50);

describe('getSnapPoint — константы', () => {
  it('SNAP_DIST = 10 px, радиус угла при pointsSnap=off — 2 см, дефолты флагов on/on/off/on (спека 01)', () => {
    expect(SNAP_DIST).toBe(10);
    expect(POINT_SNAP_OFF_RADIUS).toBe(2);
    expect(DEFAULT_SNAP_FLAGS).toEqual({ pointsSnap: true, pointsAlign: true, orthoAlign: false, bisectorAlign: true });
    expect(Object.isFrozen(DEFAULT_SNAP_FLAGS)).toBe(true);
  });
});

describe('getSnapPoint — ветка 1: угол', () => {
  const A = c('A', 100, 100);
  const pointOnly = params({ flags: flags({ pointsAlign: false, bisectorAlign: false }) });

  it('манхэттен < snapDist — снап к углу, hit point с id', () => {
    const res = getSnapPoint({ x: 104, y: 105.999 }, [A], pointOnly);
    expect(res.snapped).toEqual({ x: 100, y: 100 });
    expect(res.hit).toEqual({ kind: 'point', id: 'A' });
  });

  it('ровно snapDist по манхэттену — не угол (строгое <), 10.001 — тоже нет', () => {
    expect(getSnapPoint({ x: 105, y: 105 }, [A], pointOnly).hit).toEqual({ kind: 'none' });
    expect(getSnapPoint({ x: 105.001, y: 105 }, [A], pointOnly).hit).toEqual({ kind: 'none' });
  });

  it('евклидово близко, но манхэттен ≥ snapDist — не снапит (зона захвата — ромб)', () => {
    // hypot(7, 7) ≈ 9.9 < 10, манхэттен 14.
    expect(getSnapPoint({ x: 107, y: 107 }, [A], pointOnly).hit).toEqual({ kind: 'none' });
  });

  it('угол побеждает всё: и крест, и биссектрису', () => {
    const res = getSnapPoint({ x: 3, y: 4 }, [cornerO, vertical50, horizontal50], params());
    expect(res.hit).toEqual({ kind: 'point', id: 'O' });
    expect(res.snapped).toEqual({ x: 0, y: 0 });
    expect(res.bisAnchor).toBeNull();
  });

  it('pointsSnap=off: радиус сжимается до 2 см — 2 (включительно) снапит, 2.001 нет', () => {
    const off = params({ flags: flags({ pointsSnap: false, pointsAlign: false, bisectorAlign: false }) });
    expect(getSnapPoint({ x: 101, y: 101 }, [A], off).hit).toEqual({ kind: 'point', id: 'A' });
    expect(getSnapPoint({ x: 101, y: 101.001 }, [A], off).hit).toEqual({ kind: 'none' });
    // Между 2 и snapDist при on — угол; при off — уже нет.
    expect(getSnapPoint({ x: 103, y: 103 }, [A], off).hit).toEqual({ kind: 'none' });
    expect(getSnapPoint({ x: 103, y: 103 }, [A], pointOnly).hit).toEqual({ kind: 'point', id: 'A' });
  });

  it('pointsSnap=off и snapDist < 2: эффективный радиус — min(2, snapDist) (найден в 2, но не принят по snapDist)', () => {
    const off = params({ snapDist: 1, flags: flags({ pointsSnap: false, pointsAlign: false, bisectorAlign: false }) });
    expect(getSnapPoint({ x: 100.75, y: 100.75 }, [A], off).hit).toEqual({ kind: 'none' });
    expect(getSnapPoint({ x: 100.25, y: 100.25 }, [A], off).hit).toEqual({ kind: 'point', id: 'A' });
  });

  it('две вершины с одинаковыми координатами — побеждает первая по порядку', () => {
    const res = getSnapPoint({ x: 101, y: 101 }, [c('B', 100, 100), A], pointOnly);
    expect(res.hit).toEqual({ kind: 'point', id: 'B' });
  });
});

describe('getSnapPoint — ветка 2: крест', () => {
  it('вертикаль одной точки ∩ горизонталь другой; угол не задействован', () => {
    const res = getSnapPoint({ x: 95, y: 96 }, [c('A', 100, 0), c('B', 0, 100)], params());
    expect(res.snapped).toEqual({ x: 100, y: 100 });
    expect(res.hit).toEqual({ kind: 'cross' });
    expect(res.alignerX?.id).toBe('A');
    expect(res.alignerY?.id).toBe('B');
    expect(res.bisAnchor).toBeNull();
  });

  it('крест приоритетнее биссектрисы: aligners X и Y есть → биссектриса не рассматривается', () => {
    const res = getSnapPoint({ x: 46, y: 47 }, [cornerO, vertical50, horizontal50], params());
    expect(res.hit).toEqual({ kind: 'cross' });
    expect(res.snapped).toEqual({ x: 50, y: 50 });
    expect(res.bisAnchor).toBeNull();
  });
});

describe('getSnapPoint — ветки 3/4: биссектриса ∩ ось', () => {
  it('3: биссектриса y=x ∩ вертикаль x=50 → (50, 50), bisAnchor = угол, hit bisector-axis x', () => {
    const res = getSnapPoint({ x: 46, y: 50 }, [cornerO, vertical50], params());
    expect(res.snapped).toEqual({ x: 50, y: 50 });
    expect(res.hit).toEqual({ kind: 'bisector-axis', axis: 'x' });
    expect(res.bisAnchor?.id).toBe('O');
    expect(res.alignerX?.id).toBe('V');
    expect(res.alignerY).toBeNull();
  });

  it('3: пересечение дальше snapDist по манхэттену — откат на одноосевой pointPt (hit axis x, без bisAnchor)', () => {
    // (46, 40) → пересечение (50, 50): манхэттен 4 + 10 = 14 ≥ 10.
    const res = getSnapPoint({ x: 46, y: 40 }, [cornerO, vertical50], params());
    expect(res.snapped).toEqual({ x: 50, y: 40 });
    expect(res.hit).toEqual({ kind: 'axis', axis: 'x' });
    expect(res.bisAnchor).toBeNull();
  });

  it('3: порог приёма по обе стороны — манхэттен 9.999 принимается, 10 нет', () => {
    // raw (46, y): манхэттен до (50, 50) = 4 + |y − 50|.
    expect(getSnapPoint({ x: 46, y: 44.001 }, [cornerO, vertical50], params()).hit).toEqual({
      kind: 'bisector-axis',
      axis: 'x',
    });
    expect(getSnapPoint({ x: 46, y: 44 }, [cornerO, vertical50], params()).hit).toEqual({ kind: 'axis', axis: 'x' });
  });

  it('4: биссектриса ∩ горизонталь y=50 → (50, 50), hit bisector-axis y', () => {
    const res = getSnapPoint({ x: 50, y: 46 }, [cornerO, horizontal50], params());
    expect(res.snapped).toEqual({ x: 50, y: 50 });
    expect(res.hit).toEqual({ kind: 'bisector-axis', axis: 'y' });
    expect(res.bisAnchor?.id).toBe('O');
    expect(res.alignerY?.id).toBe('H');
  });

  it('4: откат на pointPt при промахе', () => {
    const res = getSnapPoint({ x: 40, y: 46 }, [cornerO, horizontal50], params());
    expect(res.snapped).toEqual({ x: 40, y: 50 });
    expect(res.hit).toEqual({ kind: 'axis', axis: 'y' });
  });

  it('биссектриса параллельна оси — пересечения нет, откат на pointPt', () => {
    // Угол с биссектрисой строго вертикальной: соседи (−100, 100) и (100, 100) → биссектриса вдоль +y.
    const up = c('U', 0, 0, { x: -100, y: 100 }, { x: 100, y: 100 });
    const res = getSnapPoint({ x: 46, y: 50 }, [up, vertical50], params());
    expect(res.hit).toEqual({ kind: 'axis', axis: 'x' });
    expect(res.snapped).toEqual({ x: 50, y: 50 });
  });
});

describe('getSnapPoint — ветка 5: орто ∩ биссектриса, приоритет Y', () => {
  // Угол O′(0, 4) с соседями (100, 4) и (0, 104) → биссектриса y = x + 4.
  const cornerShifted = c('O', 0, 4, { x: 100, y: 4 }, { x: 0, y: 104 });
  // Контур: первая точка даёт горизонталь y = 50, последняя — вертикаль x = 50.
  const contour = [
    { x: 300, y: 50 },
    { x: 50, y: 300 },
  ];
  const orthoBis = params({ flags: flags({ pointsAlign: false, orthoAlign: true }), contour });

  it('оба орто-якоря — берётся Y-вариант: y=50 ∩ (y=x+4) = (46, 50), а не x=50 ∩ … = (50, 54)', () => {
    // Оба варианта в 4 см по манхэттену от (48, 52) — выбор решает только правило приоритета.
    const res = getSnapPoint({ x: 48, y: 52 }, [cornerShifted], orthoBis);
    expect(res.snapped).toEqual({ x: 46, y: 50 });
    expect(res.hit).toEqual({ kind: 'ortho-bisector', axis: 'y' });
    expect(res.bisAnchor?.id).toBe('O');
    expect(res.alignerY?.id).toBe(ORTHO_FIRST_ID);
    expect(res.alignerX?.id).toBe(ORTHO_LAST_ID);
  });

  it('только X-якорь — X-вариант', () => {
    const res = getSnapPoint({ x: 48, y: 52 }, [cornerShifted], { ...orthoBis, contour: [{ x: 50, y: 300 }] });
    expect(res.snapped).toEqual({ x: 50, y: 54 });
    expect(res.hit).toEqual({ kind: 'ortho-bisector', axis: 'x' });
  });

  it('пересечение мимо порога — откат на orthoPt (hit ortho, без bisAnchor)', () => {
    // Биссектриса далеко от (50, 50) но близко к курсору: угол (0, 0) с соседями (100, 0) и (100, 20) → пологая.
    const flat = c('F', 0, 0, { x: 100, y: 0 }, { x: 100, y: 20 });
    const res = getSnapPoint({ x: 48, y: 6 }, [flat], {
      ...orthoBis,
      contour: [
        { x: 300, y: 8 },
        { x: 50, y: 300 },
      ],
    });
    expect(res.hit).toEqual({ kind: 'ortho' });
    expect(res.snapped).toEqual({ x: 50, y: 8 });
    expect(res.bisAnchor).toBeNull();
  });
});

describe('getSnapPoint — ветки 6/7/8 и промах', () => {
  it('6: одиночная вертикаль', () => {
    const res = getSnapPoint({ x: 46, y: 100 }, [vertical50], params());
    expect(res.snapped).toEqual({ x: 50, y: 100 });
    expect(res.hit).toEqual({ kind: 'axis', axis: 'x' });
    expect(res.alignerX?.id).toBe('V');
    expect(res.alignerY).toBeNull();
  });

  it('6: одиночная горизонталь; порог по оси — 10 включительно, 10.001 нет', () => {
    expect(getSnapPoint({ x: 100, y: 40 }, [horizontal50], params())).toMatchObject({
      snapped: { x: 100, y: 50 },
      hit: { kind: 'axis', axis: 'y' },
    });
    expect(getSnapPoint({ x: 100, y: 39.999 }, [horizontal50], params()).hit).toEqual({ kind: 'none' });
  });

  it('7: чистый орто-лок к первой точке (одна зафиксированная); гайд ведёт к якорю ortho:first', () => {
    const only = params({ flags: flags({ pointsAlign: false, bisectorAlign: false, orthoAlign: true }) });
    const res = getSnapPoint({ x: 100, y: 46 }, [], { ...only, contour: [{ x: 300, y: 50 }] });
    expect(res.snapped).toEqual({ x: 100, y: 50 });
    expect(res.hit).toEqual({ kind: 'ortho' });
    expect(res.alignerY?.id).toBe(ORTHO_FIRST_ID);
    expect(res.alignerX).toBeNull();
    expect(res.rawAlignersY[1]?.id).toBe(ORTHO_FIRST_ID);
  });

  it('7: орто-лок к последней точке (две зафиксированные) — ortho:last', () => {
    const only = params({ flags: flags({ pointsAlign: false, bisectorAlign: false, orthoAlign: true }) });
    const res = getSnapPoint({ x: 46, y: 100 }, [], {
      ...only,
      contour: [
        { x: 300, y: 50 },
        { x: 50, y: 300 },
      ],
    });
    expect(res.snapped).toEqual({ x: 50, y: 100 });
    expect(res.alignerX?.id).toBe(ORTHO_LAST_ID);
  });

  it('7: орто ниже одиночной оси точек — при обоих выигрывает pointsAlign', () => {
    const both = params({ flags: flags({ orthoAlign: true }), contour: [{ x: 300, y: 50 }] });
    const res = getSnapPoint({ x: 100, y: 46 }, [c('H2', -300, 52)], both);
    expect(res.hit).toEqual({ kind: 'axis', axis: 'y' });
    expect(res.snapped).toEqual({ x: 100, y: 52 });
  });

  it('8: только биссектриса — проекция на прямую, приём по манхэттену: 6 — да, 12 — нет', () => {
    const bisOnly = params({ flags: flags({ pointsAlign: false }) });
    const hit = getSnapPoint({ x: 40, y: 46 }, [cornerO], bisOnly);
    expect(hit.snapped).toEqual({ x: 43, y: 43 });
    expect(hit.hit).toEqual({ kind: 'bisector' });
    expect(hit.bisAnchor?.id).toBe('O');
    const miss = getSnapPoint({ x: 40, y: 52 }, [cornerO], bisOnly);
    expect(miss.hit).toEqual({ kind: 'none' });
    expect(miss.snapped).toEqual({ x: 40, y: 52 });
    expect(miss.bisAnchor).toBeNull();
  });

  it('8: угол дальше 10 × snapDist по манхэттену — биссектрисы нет', () => {
    const bisOnly = params({ flags: flags({ pointsAlign: false }) });
    // (50, 50): манхэттен до O = 100 (включительно — найден), (50.001, 50) — 100.001 — нет.
    expect(getSnapPoint({ x: 50, y: 50 }, [cornerO], bisOnly).hit).toEqual({ kind: 'bisector' });
    expect(getSnapPoint({ x: 50.001, y: 50 }, [cornerO], bisOnly).hit).toEqual({ kind: 'none' });
  });

  it('промах: пустой пул → квантованный сырой курсор, все выравниватели null', () => {
    const res = getSnapPoint({ x: 1.23456, y: -2.34567 }, [], params());
    expect(res).toEqual({
      snapped: { x: 1.235, y: -2.346 },
      alignerX: null,
      alignerY: null,
      bisAnchor: null,
      rawAlignersX: [null, null],
      rawAlignersY: [null, null],
      hit: { kind: 'none' },
    });
  });
});

describe('getSnapPoint — флаги', () => {
  it('pointsAlign=off: ось не работает, крест не работает', () => {
    const off = params({ flags: flags({ pointsAlign: false }) });
    expect(getSnapPoint({ x: 46, y: 100 }, [vertical50], off).hit).toEqual({ kind: 'none' });
    expect(getSnapPoint({ x: 46, y: 47 }, [vertical50, horizontal50], off).hit).toEqual({ kind: 'none' });
    expect(getSnapPoint({ x: 46, y: 47 }, [vertical50, horizontal50], params()).hit).toEqual({ kind: 'cross' });
  });

  it('bisectorAlign=off: ветки 3/4/8 не срабатывают', () => {
    const off = params({ flags: flags({ bisectorAlign: false }) });
    expect(getSnapPoint({ x: 46, y: 50 }, [cornerO, vertical50], off).hit).toEqual({ kind: 'axis', axis: 'x' });
    expect(getSnapPoint({ x: 40, y: 46 }, [cornerO], off).hit).toEqual({ kind: 'none' });
    expect(getSnapPoint({ x: 40, y: 46 }, [cornerO], params()).hit).toEqual({ kind: 'bisector' });
  });

  it('orthoAlign=off (дефолт): контур не даёт лока', () => {
    const res = getSnapPoint({ x: 100, y: 46 }, [], params({ contour: [{ x: 300, y: 50 }] }));
    expect(res.hit).toEqual({ kind: 'none' });
    expect(res.snapped).toEqual({ x: 100, y: 46 });
  });

  it('все off: только угловой снап в 2 см', () => {
    const all = params({ flags: { pointsSnap: false, pointsAlign: false, orthoAlign: false, bisectorAlign: false } });
    expect(getSnapPoint({ x: 1, y: 0.5 }, [cornerO, vertical50, horizontal50], all).hit).toEqual({
      kind: 'point',
      id: 'O',
    });
    expect(getSnapPoint({ x: 46, y: 47 }, [cornerO, vertical50, horizontal50], all).hit).toEqual({ kind: 'none' });
  });
});

describe('getSnapPoint — куллинг, exceptIds, вырожденные входы', () => {
  it('кандидат за вьюпортом не снапит (угол и ось), на границе — снапит', () => {
    const outside = c('X', 600, 0);
    expect(getSnapPoint({ x: 596, y: 0 }, [outside], params()).hit).toEqual({ kind: 'none' });
    expect(getSnapPoint({ x: 596, y: 100 }, [outside], params()).hit).toEqual({ kind: 'none' });
    const edge = c('E', 500, 0);
    expect(getSnapPoint({ x: 496, y: 0 }, [edge], params()).hit).toEqual({ kind: 'point', id: 'E' });
    expect(getSnapPoint({ x: 496, y: 100 }, [edge], params()).hit).toEqual({ kind: 'axis', axis: 'x' });
  });

  it('куллинг зависит от viewport: сдвиг центра делает точку видимой', () => {
    const outside = c('X', 600, 0);
    const shifted = params({ viewport: { ...viewport, center: { x: 300, y: 0 } } });
    expect(getSnapPoint({ x: 596, y: 0 }, [outside], shifted).hit).toEqual({ kind: 'point', id: 'X' });
  });

  it('куллинг и для биссектрисы: угол за кадром не даёт биссектрисы', () => {
    const far = c('C', 560, 0, { x: 660, y: 0 }, { x: 560, y: 100 });
    // Курсор (498, 3): угол в 65 по манхэттену (в радиусе 100), но вне вьюпорта.
    expect(getSnapPoint({ x: 490, y: -66 }, [far], params({ flags: flags({ pointsAlign: false }) })).hit).toEqual({
      kind: 'none',
    });
  });

  it('exceptIds: исключённая точка не снапит и не выравнивает; следующая — работает', () => {
    const A = c('A', 100, 100);
    const B = c('B', 100, 120);
    expect(getSnapPoint({ x: 100, y: 102 }, [A, B], params()).hit).toEqual({ kind: 'point', id: 'A' });
    const res = getSnapPoint({ x: 100, y: 102 }, [A, B], params({ exceptIds: ['A'] }));
    expect(res.hit).toEqual({ kind: 'axis', axis: 'x' });
    expect(res.alignerX?.id).toBe('B');
    expect(getSnapPoint({ x: 100, y: 102 }, [A, B], params({ exceptIds: ['A', 'B'] })).hit).toEqual({ kind: 'none' });
  });

  it('exceptIds исключает угол и из биссектрисы', () => {
    const res = getSnapPoint(
      { x: 40, y: 46 },
      [cornerO],
      params({ flags: flags({ pointsAlign: false }), exceptIds: ['O'] }),
    );
    expect(res.hit).toEqual({ kind: 'none' });
  });

  it('tie-breaking snapX: две вершины на одной вертикали по обе стороны — обе выживают в rawAlignersX, представитель — ближний', () => {
    const up = c('U', 50, 300);
    const down = c('D', 50, -300);
    const res = getSnapPoint({ x: 46, y: 100 }, [down, up], params());
    expect(res.rawAlignersX.map(q => q?.id)).toEqual(['D', 'U']);
    expect(res.alignerX?.id).toBe('U');
    expect(res.snapped).toEqual({ x: 50, y: 100 });
  });

  it('NaN в курсоре — не исключение: snapped NaN, hit none', () => {
    const res = getSnapPoint({ x: Number.NaN, y: 0 }, [cornerO, vertical50, horizontal50], params());
    expect(res.hit).toEqual({ kind: 'none' });
    expect(Number.isNaN(res.snapped.x)).toBe(true);
    expect(res.alignerX).toBeNull();
    expect(res.alignerY).toBeNull();
    expect(res.bisAnchor).toBeNull();
  });

  it('NaN в кандидате — кандидат пропускается, остальные работают', () => {
    const res = getSnapPoint({ x: 46, y: 100 }, [c('N', Number.NaN, 100), vertical50], params());
    expect(res.hit).toEqual({ kind: 'axis', axis: 'x' });
    expect(res.alignerX?.id).toBe('V');
  });

  it('результат — новые объекты: кандидат не мутируется и не возвращается по ссылке в snapped', () => {
    const A = c('A', 100.0004, 100);
    const res = getSnapPoint({ x: 101, y: 101 }, [A], params());
    expect(res.snapped).toEqual({ x: 100, y: 100 });
    expect(res.snapped).not.toBe(A);
    expect(A.x).toBe(100.0004);
  });
});

describe('getSnapPoint — property', () => {
  const arbFlags: fc.Arbitrary<SnapFlags> = fc.record({
    pointsSnap: fc.boolean(),
    pointsAlign: fc.boolean(),
    orthoAlign: fc.boolean(),
    bisectorAlign: fc.boolean(),
  });
  const arbLocal = fc.record({
    x: fc.integer({ min: -400_000, max: 400_000 }).map(v => v / 1000),
    y: fc.integer({ min: -400_000, max: 400_000 }).map(v => v / 1000),
  });
  const arbCandidate = fc
    .tuple(fc.integer({ min: 0, max: 1e6 }), arbLocal, fc.option(fc.tuple(arbLocal, arbLocal), { nil: undefined }))
    .map(([id, p, ring]) => c(`p${id}`, p.x, p.y, ring?.[0], ring?.[1]));

  it('snapped всегда квантован и не дальше snapDist по чебышёву от курсора (либо равен квантованному курсору)', () => {
    fc.assert(
      fc.property(
        arbQuantizedPoint,
        fc.array(arbCandidate, { maxLength: 30 }),
        arbFlags,
        fc.array(arbLocal, { maxLength: 4 }),
        fc.integer({ min: 1, max: 5000 }).map(v => v / 100),
        (raw, candidates, snapFlags, contour, dist) => {
          const res = getSnapPoint(raw, candidates, params({ snapDist: dist, flags: snapFlags, contour }));
          expect(quantize(res.snapped.x)).toBe(res.snapped.x);
          expect(quantize(res.snapped.y)).toBe(res.snapped.y);
          const cheb = Math.max(Math.abs(res.snapped.x - raw.x), Math.abs(res.snapped.y - raw.y));
          expect(cheb).toBeLessThanOrEqual(dist + 0.0005);
          if (res.hit.kind === 'none') expect(res.snapped).toEqual({ x: quantize(raw.x), y: quantize(raw.y) });
          if (res.hit.kind === 'point') expect(manhDist(raw, res.snapped)).toBeLessThan(dist + 0.001);
        },
      ),
      fcParams,
    );
  });

  it('все кандидаты за вьюпортом ⇒ снапа нет (куллинг во всех ветках)', () => {
    const outside = arbCandidate.map(candidate => ({ ...candidate, x: candidate.x + 1000 }));
    fc.assert(
      fc.property(arbQuantizedPoint, fc.array(outside, { maxLength: 30 }), arbFlags, (raw, candidates, snapFlags) => {
        const res = getSnapPoint(raw, candidates, params({ flags: snapFlags }));
        expect(res.hit).toEqual({ kind: 'none' });
        expect(res.snapped).toEqual({ x: quantize(raw.x), y: quantize(raw.y) });
      }),
      fcParams,
    );
  });
});
