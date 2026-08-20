import { createPlanBuilder } from '../../document/testing/planBuilder';
import { createTestManager, ringDocument } from '../testing/testManager';

/** Квадратная «комната по точкам» 300×300 без тел стен: углы — `p1..p4`. */
const roomDocument = () => {
  const b = createPlanBuilder();
  b.contour('inner', [b.point(0, 0), b.point(300, 0), b.point(300, 300), b.point(0, 300)]);
  return b.document();
};

/** Две смежные комнаты, общая грань `x = 300`: их полы только касаются. */
const adjacentRoomsDocument = () => {
  const b = createPlanBuilder();
  b.contour('inner', [b.point(0, 0), b.point(300, 0), b.point(300, 300), b.point(0, 300)]);
  b.contour('inner', [b.point(300, 0), b.point(600, 0), b.point(600, 300), b.point(300, 300)]);
  return b.document();
};

const covers = (m: ReturnType<typeof createTestManager>) => m.manager.document.get().floors[0]!.layout.covers;

const outlineOf = (m: ReturnType<typeof createTestManager>, index: number) => {
  const layout = m.manager.document.get().floors[0]!.layout;
  return layout.covers[index]!.points.map(id => layout.points[id]!).map(({ x, y }) => `${x},${y}`);
};

const RECT = [
  { x: 10, y: 10 },
  { x: 200, y: 10 },
  { x: 200, y: 290 },
  { x: 10, y: 290 },
];

