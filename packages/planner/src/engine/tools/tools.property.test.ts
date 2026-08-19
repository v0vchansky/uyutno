import * as fc from 'fast-check';

import { blocksFromContour, DEFAULT_WALL_WIDTH } from '../../document/geometry/band/blocksFromContour';
import { rectContours } from '../../document/geometry/contours/rectContours';
import { MIN_CONTOUR_POINTS, MIN_WALL_LENGTH } from '../../document/geometry/contours/validateContour';
import { euclDist } from '../../document/geometry/predicates/distance';
import { pointsMatch } from '../../document/geometry/predicates/pointsMatch';
import { fcParams } from '../../document/geometry/testing/arbitraries';
import { DEFAULT_SNAP_FLAGS, type SnapFlags } from '../../document/geometry/snap/getSnapPoint';
import type { Viewport } from '../../document/geometry/viewport';
import { createEmptyDocument, type PlannerDocument } from '../../document/PlannerDocument';
import { quantize } from '../../document/quantize';
import { createTestManager, ringDocument } from '../testing/testManager';
import { DEFAULT_VIEWPORT, type DrawingTool, type PointerInput, type ToolState } from './ToolState';

/** Шаг случайной сессии конструктора: ввод указателя в координатах плана, клавиши, окружение, внешние события. */
type Op =
  | { kind: 'start'; tool: DrawingTool }
  | { kind: 'move'; x: number; y: number; ctrl: boolean }
  | { kind: 'down'; x: number; y: number; ctrl: boolean }
  | { kind: 'up'; x: number; y: number; ctrl: boolean; button: number }
  | { kind: 'click'; x: number; y: number; ctrl: boolean }
  /** Клик ровно в первую/последнюю поставленную точку (без снапа) — замыкание/завершение. */
  | { kind: 'closeFirst' }
  | { kind: 'closeLast' }
  /** Четыре клика по углам квадрата (сторона ≥ MIN_WALL_LENGTH) — заготовка петли для `closeFirst`. */
  | { kind: 'square'; x: number; y: number; size: number; ctrl: boolean }
  /** Happy path целиком: старт → квадрат → клик в первую точку (петля → комната). */
  | { kind: 'ring'; x: number; y: number; size: number }
  /** Happy path «Прямоугольника»: старт → два клика по углам (размеры вокруг порогов 2 × толщины и 15 см). */
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  /** Happy path «Комнаты по точкам»: старт → квадрат → клик в первую вершину. */
  | { kind: 'roomRing'; x: number; y: number; size: number }
  | { kind: 'dblclick'; x: number; y: number }
  | { kind: 'commitPoint'; x: number; y: number }
  | { kind: 'key'; action: 'cancel' | 'undo' | 'redo' | 'nudge' }
  | { kind: 'cancel' }
  | { kind: 'interrupt' }
  | { kind: 'pointerCancel' }
  | { kind: 'blur' }
  | { kind: 'snapFlags'; pointsSnap: boolean; orthoAlign: boolean }
  | { kind: 'viewport'; scale: number; cx: number; cy: number }
  | { kind: 'view'; constructor: boolean }
  | { kind: 'historyUndo' }
  | { kind: 'historyRedo' }
  | { kind: 'load' };

/** Координаты на сетке 5 см в ±600: попадания в углы кольца, замыкания и короткие рёбра случаются часто. */
const arbCoord = fc.integer({ min: -120, max: 120 }).map(v => v * 5);
const arbPointOp = <K extends string>(kind: K) =>
  fc.record({ kind: fc.constant(kind), x: arbCoord, y: arbCoord, ctrl: fc.boolean() });

/** Стороны прямоугольника: обе стороны порогов полой/сплошной (2 × толщины, полость-сливер) и гарда 15 см. */
const arbRectSide = fc.oneof(
  fc.constantFrom(0, 5, 14, 15, 20, 21, 27, 28, 30),
  fc.integer({ min: 3, max: 80 }).map(v => v * 5),
);

