import { Immer, freeze } from 'immer';

import type { FaceRef } from '../../document/geometry/axes/findAxes';
import { CLEAR_CONTOUR_MIN_LEN } from '../../document/geometry/contours/clearContour';
import type { PlanPosition, PlannerDocument } from '../../document/PlannerDocument';
import { createPlanBuilder, createSequentialIds } from '../../document/testing/planBuilder';
import { normalize } from '../rebuild';
import { createTestManager, ringDocument } from '../testing/testManager';

const immer = new Immer({ autoFreeze: true });

/** Ещё один прогон `normalize` поверх уже нормализованного снимка — то, что делает restore undo/redo (ADR 0018 D3). */
const renormalized = (doc: PlannerDocument): PlannerDocument =>
  immer.produce(freeze(doc, true), draft => normalize(draft, { createId: createSequentialIds('m') }));

const layoutOf = (doc: PlannerDocument) => doc.floors[0]!.layout;
const coordsOf = (doc: PlannerDocument, ids: readonly string[]) =>
  ids.map(id => {
    const p = layoutOf(doc).points[id]!;
    return { x: p.x, y: p.y };
  });

/** Кольцо `ringDocument` после normalize: outer p1 p2 p3 p4, inner p5 p6 p7 p8. */
const outerContour = (doc: PlannerDocument) => layoutOf(doc).contours.find(c => c.kind === 'outer')!;

/** Грань контура по координатам её концов — id после normalize не угадываются по порядку построения. */
const faceBetween = (doc: PlannerDocument, from: PlanPosition, to: PlanPosition): FaceRef => {
  for (const contour of layoutOf(doc).contours) {
    const n = contour.points.length;
    for (let i = 0; i < n; i++) {
      const [a, b] = [contour.points[i]!, contour.points[(i + 1) % n]!];
      const [pa, pb] = [layoutOf(doc).points[a]!, layoutOf(doc).points[b]!];
      if (pa.x === from.x && pa.y === from.y && pb.x === to.x && pb.y === to.y) {
        return { contourId: contour.id, a, b };
      }
    }
  }
  throw new Error(`нет грани (${from.x}, ${from.y}) → (${to.x}, ${to.y})`);
};

/** Торец ленты стены 200×10 — грань длиной ровно `DEFAULT_WALL_WIDTH` = 10 см. */
const capFace = (doc: PlannerDocument): FaceRef => faceBetween(doc, { x: 200, y: 0 }, { x: 200, y: 10 });

