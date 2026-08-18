import type { PlanPosition } from '../../PlannerDocument';
import { RE_MITER_ANGLE } from '../band/blocksFromContour';
import { B_EPS } from '../predicates/pointOnSegment';
import type { Viewport } from '../viewport';
import type { AlignerPair, SnapCandidate } from './candidates';
import { DEFAULT_SNAP_FLAGS, getSnapPoint, type SnapResult } from './getSnapPoint';
import { GUIDE_TURN_LIMIT, guidesFor, type GuideContext, type SnapGuide } from './guidesFor';

const c = (id: string, x: number, y: number): SnapCandidate => ({ id, x, y });

const snap = (patch: Partial<SnapResult> & { snapped: PlanPosition }): SnapResult => ({
  alignerX: null,
  alignerY: null,
  bisAnchor: null,
  rawAlignersX: [null, null],
  rawAlignersY: [null, null],
  hit: { kind: 'none' },
  ...patch,
});

const ids = (guides: SnapGuide[]): string[] => guides.map(g => `${g.kind}:${(g.to as SnapCandidate).id}`);

const U = c('U', 50, 300);
const D = c('D', 50, -300);
const H = c('H', 300, 100);
const snapped = { x: 50, y: 100 };
/** Курсор пришёл слева горизонтально — поворот к вертикали в любую сторону 90°, не резче 135°. */
const lastPoint = { x: 10, y: 100 };
const face = { width: 10, side: 'right' as const };

describe('guidesFor — основные гайды', () => {
  it('константа углового фильтра = лимит митра 0.75π', () => {
    expect(GUIDE_TURN_LIMIT).toBe(RE_MITER_ANGLE);
    expect(GUIDE_TURN_LIMIT).toBeCloseTo(Math.PI * 0.75, 12);
  });

  it('гайд к alignerX, alignerY и bisAnchor от снап-точки к источнику; вне рисования — без face', () => {
    const O = c('O', 0, 0);
    const res = snap({
      snapped,
      alignerX: U,
      alignerY: H,
      bisAnchor: O,
      rawAlignersX: [null, U],
      rawAlignersY: [null, H],
    });
    const guides = guidesFor(res);
    expect(ids(guides)).toEqual(['axis-x:U', 'axis-y:H', 'bisector:O']);
    for (const guide of guides) {
      expect(guide.from).toBe(snapped);
      expect(guide.face).toBeNull();
    }
    expect(guides[0]?.to).toBe(U);
  });

  it('пустой результат — пустой список; контекст по умолчанию — {}', () => {
    expect(guidesFor(snap({ snapped }))).toEqual([]);
    expect(guidesFor(snap({ snapped }), {})).toEqual([]);
  });

  it('нулевой длины (снап-точка совпала с источником в B_EPS) — не рисуется', () => {
    const res = snap({ snapped: { x: 50, y: 300 + B_EPS / 2 }, alignerX: U, rawAlignersX: [null, U], bisAnchor: U });
    expect(guidesFor(res)).toEqual([]);
    const justOff = snap({ snapped: { x: 50, y: 300 + B_EPS * 2 }, alignerX: U, rawAlignersX: [null, U] });
    expect(ids(guidesFor(justOff))).toEqual(['axis-x:U']);
  });

  it('осевой гайд подавлен, если снап-точка не лежит на оси источника (победил угол, выравниватель — шум)', () => {
    // Снап на угол (52, 100), а alignerX = U с вертикалью x = 50: наклонный пунктир к U не рисуется.
    const res = snap({
      snapped: { x: 52, y: 100 },
      alignerX: U,
      rawAlignersX: [null, U],
      hit: { kind: 'point', id: 'A' },
    });
    expect(guidesFor(res)).toEqual([]);
    const onAxis = snap({ snapped: { x: 50 + B_EPS / 2, y: 100 }, alignerX: U, rawAlignersX: [null, U] });
    expect(ids(guidesFor(onAxis))).toEqual(['axis-x:U']);
  });

  it('интеграция с getSnapPoint: снап на угол оставляет только гайды по осям, проходящим через угол', () => {
    const viewport: Viewport = { scale: 1, center: { x: 0, y: 0 }, width: 1000, height: 1000 };
    const A = c('A', 100, 100);
    const stray = c('S', 104, 400); // вертикаль x = 104 в 1 см от курсора, но угол побеждает
    const res = getSnapPoint({ x: 103, y: 101 }, [A, stray], { snapDist: 10, viewport, flags: DEFAULT_SNAP_FLAGS });
    expect(res.hit).toEqual({ kind: 'point', id: 'A' });
    expect(res.alignerX?.id).toBe('S');
    expect(guidesFor(res)).toEqual([]);
  });
});

