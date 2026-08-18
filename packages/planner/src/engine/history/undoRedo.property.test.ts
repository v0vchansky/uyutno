import * as fc from 'fast-check';

import { fcParams } from '../../document/geometry/testing/arbitraries';
import type { PlannerDocument } from '../../document/PlannerDocument';
import { rebuild } from '../rebuild';
import { createTestManager, rectContour, ringDocument, type TestManager } from '../testing/testManager';

/** Шаг случайной сессии: команды планировки, settings, смена вида, undo/redo. */
type Op =
  | { kind: 'move'; index: number; dx: number; dy: number; nudge: boolean }
  | { kind: 'delete'; index: number }
  | { kind: 'add'; x: number; y: number; w: number; h: number; inner: boolean }
  | { kind: 'edge'; index: number; length: number; anchor: 0 | 1 | null }
  | { kind: 'width'; index: number; width: number }
  | { kind: 'settings'; wallHeight: number }
  | { kind: 'view'; plan: boolean }
  | { kind: 'undo' }
  | { kind: 'redo' };

const arbOp: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('move' as const),
      index: fc.nat(),
      dx: fc.integer({ min: -60, max: 60 }),
      dy: fc.integer({ min: -60, max: 60 }),
      nudge: fc.boolean(),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('delete' as const), index: fc.nat() }) },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('add' as const),
      x: fc.integer({ min: -1000, max: 1000 }),
      y: fc.integer({ min: -1000, max: 1000 }),
      w: fc.integer({ min: 60, max: 400 }),
      h: fc.integer({ min: 60, max: 400 }),
      inner: fc.boolean(),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('edge' as const),
      index: fc.nat(),
      length: fc.integer({ min: 10, max: 600 }),
      anchor: fc.constantFrom(0 as const, 1 as const, null),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('width' as const),
      index: fc.nat(),
      width: fc.integer({ min: 0, max: 85 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant('settings' as const), wallHeight: fc.integer({ min: 200, max: 350 }) }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('view' as const), plan: fc.boolean() }) },
  { weight: 3, arbitrary: fc.constant({ kind: 'undo' as const }) },
  { weight: 2, arbitrary: fc.constant({ kind: 'redo' as const }) },
);

const isDeepFrozen = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every(isDeepFrozen);
};

const layoutOf = (tm: TestManager) => tm.manager.document.get().floors[0]!.layout;

const pointIdAt = (tm: TestManager, index: number): string | undefined => {
  const ids = Object.keys(layoutOf(tm).points).sort();
  return ids.length === 0 ? undefined : ids[index % ids.length];
};

/** Инварианты после каждого шага: снимок заморожен, производное = rebuild(документ), флаги истории честные. */
const checkInvariants = (tm: TestManager): void => {
  const document = tm.manager.document.get();
  expect(isDeepFrozen(document)).toBe(true);
  expect(tm.manager.document.getDerived()).toEqual(rebuild(document));
  expect(tm.manager.history.get()).toBe(tm.manager.history.get());
};