describe('document.addCover (ADR 0018 D1, спека 02 «Полы»)', () => {
  it('ручной пол: одна запись истории, одно document:changed, dirty; undo возвращает планировку', () => {
    const tm = createTestManager(ringDocument());
    const { manager, events, floorId } = tm;
    const before = manager.document.get();
    manager.document.markSaved();
    events.length = 0;

    expect(manager.document.addCover(floorId, RECT)).toEqual({ ok: true, value: undefined });
    expect(events).toEqual(['document:changed', 'history:changed', 'document:dirty-changed']);
    expect(manager.document.isDirty()).toBe(true);
    expect(manager.history.get()).toEqual({ canUndo: true, canRedo: false });

    manager.history.undo();
    expect(manager.history.get()).toEqual({ canUndo: false, canRedo: true });
    expect(manager.document.get().floors[0]!.layout).toEqual(before.floors[0]!.layout);
  });

  it('пересечение с существующим полом → один пол: слияние делает normalize, команда ничего не сливает', () => {
    const tm = createTestManager(ringDocument());
    // Комната 10..390 × 10..290 уже застелена авто-полом — новый пол его пересекает.
    expect(covers(tm)).toHaveLength(1);
    tm.manager.document.addCover(tm.floorId, RECT);
    expect(covers(tm)).toHaveLength(1);
    // Обвод — вся комната; вершины ручного пола на границе остались в петле.
    expect(outlineOf(tm, 0)).toEqual(['10,10', '200,10', '390,10', '390,290', '200,290', '10,290']);
  });

  it('касание: полы соседних комнат объединяются автоматически — диалога «Объединить?» у команды нет', () => {
    // Фаза (5) `normalize` зовёт `mergeCovers` **с касанием**, поэтому даже чисто касающиеся полы
    // (авто-полы двух смежных комнат) уже слиты до всякой команды.
    const adjacent = createTestManager(adjacentRoomsDocument());
    expect(covers(adjacent)).toHaveLength(1);
    expect(outlineOf(adjacent, 0)).toEqual(['0,0', '300,0', '600,0', '600,300', '300,300', '0,300']);
    // Ручной пол ровно по одной из комнат ничего не разделяет — запись по-прежнему одна на обе комнаты.
    adjacent.manager.document.addCover(adjacent.floorId, [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 300 },
      { x: 0, y: 300 },
    ]);
    expect(covers(adjacent)).toHaveLength(1);

    // Контроль: несоприкасающиеся комнаты дают два пола — слияние идёт по отношению контуров, не «всё в одно».
    const b = createPlanBuilder();
    b.contour('inner', [b.point(0, 0), b.point(300, 0), b.point(300, 300), b.point(0, 300)]);
    b.contour('inner', [b.point(400, 0), b.point(700, 0), b.point(700, 300), b.point(400, 300)]);
    expect(covers(createTestManager(b.document()))).toHaveLength(2);
  });

  it('первый пол-донор: `ceilingHidden` существующего пола переживает слияние с добавленным', () => {
    const b = createPlanBuilder();
    b.ring(0, 0, 400, 300, 10);
    b.cover('outer', [b.point(10, 10), b.point(390, 10), b.point(390, 290), b.point(10, 290)], {
      ceilingHidden: true,
    });
    const tm = createTestManager(b.document());
    tm.manager.document.addCover(tm.floorId, RECT);
    expect(covers(tm).map(cover => cover.ceilingHidden)).toEqual([true]);
  });

  it('kind: inner внутри существующего пола — вырез; новый пол приходит с ceilingHidden: false', () => {
    const tm = createTestManager(ringDocument());
    expect(
      tm.manager.document.addCover(
        tm.floorId,
        [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
          { x: 200, y: 200 },
          { x: 100, y: 200 },
        ],
        { kind: 'inner' },
      ),
    ).toEqual({ ok: true, value: undefined });
    expect(covers(tm).map(cover => ({ kind: cover.kind, ceilingHidden: cover.ceilingHidden }))).toEqual([
      { kind: 'outer', ceilingHidden: false },
      { kind: 'inner', ceilingHidden: false },
    ]);
    // Авто-пол вырез не зарастает: `findAutoCovers` получает только обводы (спека 02).
    expect(outlineOf(tm, 1)).toEqual(['100,100', '100,200', '200,200', '200,100']);
  });

  it('вырез без хозяина удаляется normalize: команда ok, записи в документе нет', () => {
    const tm = createTestManager();
    tm.events.length = 0;
    expect(
      tm.manager.document.addCover(
        tm.floorId,
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        { kind: 'inner' },
      ),
    ).toEqual({ ok: true, value: undefined });
    expect(covers(tm)).toHaveLength(0);
    // Точки выреза остались без владельцев и сняты GC точек в конце `normalize`.
    expect(Object.keys(tm.manager.document.get().floors[0]!.layout.points)).toHaveLength(0);
    // Транзакция всё же состоялась: `normalize` переписал `covers`/`points` новыми (пустыми) узлами, и
    // immer видит документ изменившимся. Значение то же, а ссылка новая — событие и запись истории есть.
    expect(tm.events).toEqual(['document:changed', 'history:changed', 'document:dirty-changed']);
  });

  it('дисциплина id: вершины в углах комнаты берут id этих углов, новых точек не заводится', () => {
    const tm = createTestManager(roomDocument());
    const before = Object.keys(tm.manager.document.get().floors[0]!.layout.points).sort();
    expect(before).toEqual(['p1', 'p2', 'p3', 'p4']);
    tm.manager.document.addCover(tm.floorId, [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 300 },
      { x: 0, y: 300 },
    ]);
    expect(Object.keys(tm.manager.document.get().floors[0]!.layout.points).sort()).toEqual(before);
    expect([...covers(tm)[0]!.points].sort()).toEqual(before);
  });

  it('координаты квантуются до 0.001 на границе: 0.0004 → 0, -0 → 0', () => {
    const tm = createTestManager(roomDocument());
    tm.manager.document.addCover(tm.floorId, [
      { x: -0, y: 0.0004 },
      { x: 300.0004, y: -0.0004 },
      { x: 300, y: 300 },
      { x: 0, y: 300 },
    ]);
    // Квантование привело вершины ровно в углы комнаты — новых точек нет.
    expect(Object.keys(tm.manager.document.get().floors[0]!.layout.points).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  describe('ошибки: документ — тот же объект, событий нет', () => {
    const expectRejected = (tm: ReturnType<typeof createTestManager>, before: unknown) => {
      expect(tm.manager.document.get()).toBe(before);
      expect(tm.events).toEqual([]);
      expect(tm.manager.history.get()).toEqual({ canUndo: false, canRedo: false });
    };

    it('unknown-floor', () => {
      const tm = createTestManager(ringDocument());
      const before = tm.manager.document.get();
      tm.events.length = 0;
      expect(tm.manager.document.addCover('f-nope', RECT)).toEqual({
        ok: false,
        error: { kind: 'unknown-floor', floorId: 'f-nope' },
      });
      expectRejected(tm, before);
    });

    it('invalid-coordinate', () => {
      const tm = createTestManager(ringDocument());
      const before = tm.manager.document.get();
      tm.events.length = 0;
      expect(tm.manager.document.addCover(tm.floorId, [{ x: Number.NaN, y: 0 }, ...RECT.slice(1)])).toEqual({
        ok: false,
        error: { kind: 'invalid-coordinate' },
      });
      expect(
        tm.manager.document.addCover(tm.floorId, [{ x: 0, y: Number.POSITIVE_INFINITY }, ...RECT.slice(1)]),
      ).toEqual({ ok: false, error: { kind: 'invalid-coordinate' } });
      expectRejected(tm, before);
    });

    it('contour-self-intersected («бабочка»)', () => {
      const tm = createTestManager(ringDocument());
      const before = tm.manager.document.get();
      tm.events.length = 0;
      expect(
        tm.manager.document.addCover(tm.floorId, [
          { x: 10, y: 10 },
          { x: 200, y: 10 },
          { x: 10, y: 200 },
          { x: 200, y: 200 },
        ]),
      ).toEqual({ ok: false, error: { kind: 'contour-self-intersected' } });
      expectRejected(tm, before);
    });

    it('contour-degenerate: меньше трёх точек', () => {
      const tm = createTestManager(ringDocument());
      const before = tm.manager.document.get();
      tm.events.length = 0;
      expect(tm.manager.document.addCover(tm.floorId, RECT.slice(0, 2))).toEqual({
        ok: false,
        error: { kind: 'contour-degenerate' },
      });
      expectRejected(tm, before);
    });

    it('contour-degenerate: дубли точек', () => {
      const tm = createTestManager(ringDocument());
      const before = tm.manager.document.get();
      tm.events.length = 0;
      expect(tm.manager.document.addCover(tm.floorId, [...RECT, { x: 10, y: 10 }])).toEqual({
        ok: false,
        error: { kind: 'contour-degenerate' },
      });
      expectRejected(tm, before);
    });

    it('contour-degenerate: площадь/сливер ниже порога', () => {
      const tm = createTestManager(ringDocument());
      const before = tm.manager.document.get();
      tm.events.length = 0;
      // 5 × 5 = 25 см² < MIN_CONTOUR_AREA (50).
      expect(
        tm.manager.document.addCover(tm.floorId, [
          { x: 100, y: 100 },
          { x: 105, y: 100 },
          { x: 105, y: 105 },
          { x: 100, y: 105 },
        ]),
      ).toEqual({ ok: false, error: { kind: 'contour-degenerate' } });
      // Сливер: площадь есть, но отношение площадь/периметр ниже MIN_SP_RATIO.
      expect(
        tm.manager.document.addCover(tm.floorId, [
          { x: 20, y: 20 },
          { x: 380, y: 20 },
          { x: 380, y: 20.5 },
          { x: 20, y: 20.5 },
        ]),
      ).toEqual({ ok: false, error: { kind: 'contour-degenerate' } });
      expectRejected(tm, before);
    });
  });
});