describe('guidesFor — расширенные гайды и вторая грань (рисование стен)', () => {
  const both: AlignerPair = [D, U];
  const twoOnVertical = snap({ snapped, alignerX: U, rawAlignersX: both });
  const drawing: GuideContext = { lastPoint, face };

  it('к «проигравшему» кандидату той же оси рисуется второй гайд; у обоих — параллель второй грани', () => {
    const guides = guidesFor(twoOnVertical, drawing);
    expect(ids(guides)).toEqual(['axis-x:U', 'axis-x:D']);
    // Направление snapped → U = +y; правая нормаль при y вверх — +x: грань на x = 60.
    expect(guides[0]?.face).toEqual({ a: { x: 60, y: 100 }, b: { x: 60, y: 300 } });
    // snapped → D = −y; правая нормаль — −x: грань на x = 40.
    expect(guides[1]?.face).toEqual({ a: { x: 40, y: 100 }, b: { x: 40, y: -300 } });
  });

  it('side left — грань с другой стороны', () => {
    const guides = guidesFor(twoOnVertical, { lastPoint, face: { width: 10, side: 'left' } });
    expect(guides[0]?.face).toEqual({ a: { x: 40, y: 100 }, b: { x: 40, y: 300 } });
  });

  it('без lastPoint (не рисование) — расширенных гайдов и граней нет, даже если face задан', () => {
    const guides = guidesFor(twoOnVertical, { face });
    expect(ids(guides)).toEqual(['axis-x:U']);
    expect(guides[0]?.face).toBeNull();
  });

  it('с lastPoint, но без face — расширенные гайды есть, граней нет', () => {
    const guides = guidesFor(twoOnVertical, { lastPoint });
    expect(ids(guides)).toEqual(['axis-x:U', 'axis-x:D']);
    expect(guides.every(g => g.face === null)).toBe(true);
  });

  it('снап-точка совпала с одним из выравнивателей — расширенные подавлены целиком, основные остаются', () => {
    // Снап в D-совпадающую точку: alignerX = D (нулевой), alignerY = H — остаётся, но без face.
    const res = snap({
      snapped: { x: 50, y: -300 },
      alignerX: D,
      alignerY: H2,
      rawAlignersX: both,
      rawAlignersY: [null, H2],
    });
    const guides = guidesFor(res, drawing);
    expect(ids(guides)).toEqual(['axis-y:H2']);
    expect(guides[0]?.face).toBeNull();
  });

  it('снап-точка на существующей стене (T-стык) — расширенные подавлены, основной без face', () => {
    const wall = { a: { x: 0, y: 100 }, b: { x: 200, y: 100 } };
    const guides = guidesFor(twoOnVertical, { ...drawing, segments: [wall] });
    expect(ids(guides)).toEqual(['axis-x:U']);
    expect(guides[0]?.face).toBeNull();
    // Стена в стороне (на B_EPS дальше) — не мешает.
    const near = { a: { x: 0, y: 100 + B_EPS * 2 }, b: { x: 200, y: 100 + B_EPS * 2 } };
    expect(ids(guidesFor(twoOnVertical, { ...drawing, segments: [near] }))).toEqual(['axis-x:U', 'axis-x:D']);
  });

  it('угловой фильтр: поворот 134° от последнего сегмента — гайд есть, 136° — нет (обе стороны)', () => {
    // Направление snapped → D — строго вниз; lastPoint подобран так, что поворот к нему равен ±134°/±136°.
    const at = (deg: number, mirror: boolean): PlanPosition => {
      const angle = Math.PI + (deg / 180) * Math.PI; // угол направления last→snapped от +Y к +X
      const dx = Math.sin(angle) * (mirror ? -1 : 1);
      const dy = Math.cos(angle);
      return { x: snapped.x - dx * 100, y: snapped.y - dy * 100 };
    };
    const onlyD = snap({ snapped, alignerX: D, rawAlignersX: [D, null] });
    for (const mirror of [false, true]) {
      expect(ids(guidesFor(onlyD, { lastPoint: at(134, mirror), face }))).toEqual(['axis-x:D']);
      expect(guidesFor(onlyD, { lastPoint: at(134, mirror), face })[0]?.face).not.toBeNull();
      const sharp = guidesFor(onlyD, { lastPoint: at(136, mirror), face });
      // Основной гайд остаётся (снап-точка на оси), но без грани — как «проигравший» он не прошёл бы.
      expect(ids(sharp)).toEqual(['axis-x:D']);
      expect(sharp[0]?.face).toBeNull();
    }
    // Тот же фильтр для проигравшего: U — основной, D — проигравший под 136° не рисуется вовсе.
    const sharpLoser = guidesFor(twoOnVertical, { lastPoint: at(136, false), face });
    expect(ids(sharpLoser)).toEqual(['axis-x:U']);
  });

  it('выравниватель на одной оси с lastPoint — гайд лёг бы на сам сегмент: расширенный не рисуется, грань не строится', () => {
    const guides = guidesFor(twoOnVertical, { lastPoint: { x: 50, y: 150 }, face });
    expect(ids(guides)).toEqual(['axis-x:U']);
    expect(guides[0]?.face).toBeNull();
    // Чуть в стороне (≥ B_EPS) — уже считается другой осью; поворот к U 180° − почти 0 → к U резкий, к D — 0°.
    const aside = guidesFor(twoOnVertical, { lastPoint: { x: 50 + B_EPS, y: 150 }, face });
    expect(ids(aside)).toEqual(['axis-x:U', 'axis-x:D']);
    expect(aside[1]?.face).not.toBeNull();
  });

  it('биссектриса face не получает', () => {
    const O = c('O', 0, 0);
    const guides = guidesFor(snap({ snapped, bisAnchor: O }), drawing);
    expect(ids(guides)).toEqual(['bisector:O']);
    expect(guides[0]?.face).toBeNull();
  });
});

const H2 = c('H2', 300, -300);