const applyOp = (tm: TestManager, op: Op): void => {
  const { manager, floorId } = tm;
  switch (op.kind) {
    case 'move': {
      const id = pointIdAt(tm, op.index);
      if (id === undefined) return;
      const point = layoutOf(tm).points[id]!;
      manager.document.movePoints(
        floorId,
        [{ id, x: point.x + op.dx, y: point.y + op.dy }],
        op.nudge ? { coalesce: `nudge:${id}` } : {},
      );
      return;
    }
    case 'delete': {
      const id = pointIdAt(tm, op.index);
      if (id !== undefined) manager.document.deletePoint(floorId, id);
      return;
    }
    case 'add':
      manager.document.addContours(floorId, [
        rectContour(op.x, op.y, op.x + op.w, op.y + op.h, op.inner ? 'inner' : 'outer'),
      ]);
      return;
    case 'edge': {
      const edges = layoutOf(tm).contours.flatMap(c =>
        c.points.map((a, i) => ({ a, b: c.points[(i + 1) % c.points.length]! })),
      );
      if (edges.length === 0) return;
      const edge = edges[op.index % edges.length]!;
      const anchor = op.anchor === null ? undefined : op.anchor === 0 ? edge.a : edge.b;
      manager.document.setEdgeLength(floorId, edge, op.length, anchor === undefined ? {} : { anchor });
      return;
    }
    case 'width': {
      const axes = manager.document.getDerived().floors[0]!.axes;
      if (axes.length === 0) return;
      const axis = axes[op.index % axes.length]!;
      manager.document.setWallWidth(
        floorId,
        op.index % 2 === 0 ? axis.faces : [axis.faces[1], axis.faces[0]],
        op.width,
      );
      return;
    }
    case 'settings':
      manager.document.setSettings({ wallHeight: op.wallHeight });
      return;
    case 'view':
      manager.view.setActive(op.plan ? 'plan' : 'constructor');
      return;
    case 'undo': {
      const before: PlannerDocument = manager.document.get();
      const canUndo = manager.history.get().canUndo;
      const result = manager.history.undo();
      expect(result.ok).toBe(canUndo);
      if (!result.ok) return;
      // view и settings не тронуты; redo(undo(x)) == x по ссылке поддерева, затем возвращаемся в undo-состояние.
      expect(manager.document.get().view).toBe(before.view);
      expect(manager.document.get().settings).toBe(before.settings);
      const undone = manager.document.get();
      expect(manager.history.redo().ok).toBe(true);
      expect(manager.document.get().floors[0]!.layout).toBe(before.floors[0]!.layout);
      expect(manager.document.get().floors[0]!.scene).toBe(before.floors[0]!.scene);
      expect(manager.history.undo().ok).toBe(true);
      expect(manager.document.get().floors[0]!.layout).toBe(undone.floors[0]!.layout);
      return;
    }
    case 'redo': {
      const before: PlannerDocument = manager.document.get();
      const canRedo = manager.history.get().canRedo;
      const result = manager.history.redo();
      expect(result.ok).toBe(canRedo);
      if (!result.ok) return;
      expect(manager.document.get().view).toBe(before.view);
      expect(manager.document.get().settings).toBe(before.settings);
      const redone = manager.document.get();
      expect(manager.history.undo().ok).toBe(true);
      expect(manager.document.get().floors[0]!.layout).toBe(before.floors[0]!.layout);
      expect(manager.document.get().floors[0]!.scene).toBe(before.floors[0]!.scene);
      expect(manager.history.redo().ok).toBe(true);
      expect(manager.document.get().floors[0]!.layout).toBe(redone.floors[0]!.layout);
      expect(manager.document.get().floors[0]!.scene).toBe(redone.floors[0]!.scene);
      return;
    }
  }
};

describe('история — property (ADR 0018 D10, testing-strategy)', () => {
  it('undo(redo(x)) == x и redo(undo(x)) == x по ссылке поддерева на случайных сессиях; инварианты держатся', () => {
    fc.assert(
      fc.property(fc.array(arbOp, { minLength: 1, maxLength: 30 }), ops => {
        const tm = createTestManager(ringDocument());
        let lastFlags = tm.manager.history.get();
        tm.manager.on('history:changed', state => {
          // history:changed — ровно при смене флагов и с новым снимком.
          expect(state).not.toBe(lastFlags);
          lastFlags = state;
        });
        for (const op of ops) {
          applyOp(tm, op);
          checkInvariants(tm);
          expect(tm.manager.history.get()).toBe(lastFlags);
        }
      }),
      fcParams,
    );
  });

  it('dirty: после любой транзакции содержимого — true; view — не меняет; markSaved снимает', () => {
    fc.assert(
      fc.property(fc.array(arbOp, { minLength: 1, maxLength: 20 }), ops => {
        const tm = createTestManager(ringDocument());
        for (const op of ops) {
          tm.manager.document.markSaved();
          const doc = tm.manager.document.get();
          const flags = tm.manager.history.get();
          applyOp(tm, op);
          const after = tm.manager.document.get();
          const contentChanged = after.floors !== doc.floors || after.settings !== doc.settings;
          // Состоявшийся restore ставит dirty всегда; для остальных операций dirty ⇔ содержимое изменилось.
          const restored = (op.kind === 'undo' && flags.canUndo) || (op.kind === 'redo' && flags.canRedo);
          expect(tm.manager.document.isDirty()).toBe(contentChanged || restored);
        }
      }),
      fcParams,
    );
  });
});
