import { createPlanBuilder } from '../../document/testing/planBuilder';
import { createTestManager } from '../testing/testManager';
import { areaHeightCoalesceKey } from './setAreaHeight';

/** Квадратная «комната по точкам» 300×300 без тел стен: углы — `p1..p4`. */
const roomDocument = () => {
  const b = createPlanBuilder();
  b.contour('inner', [b.point(0, 0), b.point(300, 0), b.point(300, 300), b.point(0, 300)]);
  return b.document();
};

const LOWER = [
  { x: 0, y: 0 },
  { x: 300, y: 0 },
  { x: 300, y: 300 },
];
const UPPER = [
  { x: 0, y: 0 },
  { x: 300, y: 300 },
  { x: 0, y: 300 },
];

const layoutOf = (m: ReturnType<typeof createTestManager>) => m.manager.document.get().floors[0]!.layout;
const heights = (m: ReturnType<typeof createTestManager>) => layoutOf(m).areas.map(area => area.height);

/** Менеджер с двумя касающимися зонами (100 и 120 см) и обнулённым журналом событий. */
const withTwoAreas = () => {
  const tm = createTestManager(roomDocument());
  tm.manager.document.addArea(tm.floorId, LOWER, 100);
  tm.manager.document.addArea(tm.floorId, UPPER, 120);
  const [first, second] = layoutOf(tm).areas.map(area => area.id) as [string, string];
  tm.manager.document.markSaved();
  tm.events.length = 0;
  return { tm, first, second };
};

describe('document.setAreaHeight (ADR 0018 D1/D5)', () => {
  it('ключ коалесинга формирует команда', () => {
    expect(areaHeightCoalesceKey('ar1')).toBe('area-height:ar1');
  });

  it('меняет высоту: одно document:changed, dirty; undo возвращает прежнюю', () => {
    const { tm, first } = withTwoAreas();
    expect(tm.manager.document.setAreaHeight(tm.floorId, first, 210)).toEqual({ ok: true, value: undefined });
    expect(tm.events).toEqual(['document:changed', 'document:dirty-changed']);
    expect(tm.manager.document.isDirty()).toBe(true);
    expect(heights(tm)).toEqual([210, 120]);
    tm.manager.history.undo();
    expect(heights(tm)).toEqual([100, 120]);
  });

  it('коалесинг: серия правок одной зоны — одна запись, undo возвращает к состоянию до серии', () => {
    const { tm, first } = withTwoAreas();
    const before = layoutOf(tm);
    tm.manager.document.setAreaHeight(tm.floorId, first, 150);
    tm.manager.document.setAreaHeight(tm.floorId, first, 180);
    tm.manager.document.setAreaHeight(tm.floorId, first, 210);
    expect(heights(tm)).toEqual([210, 120]);
    tm.manager.history.undo();
    expect(tm.manager.document.get().floors[0]!.layout).toBe(before);
    // Записей ровно на одну больше, чем до серии: следующий undo снимает уже вторую зону.
    tm.manager.history.undo();
    expect(heights(tm)).toEqual([100]);
  });

  it('другая зона рвёт серию: два шага undo', () => {
    const { tm, first, second } = withTwoAreas();
    tm.manager.document.setAreaHeight(tm.floorId, first, 150);
    tm.manager.document.setAreaHeight(tm.floorId, second, 160);
    tm.manager.history.undo();
    expect(heights(tm)).toEqual([150, 120]);
    tm.manager.history.undo();
    expect(heights(tm)).toEqual([100, 120]);
  });

  it('другая команда рвёт серию', () => {
    const { tm, first } = withTwoAreas();
    tm.manager.document.setAreaHeight(tm.floorId, first, 150);
    tm.manager.document.deleteArea(tm.floorId, first);
    const restored = layoutOf(tm).areas;
    expect(restored.map(area => area.height)).toEqual([120]);
    tm.manager.history.undo();
    expect(heights(tm)).toEqual([150, 120]);
    tm.manager.history.undo();
    expect(heights(tm)).toEqual([100, 120]);
  });

  it('undo рвёт серию: правка после отката — новая запись', () => {
    const { tm, first } = withTwoAreas();
    tm.manager.document.setAreaHeight(tm.floorId, first, 150);
    tm.manager.history.undo();
    expect(heights(tm)).toEqual([100, 120]);
    tm.manager.document.setAreaHeight(tm.floorId, first, 180);
    expect(heights(tm)).toEqual([180, 120]);
    tm.manager.history.undo();
    expect(heights(tm)).toEqual([100, 120]);
  });

  it('та же высота — no-op: ни события, ни записи истории', () => {
    const { tm, first } = withTwoAreas();
    const before = tm.manager.document.get();
    expect(tm.manager.document.setAreaHeight(tm.floorId, first, 100)).toEqual({ ok: true, value: undefined });
    expect(tm.manager.document.get()).toBe(before);
    expect(tm.events).toEqual([]);
    // Записи не появилось: ближайший undo снимает вторую зону, а не «правку высоты».
    tm.manager.history.undo();
    expect(heights(tm)).toEqual([100]);
  });

  it('unknown-floor: документ — тот же объект, событий нет', () => {
    const { tm, first } = withTwoAreas();
    const before = tm.manager.document.get();
    expect(tm.manager.document.setAreaHeight('f-nope', first, 150)).toEqual({
      ok: false,
      error: { kind: 'unknown-floor', floorId: 'f-nope' },
    });
    expect(tm.manager.document.get()).toBe(before);
    expect(tm.events).toEqual([]);
  });

  it('unknown-area: документ — тот же объект, событий нет', () => {
    const { tm } = withTwoAreas();
    const before = tm.manager.document.get();
    expect(tm.manager.document.setAreaHeight(tm.floorId, 'ar-nope', 150)).toEqual({
      ok: false,
      error: { kind: 'unknown-area', id: 'ar-nope' },
    });
    expect(tm.manager.document.get()).toBe(before);
    expect(tm.events).toEqual([]);
  });

  it('invalid-height: не конечная или <= 0 — документ тот же, событий нет', () => {
    const { tm, first } = withTwoAreas();
    const before = tm.manager.document.get();
    for (const height of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(tm.manager.document.setAreaHeight(tm.floorId, first, height)).toEqual({
        ok: false,
        error: { kind: 'invalid-height', height },
      });
    }
    expect(tm.manager.document.get()).toBe(before);
    expect(tm.events).toEqual([]);
  });
});
