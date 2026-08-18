import { createEmptyDocument } from '../document/PlannerDocument';
import { MAX_HISTORY } from './history/HistoryLog';
import { createTestManager, rectContour, ringContours, ringDocument } from './testing/testManager';

describe('HistoryNamespace (фасад, ADR 0018 D3–D7)', () => {
  it('пустая история: get() стабилен, undo/redo — ошибки без событий', () => {
    const { manager, events } = createTestManager();
    const state = manager.history.get();
    expect(state).toEqual({ canUndo: false, canRedo: false });
    expect(manager.history.get()).toBe(state);
    expect(manager.history.undo()).toEqual({ ok: false, error: { kind: 'nothing-to-undo' } });
    expect(manager.history.redo()).toEqual({ ok: false, error: { kind: 'nothing-to-redo' } });
    expect(events).toEqual([]);
    expect(manager.document.isDirty()).toBe(false);
  });

  it('addContours → комната; undo → пустой этаж (та же ссылка layout, что до команды); redo → комната (та же ссылка)', () => {
    const { manager, events, floorId } = createTestManager();
    const layout0 = manager.document.get().floors[0]!.layout;
    expect(manager.document.addContours(floorId, ringContours(0, 0, 400, 300, 10)).ok).toBe(true);
    const layout1 = manager.document.get().floors[0]!.layout;
    expect(manager.document.getDerived().floors[0]!.rooms).toHaveLength(1);
    expect(layout1.contours.map(c => c.kind)).toEqual(['outer', 'inner']);
    expect(events).toEqual(['document:changed', 'history:changed', 'document:dirty-changed']);
    expect(manager.history.get()).toEqual({ canUndo: true, canRedo: false });

    events.length = 0;
    expect(manager.history.undo()).toEqual({ ok: true, value: undefined });
    expect(manager.document.get().floors[0]!.layout).toBe(layout0);
    expect(manager.document.getDerived().floors[0]!.walls).toHaveLength(0);
    expect(events).toEqual(['document:changed', 'history:changed']);
    expect(manager.history.get()).toEqual({ canUndo: false, canRedo: true });

    events.length = 0;
    expect(manager.history.redo().ok).toBe(true);
    expect(manager.document.get().floors[0]!.layout).toBe(layout1);
    expect(events).toEqual(['document:changed', 'history:changed']);
    expect(manager.history.get()).toEqual({ canUndo: true, canRedo: false });
  });

  it('снимок берётся после normalize: undo/redo кольца возвращают слитые outer+inner и запись комнаты по ссылке', () => {
    const { manager, floorId } = createTestManager(ringDocument());
    const layout0 = manager.document.get().floors[0]!.layout;
    expect(layout0.contours.map(c => c.kind)).toEqual(['outer', 'inner']);
    manager.document.movePoints(floorId, [
      { id: 'p2', x: 500, y: 0 },
      { id: 'p3', x: 500, y: 300 },
      { id: 'p6', x: 490, y: 10 },
      { id: 'p7', x: 490, y: 290 },
    ]);
    const layout1 = manager.document.get().floors[0]!.layout;
    expect(manager.document.getDerived().floors[0]!.rooms[0]!.area).toBe(480 * 280);
    manager.history.undo();
    expect(manager.document.get().floors[0]!.layout).toBe(layout0);
    expect(manager.document.getDerived().floors[0]!.rooms[0]!.area).toBe(380 * 280);
    manager.history.redo();
    expect(manager.document.get().floors[0]!.layout).toBe(layout1);
  });

  it('undo/redo не трогают view и settings; scene при restore layout сохраняет ссылку', () => {
    const { manager, floorId } = createTestManager();
    manager.document.addContours(floorId, [rectContour(0, 0, 400, 300)]);
    manager.document.setSettings({ wallHeight: 300, units: 'm' });
    manager.view.setCamera('plan', { x: 5, y: 6, zoom: 0.3 });
    const view = manager.view.get();
    const settings = manager.document.get().settings;
    const scene = manager.document.get().floors[0]!.scene;
    manager.history.undo();
    expect(manager.view.get()).toBe(view);
    expect(manager.document.get().settings).toBe(settings);
    expect(manager.document.get().floors[0]!.scene).toBe(scene);
    manager.history.redo();
    expect(manager.view.get()).toBe(view);
    expect(manager.document.get().settings).toBe(settings);
  });

  it('новая запись режет redo-хвост', () => {
    const { manager, floorId } = createTestManager();
    manager.document.addContours(floorId, [rectContour(0, 0, 400, 300)]);
    manager.history.undo();
    expect(manager.history.get().canRedo).toBe(true);
    manager.document.addContours(floorId, [rectContour(1000, 1000, 1400, 1300)]);
    expect(manager.history.get()).toEqual({ canUndo: true, canRedo: false });
    expect(manager.history.redo().ok).toBe(false);
  });

  it('транзакция без изменений (те же координаты) записи не порождает и событий не даёт', () => {
    const { manager, events, floorId } = createTestManager(ringDocument());
    events.length = 0;
    expect(manager.document.movePoints(floorId, [{ id: 'p1', x: 0, y: 0 }]).ok).toBe(true);
    expect(events).toEqual([]);
    expect(manager.history.get().canUndo).toBe(false);
  });

  describe('коалесинг (D5)', () => {
    it('серия movePoints с одним ключом = одна запись; undo — к состоянию до серии', () => {
      const { manager, floorId } = createTestManager(ringDocument());
      const layout0 = manager.document.get().floors[0]!.layout;
      for (const x of [1, 2, 3]) {
        manager.document.movePoints(floorId, [{ id: 'p1', x, y: 0 }], { coalesce: 'nudge:p1' });
      }
      expect(manager.document.get().floors[0]!.layout.points['p1']!.x).toBe(3);
      manager.history.undo();
      expect(manager.document.get().floors[0]!.layout).toBe(layout0);
      expect(manager.history.get()).toEqual({ canUndo: false, canRedo: true });
      manager.history.redo();
      expect(manager.document.get().floors[0]!.layout.points['p1']!.x).toBe(3);
    });

    it.each([
      ['другой коммит', (m: ReturnType<typeof createTestManager>) => m.manager.document.deletePoint(m.floorId, 'p8')],
      [
        'другой ключ',
        (m: ReturnType<typeof createTestManager>) =>
          m.manager.document.movePoints(m.floorId, [{ id: 'p2', x: 401, y: 0 }], { coalesce: 'nudge:p2' }),
      ],
      [
        'undo + redo',
        (m: ReturnType<typeof createTestManager>) => {
          m.manager.history.undo();
          m.manager.history.redo();
        },
      ],
    ])('серию рвёт: %s', (_name, breaker) => {
      const tm = createTestManager(ringDocument());
      const { manager, floorId } = tm;
      manager.document.movePoints(floorId, [{ id: 'p1', x: 1, y: 0 }], { coalesce: 'nudge:p1' });
      breaker(tm);
      const before = manager.document.get().floors[0]!.layout;
      manager.document.movePoints(floorId, [{ id: 'p1', x: 2, y: 0 }], { coalesce: 'nudge:p1' });
      manager.history.undo();
      expect(manager.document.get().floors[0]!.layout).toBe(before);
      expect(manager.history.get().canUndo).toBe(true);
    });

    it('load рвёт серию и чистит историю', () => {
      const { manager, floorId } = createTestManager(ringDocument());
      manager.document.movePoints(floorId, [{ id: 'p1', x: 1, y: 0 }], { coalesce: 'nudge:p1' });
      manager.document.load(ringDocument());
      expect(manager.history.get()).toEqual({ canUndo: false, canRedo: false });
      manager.document.movePoints(floorId, [{ id: 'p1', x: 2, y: 0 }], { coalesce: 'nudge:p1' });
      expect(manager.history.get()).toEqual({ canUndo: true, canRedo: false });
      manager.history.undo();
      expect(manager.history.get()).toEqual({ canUndo: false, canRedo: true });
    });

    it('смена вида между правками серию не рвёт', () => {
      const { manager, floorId } = createTestManager(ringDocument());
      const layout0 = manager.document.get().floors[0]!.layout;
      manager.document.movePoints(floorId, [{ id: 'p1', x: 1, y: 0 }], { coalesce: 'nudge:p1' });
      manager.view.setActive('plan');
      manager.view.setActive('constructor');
      manager.document.movePoints(floorId, [{ id: 'p1', x: 2, y: 0 }], { coalesce: 'nudge:p1' });
      manager.history.undo();
      expect(manager.document.get().floors[0]!.layout).toBe(layout0);
      expect(manager.history.get()).toEqual({ canUndo: false, canRedo: true });
    });
  });

  describe('лимит (D6)', () => {
    it('101-я запись вытесняет старейшую: откат ровно на MAX_HISTORY шагов, baseline — первая правка, не создание', () => {
      const { manager, floorId } = createTestManager(ringDocument());
      const layouts = [manager.document.get().floors[0]!.layout];
      for (let i = 1; i <= MAX_HISTORY + 1; i++) {
        manager.document.movePoints(floorId, [{ id: 'p1', x: -i, y: -i }]);
        layouts.push(manager.document.get().floors[0]!.layout);
      }
      let steps = 0;
      while (manager.history.get().canUndo) {
        manager.history.undo();
        steps++;
      }
      expect(steps).toBe(MAX_HISTORY);
      expect(manager.document.get().floors[0]!.layout).toBe(layouts[1]);
    });
  });

  describe('две зоны и активная зона (D4)', () => {
    it('коммит в scene не виден в layout и наоборот; активная зона — по виду', () => {
      const { manager, floorId, events } = createTestManager();
      manager.document.addContours(floorId, [rectContour(0, 0, 400, 300)]);
      expect(manager.history.get()).toEqual({ canUndo: true, canRedo: false });
      events.length = 0;
      manager.view.setActive('plan');
      expect(events).toEqual(['view:changed', 'history:changed']);
      expect(manager.history.get()).toEqual({ canUndo: false, canRedo: false });
      expect(manager.history.undo()).toEqual({ ok: false, error: { kind: 'nothing-to-undo' } });
      events.length = 0;
      manager.view.setActive('constructor');
      expect(events).toEqual(['view:changed', 'history:changed']);
      expect(manager.history.get()).toEqual({ canUndo: true, canRedo: false });
    });

    it('смена вида на вид той же зоны history:changed не даёт', () => {
      const { manager, floorId, events } = createTestManager();
      manager.document.addContours(floorId, [rectContour(0, 0, 400, 300)]);
      manager.view.setActive('plan');
      events.length = 0;
      manager.view.setActive('orbit');
      expect(events).toEqual(['view:changed']);
    });

    it('последняя запись переключает активную зону: правка планировки из вида plan откатывается Ctrl+Z там же', () => {
      const { manager, floorId } = createTestManager();
      manager.view.setActive('plan');
      manager.document.addContours(floorId, [rectContour(0, 0, 400, 300)]);
      expect(manager.history.get()).toEqual({ canUndo: true, canRedo: false });
      expect(manager.history.undo().ok).toBe(true);
      expect(manager.document.get().floors[0]!.layout.contours).toHaveLength(0);
      // Смена вида возвращает зону вида.
      manager.view.setActive('orbit');
      expect(manager.history.get()).toEqual({ canUndo: false, canRedo: false });
    });
  });

  describe('load = reset (D3/D5)', () => {
    it('после load оба контейнера пусты, флаги false, history:changed при смене', () => {
      const { manager, floorId, events } = createTestManager();
      manager.document.addContours(floorId, [rectContour(0, 0, 400, 300)]);
      events.length = 0;
      manager.document.load(createEmptyDocument());
      expect(manager.history.get()).toEqual({ canUndo: false, canRedo: false });
      // `view:changed` — потому что загружен другой объект документа (0048), history:changed — флаги упали.
      expect(events).toEqual(['document:changed', 'view:changed', 'history:changed', 'document:dirty-changed']);
      expect(manager.history.undo().ok).toBe(false);
      manager.view.setActive('plan');
      expect(manager.history.get()).toEqual({ canUndo: false, canRedo: false });
    });

    it('baseline после load — загруженный нормализованный документ; правка → undo возвращает к нему по ссылке', () => {
      const { manager } = createTestManager();
      manager.document.load(ringDocument());
      const floorId = manager.document.get().floors[0]!.id;
      const baseline = manager.document.get().floors[0]!.layout;
      manager.document.movePoints(floorId, [{ id: 'p1', x: -5, y: -5 }]);
      manager.history.undo();
      expect(manager.document.get().floors[0]!.layout).toBe(baseline);
    });
  });

  describe('dirty-флаг (D7)', () => {
    it('создание — false; команда → true + событие один раз; повторная команда события не даёт', () => {
      const { manager, floorId, events } = createTestManager();
      const dirtyEvents: boolean[] = [];
      manager.on('document:dirty-changed', ({ dirty }) => dirtyEvents.push(dirty));
      manager.document.addContours(floorId, [rectContour(0, 0, 400, 300)]);
      expect(manager.document.isDirty()).toBe(true);
      manager.document.addContours(floorId, [rectContour(1000, 0, 1400, 300)]);
      expect(dirtyEvents).toEqual([true]);
      expect(events.filter(e => e === 'document:dirty-changed')).toHaveLength(1);
    });

    it('settings ставит dirty, view — нет', () => {
      const { manager } = createTestManager();
      manager.view.setActive('plan');
      manager.view.setCamera('plan', { x: 1, y: 2, zoom: 0.5 });
      expect(manager.document.isDirty()).toBe(false);
      manager.document.setSettings({ units: 'm' });
      expect(manager.document.isDirty()).toBe(true);
    });

    it('markSaved сбрасывает флаг с событием; undo/redo снова ставят', () => {
      const { manager, floorId } = createTestManager();
      const dirtyEvents: boolean[] = [];
      manager.on('document:dirty-changed', ({ dirty }) => dirtyEvents.push(dirty));
      manager.document.addContours(floorId, [rectContour(0, 0, 400, 300)]);
      manager.document.markSaved();
      expect(manager.document.isDirty()).toBe(false);
      manager.document.markSaved();
      manager.history.undo();
      expect(manager.document.isDirty()).toBe(true);
      manager.document.markSaved();
      manager.history.redo();
      expect(manager.document.isDirty()).toBe(true);
      expect(dirtyEvents).toEqual([true, false, true, false, true]);
    });

    it('load сбрасывает dirty (событие только если был true); ошибочный load не трогает', () => {
      const { manager } = createTestManager();
      const dirtyEvents: boolean[] = [];
      manager.on('document:dirty-changed', ({ dirty }) => dirtyEvents.push(dirty));
      manager.document.load(createEmptyDocument());
      expect(dirtyEvents).toEqual([]);
      const floorId = manager.document.get().floors[0]!.id;
      expect(manager.document.addContours(floorId, [rectContour(0, 0, 400, 300)]).ok).toBe(true);
      expect(manager.document.load({ ...createEmptyDocument(), format: 'x' as never }).ok).toBe(false);
      expect(manager.document.isDirty()).toBe(true);
      manager.document.load(createEmptyDocument());
      expect(manager.document.isDirty()).toBe(false);
      expect(dirtyEvents).toEqual([true, false]);
    });

    it('команда с ошибкой dirty не ставит', () => {
      const { manager, floorId } = createTestManager();
      expect(manager.document.movePoints(floorId, [{ id: 'nope', x: 0, y: 0 }]).ok).toBe(false);
      expect(manager.document.isDirty()).toBe(false);
    });
  });

  it('dispose снимает подписчиков: undo после dispose работает, но событий нет', () => {
    const { manager, floorId, events } = createTestManager();
    manager.document.addContours(floorId, [rectContour(0, 0, 400, 300)]);
    events.length = 0;
    manager.dispose();
    expect(manager.history.undo().ok).toBe(true);
    expect(events).toEqual([]);
  });
});