describe('document.insertPoint (ADR 0018 D1, задача 0096)', () => {
  it('вставляет вершину в кольцо между соседями: одна транзакция, одно document:changed, одна запись истории', () => {
    const { manager, events, floorId } = createTestManager(ringDocument());
    const contourId = outerContour(manager.document.get()).id;
    const before = manager.document.get();
    events.length = 0;

    const result = manager.document.insertPoint(floorId, { contourId, a: 'p1', b: 'p2' }, { x: 200, y: 0 });
    expect(result.ok).toBe(true);
    const id = result.ok ? result.value : '';

    expect(events).toEqual(['document:changed', 'history:changed', 'document:dirty-changed']);
    const after = manager.document.get();
    expect(layoutOf(after).points[id]).toEqual({ id, x: 200, y: 0 });
    expect(outerContour(after).points).toEqual(['p1', id, 'p2', 'p3', 'p4']);

    expect(manager.history.get()).toEqual({ canUndo: true, canRedo: false });
    manager.history.undo();
    expect(manager.document.get()).toEqual(before);
  });

  it('концы грани перечислены в обратном кольцу порядке — вставка та же', () => {
    const { manager, floorId } = createTestManager(ringDocument());
    const contourId = outerContour(manager.document.get()).id;
    const result = manager.document.insertPoint(floorId, { contourId, a: 'p2', b: 'p1' }, { x: 200, y: 0 });
    expect(result.ok).toBe(true);
    const id = result.ok ? result.value : '';
    expect(outerContour(manager.document.get()).points).toEqual(['p1', id, 'p2', 'p3', 'p4']);
  });

  it('id новой вершины берётся из opts.id — инструмент знает его до транзакции', () => {
    const { manager, floorId } = createTestManager(ringDocument());
    const contourId = outerContour(manager.document.get()).id;
    const result = manager.document.insertPoint(
      floorId,
      { contourId, a: 'p1', b: 'p2' },
      { x: 120, y: 0 },
      {
        id: 'new-1',
      },
    );
    expect(result).toEqual({ ok: true, value: 'new-1' });
    expect(outerContour(manager.document.get()).points).toEqual(['p1', 'new-1', 'p2', 'p3', 'p4']);
  });

  it('координата квантуется до 0.001 см', () => {
    const { manager, floorId } = createTestManager(ringDocument());
    const contourId = outerContour(manager.document.get()).id;
    const result = manager.document.insertPoint(floorId, { contourId, a: 'p1', b: 'p2' }, { x: 123.45678, y: 0 });
    const id = result.ok ? result.value : '';
    expect(layoutOf(manager.document.get()).points[id]).toEqual({ id, x: 123.457, y: 0 });
  });

  describe('отказы — документ не меняется', () => {
    const rejects = (run: (m: ReturnType<typeof createTestManager>) => unknown, expected: unknown): void => {
      const tm = createTestManager(ringDocument());
      const before = tm.manager.document.get();
      tm.events.length = 0;
      expect(run(tm)).toEqual({ ok: false, error: expected });
      expect(tm.manager.document.get()).toBe(before);
      expect(tm.events).toEqual([]);
    };

    it('unknown-floor', () => {
      rejects(
        ({ manager }) => manager.document.insertPoint('nope', { contourId: 'c', a: 'p1', b: 'p2' }, { x: 1, y: 0 }),
        { kind: 'unknown-floor', floorId: 'nope' },
      );
    });

    it('unknown-point — конца грани нет в пуле', () => {
      rejects(
        ({ manager, floorId }) =>
          manager.document.insertPoint(
            floorId,
            { contourId: outerContour(manager.document.get()).id, a: 'p1', b: 'nope' },
            { x: 200, y: 0 },
          ),
        { kind: 'unknown-point', id: 'nope' },
      );
    });

    it('unknown-face — такого контура нет', () => {
      rejects(
        ({ manager, floorId }) =>
          manager.document.insertPoint(floorId, { contourId: 'nope', a: 'p1', b: 'p2' }, { x: 200, y: 0 }),
        { kind: 'unknown-face', face: { contourId: 'nope', a: 'p1', b: 'p2' } },
      );
    });

    it('unknown-face — концы есть, но соседями в кольце не являются', () => {
      rejects(
        ({ manager, floorId }) => {
          const contourId = outerContour(manager.document.get()).id;
          return manager.document.insertPoint(floorId, { contourId, a: 'p1', b: 'p3' }, { x: 200, y: 150 });
        },
        { kind: 'unknown-face', face: { contourId: expect.any(String), a: 'p1', b: 'p3' } },
      );
    });

    it('invalid-coordinate — NaN/Infinity в plain-JSON документ не попадает', () => {
      rejects(
        ({ manager, floorId }) => {
          const contourId = outerContour(manager.document.get()).id;
          return manager.document.insertPoint(floorId, { contourId, a: 'p1', b: 'p2' }, { x: Number.NaN, y: 0 });
        },
        { kind: 'invalid-coordinate' },
      );
    });

    it('duplicate-id — id уже занят точкой пула', () => {
      rejects(
        ({ manager, floorId }) => {
          const contourId = outerContour(manager.document.get()).id;
          return manager.document.insertPoint(floorId, { contourId, a: 'p1', b: 'p2' }, { x: 200, y: 0 }, { id: 'p3' });
        },
        { kind: 'duplicate-id', id: 'p3' },
      );
    });

    it('too-short — обе стороны порога 5 см от каждого конца грани', () => {
      rejects(
        ({ manager, floorId }) => {
          const contourId = outerContour(manager.document.get()).id;
          return manager.document.insertPoint(
            floorId,
            { contourId, a: 'p1', b: 'p2' },
            { x: CLEAR_CONTOUR_MIN_LEN - 0.001, y: 0 },
          );
        },
        { kind: 'too-short' },
      );

      rejects(
        ({ manager, floorId }) => {
          const contourId = outerContour(manager.document.get()).id;
          return manager.document.insertPoint(
            floorId,
            { contourId, a: 'p1', b: 'p2' },
            { x: 400 - CLEAR_CONTOUR_MIN_LEN + 0.001, y: 0 },
          );
        },
        { kind: 'too-short' },
      );
    });

    it('ровно 5 см от конца — проходит: это законная позиция', () => {
      const { manager, floorId } = createTestManager(ringDocument());
      const contourId = outerContour(manager.document.get()).id;
      const result = manager.document.insertPoint(
        floorId,
        { contourId, a: 'p1', b: 'p2' },
        { x: CLEAR_CONTOUR_MIN_LEN, y: 0 },
      );
      expect(result.ok).toBe(true);
    });
  });

  it('коалесинг `insert-point:<id>`: рождение вершины и её постановка — одна запись истории', () => {
    const { manager, floorId } = createTestManager(ringDocument());
    const contourId = outerContour(manager.document.get()).id;
    const before = manager.document.get();
    const result = manager.document.insertPoint(floorId, { contourId, a: 'p1', b: 'p2' }, { x: 200, y: 0 });
    const id = result.ok ? result.value : '';
    manager.document.movePoints(floorId, [{ id, x: 200, y: 40 }], { coalesce: `insert-point:${id}` });

    expect(manager.history.get()).toEqual({ canUndo: true, canRedo: false });
    manager.history.undo();
    expect(manager.document.get()).toEqual(before);
    expect(manager.history.get()).toEqual({ canUndo: false, canRedo: true });
  });

  it('короткая грань в 10 см (торец ленты стены): вершина ровно посередине, `clearContour` её не съедает', () => {
    const b = createPlanBuilder();
    b.rect('outer', 0, 0, 200, 10);
    const { manager, floorId } = createTestManager(b.document());
    // Торец ленты: (200, 0) → (200, 10), ровно `DEFAULT_WALL_WIDTH` = два порога чистки.
    const face = capFace(manager.document.get());
    const result = manager.document.insertPoint(floorId, face, { x: 200, y: 5 });
    expect(result.ok).toBe(true);
    const id = result.ok ? result.value : '';
    const after = manager.document.get();
    expect(layoutOf(after).points[id]).toEqual({ id, x: 200, y: 5 });
    expect(outerContour(after).points).toContain(id);
  });

  it('идемпотентность (сценарий 0073): деление грани, общей с соседним контуром, сходится за один прогон', () => {
    // Две «Комнаты по точкам» с общим ребром x = 100: у каждой свои id вершин.
    const b = createPlanBuilder();
    b.contour('inner', [b.point(0, 0), b.point(100, 0), b.point(100, 100), b.point(0, 100)]);
    b.contour('inner', [b.point(100, 0), b.point(200, 0), b.point(200, 100), b.point(100, 100)]);
    const { manager, floorId } = createTestManager(b.document());

    const before = manager.document.get();
    const face = faceBetween(before, { x: 100, y: 0 }, { x: 100, y: 100 });

    const result = manager.document.insertPoint(floorId, face, { x: 100, y: 50 });
    expect(result.ok).toBe(true);

    // Вершина живёт в обоих контурах уже после первого прогона `normalize` — второго не потребовалось.
    const after = manager.document.get();
    for (const contour of layoutOf(after).contours) {
      expect(coordsOf(after, contour.points)).toContainEqual({ x: 100, y: 50 });
    }
    // `normalize(normalize(x)) == normalize(x)`: повторный прогон снимка ничего не меняет — restore undo/redo цел.
    expect(renormalized(after)).toBe(after);

    manager.history.undo();
    expect(manager.document.get()).toEqual(before);
  });
});