const arbOp: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('start' as const),
      tool: fc.constantFrom<DrawingTool>('walls', 'rect', 'room'),
    }),
  },
  { weight: 8, arbitrary: arbPointOp('move' as const) },
  { weight: 12, arbitrary: arbPointOp('click' as const) },
  { weight: 5, arbitrary: fc.constant({ kind: 'closeFirst' as const }) },
  { weight: 2, arbitrary: fc.constant({ kind: 'closeLast' as const }) },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('square' as const),
      x: arbCoord,
      y: arbCoord,
      size: fc.integer({ min: 3, max: 80 }).map(v => v * 5),
      ctrl: fc.boolean(),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('ring' as const),
      x: arbCoord,
      y: arbCoord,
      size: fc.integer({ min: 6, max: 80 }).map(v => v * 5),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('rect' as const),
      x: arbCoord,
      y: arbCoord,
      w: arbRectSide,
      h: arbRectSide,
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('roomRing' as const),
      x: arbCoord,
      y: arbCoord,
      size: fc.integer({ min: 3, max: 80 }).map(v => v * 5),
    }),
  },
  { weight: 2, arbitrary: arbPointOp('down' as const) },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('up' as const),
      x: arbCoord,
      y: arbCoord,
      ctrl: fc.boolean(),
      button: fc.constantFrom(0, 0, 0, 1, 2),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('dblclick' as const), x: arbCoord, y: arbCoord }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('commitPoint' as const), x: arbCoord, y: arbCoord }) },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('key' as const),
      action: fc.constantFrom('cancel' as const, 'undo' as const, 'undo' as const, 'redo' as const, 'nudge' as const),
    }),
  },
  { weight: 1, arbitrary: fc.constant({ kind: 'cancel' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'interrupt' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'pointerCancel' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'blur' as const }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('snapFlags' as const),
      pointsSnap: fc.boolean(),
      orthoAlign: fc.boolean(),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('viewport' as const),
      scale: fc.constantFrom(0.5, 1, 2),
      cx: arbCoord,
      cy: arbCoord,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant('view' as const), constructor: fc.constantFrom(true, true, false) }),
  },
  { weight: 1, arbitrary: fc.constant({ kind: 'historyUndo' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'historyRedo' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'load' as const }) },
);

const NO_MODS = { ctrl: false, meta: false, shift: false, alt: false };
const input = (x: number, y: number, ctrl = false, button = 0): PointerInput => ({
  x,
  y,
  mods: { ...NO_MODS, ctrl },
  button,
});

const isDeepFrozen = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every(isDeepFrozen);
};

const isDrawing = (state: ToolState): boolean => state.kind !== 'editing';

/** Меняет ли шаг документ/историю по контракту (иначе они обязаны остаться прежними по ссылке/значению). */
const mayTouchDocument = (op: Op, before: ToolState): boolean => {
  switch (op.kind) {
    case 'up':
      return isDrawing(before) && op.button === 0;
    case 'closeFirst':
    case 'closeLast':
      // В «Прямоугольнике» клик в origin — всегда дубль.
      return isDrawing(before) && before.kind !== 'making-rect';
    case 'click':
    case 'square':
    case 'commitPoint':
      return isDrawing(before);
    case 'rect':
      // Сторона короче 15 см — гард входа, коммита нет.
      return op.w >= MIN_WALL_LENGTH && op.h >= MIN_WALL_LENGTH;
    case 'ring':
    case 'roomRing':
      return true;
    case 'key':
      return before.kind === 'editing' && (op.action === 'undo' || op.action === 'redo');
    case 'historyUndo':
    case 'historyRedo':
    case 'load':
    case 'view':
      return true;
    default:
      return false;
  }
};

