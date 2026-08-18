import { createTestManager, rectContour, ringContours, ringDocument } from '../testing/testManager';

describe('document.addContours (ADR 0018 D1)', () => {
  it('кольцо из 4 квадов одной командой → outer + inner, одна комната, одна запись, одно document:changed', () => {
    const { manager, events, floorId } = createTestManager();
    expect(manager.document.addContours(floorId, ringContours(0, 0, 400, 300, 10))).toEqual({
      ok: true,
      value: undefined,
    });
    const layout = manager.document.get().floors[0]!.layout;
    expect(layout.contours.map(c => c.kind)).toEqual(['outer', 'inner']);
    expect(layout.rooms).toHaveLength(1);
    expect(manager.document.getDerived().floors[0]!.rooms[0]!.area).toBe(380 * 280);
    expect(events.filter(e => e === 'document:changed')).toHaveLength(1);
    expect(manager.history.get()).toEqual({ canUndo: true, canRedo: false });
    manager.history.undo();
    expect(manager.document.get().floors[0]!.layout.contours).toHaveLength(0);
    expect(manager.history.get()).toEqual({ canUndo: false, canRedo: true });
  });

  it('inner-контур («Комната по точкам») → запись комнаты заводит normalize', () => {
    const { manager, floorId } = createTestManager();
    manager.document.addContours(floorId, [rectContour(0, 0, 300, 200, 'inner')]);
    const derived = manager.document.getDerived().floors[0]!;
    expect(derived.rooms).toHaveLength(1);
    expect(derived.walls).toHaveLength(0);
  });

  it('один outer — тело стены без комнаты', () => {
    const { manager, floorId } = createTestManager();
    manager.document.addContours(floorId, [rectContour(1000, 0, 1400, 300)]);
    const derived = manager.document.getDerived().floors[0]!;
    expect(derived.walls).toHaveLength(1);
    expect(derived.rooms).toHaveLength(0);
  });

  it('сварка после квантования: 300.0004 → 300 — id существующей точки', () => {
    const { manager, floorId } = createTestManager();
    manager.document.addContours(floorId, [rectContour(0, 0, 300, 200, 'inner')]);
    const before = Object.keys(manager.document.get().floors[0]!.layout.points);
    manager.document.addContours(floorId, [
      {
        kind: 'inner',
        points: [
          { x: 300.0004, y: 0 },
          { x: 600, y: 0 },
          { x: 600, y: 200 },
          { x: 299.9996, y: 200 },
        ],
      },
    ]);
    const after = Object.keys(manager.document.get().floors[0]!.layout.points);
    expect(after).toHaveLength(6);
    for (const id of before) expect(after).toContain(id);
  });

  it('сварка: одинаковые координаты внутри пакета — один id; существующая точка с тем же ключом — её id', () => {
    const { manager, floorId } = createTestManager();
    manager.document.addContours(floorId, [rectContour(0, 0, 300, 200, 'inner')]);
    const before = manager.document.get().floors[0]!.layout;
    const sharedIds = Object.values(before.points)
      .filter(p => p.x === 300)
      .map(p => p.id)
      .sort();
    expect(sharedIds).toHaveLength(2);

    manager.document.addContours(floorId, [
      rectContour(300, 0, 600, 200, 'inner'),
      rectContour(600, 0, 900, 200, 'inner'),
    ]);
    const after = manager.document.get().floors[0]!.layout;
    // 3 смежные комнаты: 4 + 2 + 2 = 8 точек, общие вершины — один id.
    expect(Object.keys(after.points)).toHaveLength(8);
    for (const id of sharedIds) expect(after.points[id]).toBeDefined();
    expect(after.contours.filter(c => c.kind === 'inner')).toHaveLength(3);
    for (const id of sharedIds) {
      expect(after.contours.filter(c => c.points.includes(id))).toHaveLength(2);
    }
  });

  it('координаты квантуются до 0.001 на границе, -0 → 0', () => {
    const { manager, floorId } = createTestManager();
    manager.document.addContours(floorId, [
      {
        kind: 'inner',
        points: [
          { x: -0, y: 0.0004 },
          { x: 300.0006, y: 0 },
          { x: 300, y: 200 },
          { x: 0, y: 200 },
        ],
      },
    ]);
    const points = Object.values(manager.document.get().floors[0]!.layout.points);
    expect(points.some(p => Object.is(p.x, 0) && p.y === 0)).toBe(true);
    expect(points.some(p => p.x === 300.001 && p.y === 0)).toBe(true);
    expect(points.every(p => Number.isInteger(p.x * 1000) && Number.isInteger(p.y * 1000))).toBe(true);
  });

  it('пустой пакет — ok без транзакции и событий', () => {
    const { manager, events, floorId } = createTestManager();
    const doc = manager.document.get();
    expect(manager.document.addContours(floorId, []).ok).toBe(true);
    expect(manager.document.get()).toBe(doc);
    expect(events).toEqual([]);
  });

  describe('ошибки: документ — тот же объект, событий нет', () => {
    const cases: [string, 'outer' | 'inner', { x: number; y: number }[], unknown][] = [
      [
        '< 3 точек',
        'inner',
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        { kind: 'contour-degenerate', index: 0 },
      ],
      [
        'дубли точек',
        'inner',
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 0 },
          { x: 0, y: 100 },
        ],
        { kind: 'contour-degenerate', index: 0 },
      ],
      [
        'площадь < MIN_CONTOUR_AREA',
        'inner',
        [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
        { kind: 'contour-degenerate', index: 0 },
      ],
      [
        'сливер: площадь ≥ MIN_CONTOUR_AREA, но площадь/периметр < MIN_SP_RATIO',
        'inner',
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 0.6 },
          { x: 0, y: 0.6 },
        ],
        { kind: 'contour-degenerate', index: 0 },
      ],
      [
        'самопересечение (бабочка)',
        'outer',
        [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
          { x: 100, y: 0 },
          { x: 0, y: 100 },
        ],
        { kind: 'contour-self-intersected', index: 0 },
      ],
      [
        'не конечная координата',
        'outer',
        [
          { x: 0, y: 0 },
          { x: Number.NaN, y: 0 },
          { x: 100, y: 100 },
        ],
        { kind: 'invalid-coordinate', index: 0 },
      ],
    ];
    it.each(cases)('%s', (_name, kind, points, error) => {
      const { manager, events, floorId } = createTestManager();
      const doc = manager.document.get();
      expect(manager.document.addContours(floorId, [{ kind, points }])).toEqual({ ok: false, error });
      expect(manager.document.get()).toBe(doc);
      expect(events).toEqual([]);
      expect(manager.document.isDirty()).toBe(false);
    });

    it('граница: площадь ровно MIN_CONTOUR_AREA (10×5) проходит', () => {
      const { manager, floorId } = createTestManager();
      expect(manager.document.addContours(floorId, [rectContour(0, 0, 10, 5, 'inner')]).ok).toBe(true);
    });

    it('invalid-coordinate во втором контуре — index: 1', () => {
      const { manager, floorId } = createTestManager();
      const result = manager.document.addContours(floorId, [
        rectContour(0, 0, 400, 300),
        {
          kind: 'outer',
          points: [
            { x: 0, y: 0 },
            { x: 100, y: Number.POSITIVE_INFINITY },
            { x: 100, y: 100 },
          ],
        },
      ]);
      expect(result).toEqual({ ok: false, error: { kind: 'invalid-coordinate', index: 1 } });
    });

    it('отказ одного контура — отказ всего пакета; index указывает на виновника', () => {
      const { manager, floorId } = createTestManager();
      const doc = manager.document.get();
      const result = manager.document.addContours(floorId, [
        rectContour(0, 0, 400, 300),
        {
          kind: 'outer',
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 100 },
            { x: 100, y: 0 },
            { x: 0, y: 100 },
          ],
        },
      ]);
      expect(result).toEqual({ ok: false, error: { kind: 'contour-self-intersected', index: 1 } });
      expect(manager.document.get()).toBe(doc);
    });

    it('unknown-floor', () => {
      const { manager } = createTestManager(ringDocument());
      expect(manager.document.addContours('nope', [rectContour(0, 0, 400, 300)])).toEqual({
        ok: false,
        error: { kind: 'unknown-floor', floorId: 'nope' },
      });
    });
  });
});