describe('tools — property (ADR 0019 E8, testing-strategy)', () => {
  it('инварианты автомата держатся на случайных сессиях: заморозка, ровно одно tools:changed на изменение, документ не трогается до коммита', () => {
    // Счётчики покрытия: набор операций обязан реально доводить каждый инструмент до коммита (иначе инварианты коммита пусты).
    const commits = { 'making-walls': 0, 'making-rect': 0, 'making-room': 0 };
    let rooms = 0;
    fc.assert(
      fc.property(fc.array(arbOp, { minLength: 15, maxLength: 60 }), ops => {
        const tm = createTestManager(ringDocument());
        const { manager } = tm;
        const { tools } = manager;
        const emitted: ToolState[] = [];
        // Модель общих полей: что автомат обязан отражать в состоянии после каждой команды.
        let expectedFlags: SnapFlags = { ...DEFAULT_SNAP_FLAGS };
        let expectedViewport: Viewport = DEFAULT_VIEWPORT;
        manager.on('tools:changed', ({ state }) => {
          // Payload — свежий снимок, совпадает с `get()` в момент эмита.
          expect(state).toBe(tools.get());
          emitted.push(state);
        });

        for (const op of ops) {
          const before = tools.get();
          const docBefore: PlannerDocument = manager.document.get();
          const historyBefore = manager.history.get();
          const viewBefore = manager.view.get().activeView;
          emitted.length = 0;
          tm.events.length = 0;

          switch (op.kind) {
            case 'start':
              tools.start(op.tool);
              break;
            case 'move':
              tools.pointerMove(input(op.x, op.y, op.ctrl));
              break;
            case 'down':
              tools.pointerDown(input(op.x, op.y, op.ctrl));
              break;
            case 'up':
              tools.pointerUp(input(op.x, op.y, op.ctrl, op.button));
              break;
            case 'click':
              tools.pointerDown(input(op.x, op.y, op.ctrl));
              tools.pointerUp(input(op.x, op.y, op.ctrl));
              break;
            case 'closeFirst':
            case 'closeLast': {
              // В «Прямоугольнике» первая = последняя = origin (клик в него — дубль).
              const points =
                before.kind === 'making-walls' || before.kind === 'making-room'
                  ? before.points
                  : before.kind === 'making-rect' && before.origin
                    ? [before.origin]
                    : [];
              if (points.length === 0) break;
              const target = op.kind === 'closeFirst' ? points[0]! : points[points.length - 1]!;
              tools.pointerDown(input(target.x, target.y, true));
              tools.pointerUp(input(target.x, target.y, true));
              break;
            }
            case 'ring':
              tools.start('walls');
              for (const [dx, dy] of [
                [0, 0],
                [op.size, 0],
                [op.size, op.size],
                [0, op.size],
                [0, 0],
              ] as const) {
                tools.pointerDown(input(op.x + dx, op.y + dy, true));
                tools.pointerUp(input(op.x + dx, op.y + dy, true));
              }
              break;
            case 'rect':
              tools.start('rect');
              for (const [dx, dy] of [
                [0, 0],
                [op.w, op.h],
              ] as const) {
                tools.pointerDown(input(op.x + dx, op.y + dy, true));
                tools.pointerUp(input(op.x + dx, op.y + dy, true));
              }
              break;
            case 'roomRing':
              tools.start('room');
              for (const [dx, dy] of [
                [0, 0],
                [op.size, 0],
                [op.size, op.size],
                [0, op.size],
                [0, 0],
              ] as const) {
                tools.pointerDown(input(op.x + dx, op.y + dy, true));
                tools.pointerUp(input(op.x + dx, op.y + dy, true));
              }
              break;
            case 'square':
              for (const [dx, dy] of [
                [0, 0],
                [op.size, 0],
                [op.size, op.size],
                [0, op.size],
              ] as const) {
                tools.pointerDown(input(op.x + dx, op.y + dy, op.ctrl));
                tools.pointerUp(input(op.x + dx, op.y + dy, op.ctrl));
              }
              break;
            case 'dblclick':
              tools.doubleClick(input(op.x, op.y));
              break;
            case 'commitPoint':
              tools.commitPoint({ x: op.x, y: op.y });
              break;
            case 'key':
              tools.key(op.action === 'nudge' ? { kind: 'nudge', dx: 1, dy: 0, factor: 1 } : { kind: op.action });
              break;
            case 'cancel':
              tools.cancel();
              break;
            case 'interrupt':
              tools.interrupt();
              break;
            case 'pointerCancel':
              tools.pointerCancel();
              break;
            case 'blur':
              tools.blur();
              break;
            case 'snapFlags':
              tools.setSnapFlags({ pointsSnap: op.pointsSnap, orthoAlign: op.orthoAlign });
              expectedFlags = { ...expectedFlags, pointsSnap: op.pointsSnap, orthoAlign: op.orthoAlign };
              break;
            case 'viewport': {
              const viewport = { scale: op.scale, center: { x: op.cx, y: op.cy }, width: 800, height: 600 };
              expect(tools.setViewport(viewport).ok).toBe(true);
              expectedViewport = viewport;
              break;
            }
            case 'view':
              manager.view.setActive(op.constructor ? 'constructor' : 'plan');
              break;
            case 'historyUndo':
              manager.history.undo();
              break;
            case 'historyRedo':
              manager.history.redo();
              break;
            case 'load':
              manager.document.load(createEmptyDocument());
              break;
          }

          const after = tools.get();
          expect(isDeepFrozen(after)).toBe(true);
          expect(tools.get()).toBe(after);
          expect(after.snapFlags).toEqual(expectedFlags);
          expect(after.viewport).toEqual(expectedViewport);
          // Ровно одно событие на изменение состояния и ни одного на no-op (клик — два события указателя → до двух).
          const pointerEvents =
            { click: 2, closeFirst: 2, closeLast: 2, square: 8, ring: 11, rect: 5, roomRing: 11 }[op.kind as string] ??
            1;
          if (after === before) expect(emitted.length).toBe(0);
          else expect(emitted.length).toBeLessThanOrEqual(pointerEvents);
          if (pointerEvents === 1 && after !== before) expect(emitted.length).toBe(1);

          if (isDrawing(after)) expect(manager.view.get().activeView).toBe('constructor');
          if (after.kind === 'making-walls') {
            expect(after.sideFixed).toBe(after.points.length >= MIN_CONTOUR_POINTS);
            expect(after.cursor === null).toBe(after.snap === null);
            for (const [index, point] of after.points.entries()) {
              expect(point.x).toBe(quantize(point.x));
              expect(point.y).toBe(quantize(point.y));
              const previous = after.points[index - 1];
              if (previous) expect(euclDist(previous, point)).toBeGreaterThanOrEqual(MIN_WALL_LENGTH);
              for (const other of after.points.slice(index + 1)) expect(pointsMatch(point, other)).toBe(false);
            }
            const contour = after.cursor ? [...after.points, after.cursor] : after.points;
            expect(after.preview).toEqual(
              blocksFromContour(contour, DEFAULT_WALL_WIDTH, after.side, false, after.startNeighbours ?? undefined),
            );
            if (after.cursor) expect(after.cursor).toEqual(after.snap!.snapped);
          }
          if (after.kind === 'making-rect') {
            expect(after.cursor === null).toBe(after.snap === null);
            if (after.cursor) expect(after.cursor).toEqual(after.snap!.snapped);
            if (after.origin) {
              expect(after.origin.x).toBe(quantize(after.origin.x));
              expect(after.origin.y).toBe(quantize(after.origin.y));
            }
            // Превью — ровно контуры будущего коммита: полая — четыре квада, сплошная — один, без угла/размера — пусто.
            if (
              after.origin &&
              after.cursor &&
              after.origin.x !== after.cursor.x &&
              after.origin.y !== after.cursor.y
            ) {
              const { outer, inner } = rectContours(after.origin, after.cursor, DEFAULT_WALL_WIDTH);
              expect(after.preview).toHaveLength(inner ? 4 : 1);
              if (!inner) expect(after.preview[0]).toEqual(outer);
              else expect(after.preview[0]).toEqual([inner[0], inner[1], outer[1], outer[0]]);
            } else {
              expect(after.preview).toEqual([]);
            }
          }
          if (after.kind === 'making-room') {
            expect(after.cursor === null).toBe(after.snap === null);
            if (after.cursor) expect(after.cursor).toEqual(after.snap!.snapped);
            expect(after.guides.every(guide => guide.face === null)).toBe(true);
            for (const [index, point] of after.points.entries()) {
              expect(point.x).toBe(quantize(point.x));
              expect(point.y).toBe(quantize(point.y));
              const previous = after.points[index - 1];
              if (previous) expect(euclDist(previous, point)).toBeGreaterThanOrEqual(MIN_WALL_LENGTH);
              for (const other of after.points.slice(index + 1)) expect(pointsMatch(point, other)).toBe(false);
            }
            // Локальный стек по построению: снимок i — первые i вершин.
            expect(after.undo.length).toBe(after.points.length);
            for (const [index, snapshot] of after.undo.entries())
              expect(snapshot).toEqual(after.points.slice(0, index));
          }
          // Угол прямоугольника меняет только постановка/старт: движения, окружение, blur, dblclick его хранят.
          if (before.kind === 'making-rect' && after.kind === 'making-rect') {
            const places = [
              'up',
              'click',
              'closeFirst',
              'closeLast',
              'square',
              'commitPoint',
              'start',
              'rect',
              'roomRing',
              'ring',
            ];
            if (!places.includes(op.kind)) expect(after.origin).toBe(before.origin);
          }

          if (!mayTouchDocument(op, before)) {
            expect(manager.document.get()).toBe(docBefore);
            expect(manager.history.get()).toBe(historyBefore);
          }
          // Коммит из рисования: ровно одна транзакция содержимого и переход в editing.
          const changes = tm.events.filter(event => event === 'document:changed').length;
          expect(changes).toBeLessThanOrEqual(1);
          const composite = { ring: 'making-walls', rect: 'making-rect', roomRing: 'making-room' } as const;
          const drawingOp = ['up', 'click', 'closeFirst', 'closeLast', 'square', 'commitPoint'].includes(op.kind);
          const committed =
            op.kind in composite
              ? composite[op.kind as keyof typeof composite]
              : drawingOp && isDrawing(before)
                ? (before.kind as keyof typeof commits)
                : null;
          // Happy path составных ops в конструкторе обязан дойти до коммита (у прямоугольника — при сторонах ≥ 15 см).
          const rectCommittable = op.kind === 'rect' && op.w >= MIN_WALL_LENGTH && op.h >= MIN_WALL_LENGTH;
          if (viewBefore === 'constructor' && (op.kind === 'ring' || op.kind === 'roomRing' || rectCommittable)) {
            expect(changes).toBe(1);
          }
          if (committed && changes === 1) {
            commits[committed]++;
            if (manager.document.getDerived().floors[0]!.rooms.length > 1) rooms++;
            expect(after.kind).toBe('editing');
            expect(manager.history.get().canUndo).toBe(true);
            expect(manager.document.isDirty()).toBe(true);
          }
        }
      }),
      fcParams,
    );
    // Гвард покрытия при фиксированном seed: сессии доходят до коммитов каждым инструментом и до новых комнат.
    expect(commits['making-walls']).toBeGreaterThan(50);
    expect(commits['making-rect']).toBeGreaterThan(50);
    expect(commits['making-room']).toBeGreaterThan(50);
    expect(rooms).toBeGreaterThan(30);
  });
});
