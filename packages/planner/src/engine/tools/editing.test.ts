import { sameCycle } from '../../document/geometry/contours/cyclicSequence';
import { DRAG_THRESHOLD } from './editHit';
import { POINT_SIZE, WALL_HIT_DIST } from '../../document/geometry/hittest/hitTest';
import { createPlanBuilder } from '../../document/testing/planBuilder';
import type { PlannerDocument } from '../../document/PlannerDocument';
import type { PlannerLogger } from '../PlannerManager';
import { createTestManager, ringDocument, silentLogger } from '../testing/testManager';
import {
  type DraggingPointState,
  type DraggingWallState,
  type EditingState,
  type HitTarget,
  type PointerInput,
  type ToolState,
} from './ToolState';

const NO_MODS = { ctrl: false, meta: false, shift: false, alt: false };
const input = (x: number, y: number, mods: Partial<PointerInput['mods']> = {}, button = 0): PointerInput => ({
  x,
  y,
  mods: { ...NO_MODS, ...mods },
  button,
});

/** Драйвер сценариев правки: указатель в координатах плана, журнал `tools:changed`, доступ к планировке/истории. */
const setup = (document: PlannerDocument = ringDocument()) => {
  const debug = jest.fn();
  const logger: PlannerLogger = { ...silentLogger, debug };
  const tm = createTestManager(document, logger);
  const { manager } = tm;
  const toolStates: ToolState[] = [];
  manager.on('tools:changed', ({ state }) => toolStates.push(state));
  const tools = manager.tools;
  const move = (x: number, y: number, mods?: Partial<PointerInput['mods']>) => tools.pointerMove(input(x, y, mods));
  const down = (x: number, y: number, mods?: Partial<PointerInput['mods']>) => tools.pointerDown(input(x, y, mods));
  const up = (x: number, y: number, mods?: Partial<PointerInput['mods']>) => tools.pointerUp(input(x, y, mods));
  const click = (x: number, y: number, mods?: Partial<PointerInput['mods']>) => {
    down(x, y, mods);
    up(x, y, mods);
  };
  /** Драг: нажатие в `(x0, y0)`, движение за порог, затем по точкам `path`; без отпускания. */
  const drag = (x0: number, y0: number, path: [number, number][], mods?: Partial<PointerInput['mods']>) => {
    down(x0, y0, mods);
    for (const [x, y] of path) move(x, y, mods);
  };
  const editing = (): EditingState => {
    const state = tools.get();
    if (state.kind !== 'editing') throw new Error(`expected editing, got ${state.kind}`);
    return state;
  };
  const draggingPoint = (): DraggingPointState => {
    const state = tools.get();
    if (state.kind !== 'dragging-point') throw new Error(`expected dragging-point, got ${state.kind}`);
    return state;
  };
  const draggingWall = (): DraggingWallState => {
    const state = tools.get();
    if (state.kind !== 'dragging-wall') throw new Error(`expected dragging-wall, got ${state.kind}`);
    return state;
  };
  const layout = () => manager.document.get().floors[0]!.layout;
  const point = (id: string) => {
    const p = layout().points[id];
    return p ? { x: p.x, y: p.y } : null;
  };
  const derived = () => manager.document.getDerived().floors[0]!;
  const changes = () => tm.events.filter(e => e === 'document:changed').length;
  return {
    ...tm,
    tools,
    toolStates,
    debug,
    move,
    down,
    up,
    click,
    drag,
    editing,
    draggingPoint,
    draggingWall,
    layout,
    point,
    derived,
    changes,
  };
};

type Setup = ReturnType<typeof setup>;

/** Кольцо `ringDocument`: outer p1(0,0) p2(400,0) p3(400,300) p4(0,300); inner p5(10,10) p6(390,10) p7(390,290) p8(10,290). */
const outerFace = (s: Setup, a: string, b: string): HitTarget => ({
  kind: 'wall',
  face: { contourId: s.layout().contours.find(c => c.kind === 'outer')!.id, a, b },
});
const innerFace = (s: Setup, a: string, b: string): HitTarget => ({
  kind: 'wall',
  face: { contourId: s.layout().contours.find(c => c.kind === 'inner')!.id, a, b },
});
const roomTarget = (s: Setup): HitTarget => ({ kind: 'room', roomId: s.derived().rooms[0]!.roomId });

/** Два отдельных квада стен: A (0,0)–(100,100), B (200,200)–(300,300); точки p1–p4 и p5–p8. */
const twoBlocks = (): PlannerDocument => {
  const b = createPlanBuilder();
  b.rect('outer', 0, 0, 100, 100);
  b.rect('outer', 200, 200, 300, 300);
  return b.document();
};

describe('tools — правка в editing (ADR 0019 E4, задача 0059)', () => {
  describe('hover', () => {
    it('хит-тест по приоритету на каждом pointerMove: вершина → сторона → комната → пусто; та же цель — без события', () => {
      const s = setup();
      s.move(2, 2);
      expect(s.editing().hover).toEqual({ kind: 'point', id: 'p1' });
      s.move(200, 2);
      expect(s.editing().hover).toEqual(outerFace(s, 'p1', 'p2'));
      s.move(200, 12);
      expect(s.editing().hover).toEqual(innerFace(s, 'p5', 'p6'));
      s.move(200, 150);
      expect(s.editing().hover).toEqual(roomTarget(s));
      s.move(1000, 1000);
      expect(s.editing().hover).toBeNull();
      expect(s.toolStates).toHaveLength(5);
      // Движение внутри той же цели — та же ссылка hover, события нет.
      s.move(210, 150);
      const before = s.tools.get();
      s.move(220, 160);
      expect(s.tools.get()).toBe(before);
      expect(s.toolStates).toHaveLength(6);
      expect(s.events).not.toContain('document:changed');
    });

    it('пороги в px делятся на scale: при scale 2 радиус вершины 3 см, стороны 2.5 см', () => {
      const s = setup();
      s.tools.setViewport({ scale: 2, center: { x: 0, y: 0 }, width: 1024, height: 768 });
      s.move(POINT_SIZE / 2 / 2, POINT_SIZE / 2 / 2);
      expect(s.editing().hover).toEqual({ kind: 'point', id: 'p1' });
      s.move(200, WALL_HIT_DIST / 2 - 0.01);
      expect(s.editing().hover).toEqual(outerFace(s, 'p1', 'p2'));
      s.move(200, -WALL_HIT_DIST / 2 - 0.01);
      expect(s.editing().hover).toBeNull();
    });

    it('смена документа извне (команда) пересчитывает hover под последним курсором', () => {
      const s = setup();
      s.move(2, 2);
      expect(s.editing().hover).toEqual({ kind: 'point', id: 'p1' });
      s.manager.document.movePoints(s.floorId, [{ id: 'p1', x: -50, y: -50 }]);
      expect(s.editing().hover).toBeNull();
    });
  });

  describe('выделение кликом', () => {
    it('клик по вершине — вершина, по стороне — стена, внутри комнаты — комната, мимо — сброс; Esc — сброс', () => {
      const s = setup();
      s.click(2, 2);
      expect(s.editing().selection).toEqual({ kind: 'point', id: 'p1' });
      s.click(200, 2);
      expect(s.editing().selection).toEqual(outerFace(s, 'p1', 'p2'));
      s.click(200, 150);
      expect(s.editing().selection).toEqual(roomTarget(s));
      s.click(1000, 1000);
      expect(s.editing().selection).toBeNull();
      s.click(2, 2);
      s.tools.cancel();
      expect(s.editing().selection).toBeNull();
      expect(s.editing().pressed).toBeUndefined();
      expect(s.events).not.toContain('document:changed');
    });

    it('Ctrl/Cmd+клик по стороне комнаты (inner) — вся комната; по стороне без комнаты (outer) — стена', () => {
      const s = setup();
      s.click(200, 12, { ctrl: true });
      expect(s.editing().selection).toEqual(roomTarget(s));
      s.click(200, 12, { meta: true });
      expect(s.editing().selection).toEqual(roomTarget(s));
      s.click(200, 2, { ctrl: true });
      expect(s.editing().selection).toEqual(outerFace(s, 'p1', 'p2'));
    });

    it('клик по той же цели — та же ссылка выделения (pressed — два события: нажатие и отпускание); не основная кнопка не нажимает', () => {
      const s = setup();
      s.click(2, 2);
      const before = s.editing();
      s.toolStates.length = 0;
      s.click(2, 2);
      expect(s.editing().selection).toBe(before.selection);
      expect(s.editing().hover).toBe(before.hover);
      expect(s.toolStates).toHaveLength(2);
      s.tools.pointerDown(input(200, 150, {}, 2));
      expect(s.editing().pressed).toBeUndefined();
      s.tools.pointerUp(input(200, 150, {}, 2));
      expect(s.editing().selection).toEqual({ kind: 'point', id: 'p1' });
    });

    it('смена выделения рвёт серию коалесинга (нудж до и после клика мимо — две записи)', () => {
      const s = setup();
      s.click(2, 2);
      s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 });
      s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 });
      expect(s.point('p1')).toEqual({ x: 2, y: 0 });
      s.click(1000, 1000);
      s.click(2, 0);
      s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 });
      expect(s.point('p1')).toEqual({ x: 3, y: 0 });
      s.tools.key({ kind: 'undo' });
      expect(s.point('p1')).toEqual({ x: 2, y: 0 });
      s.tools.key({ kind: 'undo' });
      expect(s.point('p1')).toEqual({ x: 0, y: 0 });
      expect(s.manager.history.get().canUndo).toBe(false);
    });

    it('выделение снимается, если его цель исчезла из документа (команда извне): вершина, сторона, комната', () => {
      const s = setup(twoBlocks());
      s.click(200, 200);
      s.manager.document.deletePoint(s.floorId, 'p5');
      expect(s.editing().selection).toBeNull();
      s.click(50, 0);
      expect(s.editing().selection).toEqual({ kind: 'wall', face: { contourId: 'c1', a: 'p1', b: 'p2' } });
      s.manager.document.deletePoint(s.floorId, 'p2');
      expect(s.editing().selection).toBeNull();
      const ring = setup();
      ring.click(200, 150);
      expect(ring.editing().selection).toEqual(roomTarget(ring));
      ring.manager.document.deletePoint(ring.floorId, 'p5');
      ring.manager.document.deletePoint(ring.floorId, 'p6');
      expect(ring.derived().rooms).toHaveLength(0);
      expect(ring.editing().selection).toBeNull();
    });
  });

  describe('драг вершины', () => {
    it('до порога DRAG_THRESHOLD/scale — editing с pressed, за порогом — dragging-point с pointOverrides; документ не тронут', () => {
      const s = setup();
      s.down(0, 0);
      expect(s.editing().pressed).toEqual({
        target: { kind: 'point', id: 'p1' },
        origin: { x: 0, y: 0 },
        selected: false,
      });
      s.move(DRAG_THRESHOLD, 0);
      expect(s.tools.get().kind).toBe('editing');
      // Ctrl — без снапа (иначе ось x = 0 через p4 вернула бы точку назад): позиция сырая.
      s.move(DRAG_THRESHOLD + 0.001, 0, { ctrl: true });
      const drag = s.draggingPoint();
      expect(drag.pointId).toBe('p1');
      expect(drag.origin).toEqual({ x: 0, y: 0 });
      expect(drag.selection).toEqual({ kind: 'point', id: 'p1' });
      expect(drag.pointOverrides).toEqual({ p1: { x: DRAG_THRESHOLD + 0.001, y: 0 } });
      s.move(-50, -40);
      expect(s.draggingPoint().pointOverrides).toEqual({ p1: { x: -50, y: -40 } });
      expect(s.point('p1')).toEqual({ x: 0, y: 0 });
      expect(s.events).not.toContain('document:changed');
      expect(s.manager.history.get()).toEqual({ canUndo: false, canRedo: false });
      // Порог зависит от scale.
      s.tools.cancel();
      s.tools.setViewport({ scale: 2, center: { x: 0, y: 0 }, width: 1024, height: 768 });
      s.down(0, 0);
      s.move(DRAG_THRESHOLD / 2 + 0.001, 0);
      expect(s.tools.get().kind).toBe('dragging-point');
    });

    it('снап с exceptIds = [pointId]: к своей старой позиции не тянет, к чужой вершине — тянет и даёт dropTarget', () => {
      const s = setup(twoBlocks());
      s.drag(200, 200, [[150, 100]]);
      // (201, 199) — в радиусе снапа от старой позиции p5, но она исключена: победил не угол p5, а крест осей соседей p6/p8.
      s.move(201, 199);
      expect(s.draggingPoint().snap.hit).toEqual({ kind: 'cross' });
      expect(s.draggingPoint().pointOverrides).toEqual({ p5: { x: 200, y: 200 } });
      expect(s.draggingPoint().dropTarget).toBeNull();
      s.move(104, 103);
      const drag = s.draggingPoint();
      expect(drag.snap.hit).toEqual({ kind: 'point', id: 'p3' });
      expect(drag.pointOverrides).toEqual({ p5: { x: 100, y: 100 } });
      expect(drag.dropTarget).toEqual({ kind: 'point', id: 'p3' });
      expect(drag.guides).toEqual([]);
    });

    it('pointerUp → один movePoints (одна запись истории), editing с выделенной вершиной; undo возвращает', () => {
      const s = setup();
      s.drag(0, 0, [
        [-30, -20],
        [-50, -40],
      ]);
      s.events.length = 0;
      s.toolStates.length = 0;
      s.up(-50, -40);
      expect(s.point('p1')).toEqual({ x: -50, y: -40 });
      expect(s.changes()).toBe(1);
      expect(s.editing().selection).toEqual({ kind: 'point', id: 'p1' });
      expect(s.editing().pressed).toBeUndefined();
      // Порядок: tools:changed (editing) → document:changed → tools:changed (hover по новому документу, если изменился).
      expect(s.events.indexOf('tools:changed')).toBeLessThan(s.events.indexOf('document:changed'));
      expect(s.manager.history.get()).toEqual({ canUndo: true, canRedo: false });
      expect(s.derived().rooms).toHaveLength(1);
      s.tools.key({ kind: 'undo' });
      expect(s.point('p1')).toEqual({ x: 0, y: 0 });
      // После undo выделение снято (interrupt).
      expect(s.editing().selection).toBeNull();
    });

    it('серия коалесинга не рвётся входом в драг: нудж → драг с отменой → нудж = одна запись', () => {
      const s = setup();
      s.click(2, 2);
      s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 });
      s.drag(1, 0, [[30, 30]]);
      s.tools.cancel();
      expect(s.editing().selection).toEqual({ kind: 'point', id: 'p1' });
      s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 });
      expect(s.point('p1')).toEqual({ x: 2, y: 0 });
      s.tools.key({ kind: 'undo' });
      expect(s.point('p1')).toEqual({ x: 0, y: 0 });
      expect(s.manager.history.get().canUndo).toBe(false);
    });

    it('дроп на чужую вершину — координата цели, normalize сливает точки', () => {
      const s = setup(twoBlocks());
      s.drag(200, 200, [
        [150, 100],
        [104, 103],
      ]);
      s.up(104, 103);
      expect(s.point('p5')).toBeNull();
      expect(Object.keys(s.layout().points)).toHaveLength(7);
      expect(
        s
          .layout()
          .contours.map(c => c.points.length)
          .sort(),
      ).toEqual([4, 4]);
      expect(s.changes()).toBe(1);
      // Выделенная вершина слилась в другую и проиграла ей id (normalize оставляет меньший id) — выделена выжившая.
      expect(s.editing().selection).toEqual({ kind: 'point', id: 'p3' });
      // Превью последнего кадра совпало с коммитом — «прыжка» на дропе нет.
      s.tools.key({ kind: 'undo' });
      s.drag(200, 200, [
        [150, 100],
        [104, 103],
      ]);
      expect(s.draggingPoint().pointOverrides).toEqual({ p5: { x: 100, y: 100 } });
    });

    it('дроп на чужую вершину, где выживает id перетаскиваемой (меньший) — выделение сохраняется', () => {
      const s = setup(twoBlocks());
      // p3 (100,100) блока A тянем на p5 (200,200) блока B: выживает p3.
      s.drag(100, 100, [
        [150, 150],
        [203, 197],
      ]);
      expect(s.draggingPoint().dropTarget).toEqual({ kind: 'point', id: 'p5' });
      s.up(203, 197);
      expect(s.point('p3')).toEqual({ x: 200, y: 200 });
      expect(s.point('p5')).toBeNull();
      expect(Object.keys(s.layout().points)).toHaveLength(7);
      expect(s.editing().selection).toEqual({ kind: 'point', id: 'p3' });
    });

    it('дроп на сторону — проекция на отрезок, normalize разрезает ребро (T-стык)', () => {
      const s = setup(twoBlocks());
      s.drag(200, 200, [
        [150, 100],
        [102, 50],
      ]);
      const drag = s.draggingPoint();
      expect(drag.dropTarget).toEqual({ kind: 'wall', face: { contourId: 'c1', a: 'p2', b: 'p3' } });
      // Превью — уже проекция на сторону (без «прыжка» на дропе).
      expect(drag.pointOverrides).toEqual({ p5: { x: 100, y: 50 } });
      s.up(103, 51);
      expect(s.point('p5')).toEqual({ x: 100, y: 51 });
      const a = s.layout().contours.find(c => c.points.includes('p1'))!;
      // Кольцо A получило p5 между p2 и p3 (порядок старта кольца после normalize — не контракт).
      expect(sameCycle(a.points, ['p1', 'p2', 'p5', 'p3', 'p4'])).toBe(true);
      expect(s.changes()).toBe(1);
      expect(s.editing().selection).toEqual({ kind: 'point', id: 'p5' });
    });

    it('Ctrl/Cmd — снап выключен, dropTarget пуст, слияние только при тождестве координаты', () => {
      const s = setup(twoBlocks());
      s.drag(200, 200, [
        [150, 100],
        [102, 101],
      ]);
      s.move(102, 101, { ctrl: true });
      const drag = s.draggingPoint();
      expect(drag.pointOverrides).toEqual({ p5: { x: 102, y: 101 } });
      expect(drag.dropTarget).toBeNull();
      expect(drag.snap.hit).toEqual({ kind: 'none' });
      s.up(102, 101, { ctrl: true });
      expect(s.point('p5')).toEqual({ x: 102, y: 101 });
      expect(Object.keys(s.layout().points)).toHaveLength(8);
      // Точное совпадение с Ctrl — тождество квантованной координаты → слияние.
      s.drag(102, 101, [[150, 150]], { meta: true });
      s.move(100, 100, { meta: true });
      s.up(100, 100, { meta: true });
      expect(Object.keys(s.layout().points)).toHaveLength(7);
    });

    it('без сдвига координаты pointerUp — no-op документа (записи нет)', () => {
      const s = setup();
      s.drag(0, 0, [
        [10, 10],
        [0, 0],
      ]);
      s.up(0, 0);
      expect(s.changes()).toBe(0);
      expect(s.manager.history.get().canUndo).toBe(false);
      expect(s.editing().selection).toEqual({ kind: 'point', id: 'p1' });
    });

    it('pointerUp/pointerDown не основной кнопкой драг не завершает; nudge/delete во время драга — handled: false', () => {
      const s = setup();
      s.drag(0, 0, [[-30, -20]]);
      s.tools.pointerDown(input(-30, -20, {}, 2));
      s.tools.pointerUp(input(-30, -20, {}, 2));
      expect(s.tools.get().kind).toBe('dragging-point');
      const before = s.tools.get();
      expect(s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 })).toEqual({ handled: false });
      expect(s.tools.key({ kind: 'delete' })).toEqual({ handled: false });
      expect(s.tools.get()).toBe(before);
      expect(s.events).not.toContain('document:changed');
    });

    it('нажатие на комнате/пустоте со сдвигом за порог — драга нет, pointerUp выделяет цель нажатия', () => {
      const s = setup();
      s.drag(200, 150, [[300, 250]]);
      expect(s.editing().pressed).toEqual({ target: roomTarget(s), origin: { x: 200, y: 150 }, selected: false });
      s.up(300, 250);
      expect(s.editing().selection).toEqual(roomTarget(s));
      s.drag(1000, 1000, [[900, 900]]);
      expect(s.tools.get().kind).toBe('editing');
      s.up(900, 900);
      expect(s.editing().selection).toBeNull();
      expect(s.changes()).toBe(0);
    });

    it('цель нажатия исчезла до порога (команда извне) — pressed теряет цель, драга нет; не конечный нудж — handled: false', () => {
      const s = setup(twoBlocks());
      s.down(200, 200);
      s.manager.document.deletePoint(s.floorId, 'p5');
      expect(s.editing().pressed).toEqual({ target: null, origin: { x: 200, y: 200 }, selected: false });
      s.move(250, 250);
      expect(s.tools.get().kind).toBe('editing');
      s.up(250, 250);
      s.click(0, 0);
      expect(s.tools.key({ kind: 'nudge', dx: Number.NaN, dy: 0, factor: 1 })).toEqual({ handled: false });
      expect(s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: Number.POSITIVE_INFINITY })).toEqual({
        handled: false,
      });
    });

    it.each([
      ['Esc', (s: Setup) => s.tools.cancel()],
      ['key cancel', (s: Setup) => s.tools.key({ kind: 'cancel' })],
      ['blur', (s: Setup) => s.tools.blur()],
      ['pointerCancel', (s: Setup) => s.tools.pointerCancel()],
      ['Ctrl+Z (key undo)', (s: Setup) => s.tools.key({ kind: 'undo' })],
      ['Ctrl+Y (key redo)', (s: Setup) => s.tools.key({ kind: 'redo' })],
    ])(
      '%s во время драга — отмена: editing с тем же выделением, документ/история не тронуты, override сброшен',
      (_, abort) => {
        const s = setup();
        const docBefore = s.manager.document.get();
        s.drag(0, 0, [[-50, -40]]);
        s.events.length = 0;
        abort(s);
        const state = s.editing();
        expect(state.selection).toEqual({ kind: 'point', id: 'p1' });
        expect(state.pressed).toBeUndefined();
        expect('pointOverrides' in state).toBe(false);
        expect(s.manager.document.get()).toBe(docBefore);
        expect(s.manager.history.get()).toEqual({ canUndo: false, canRedo: false });
        expect(s.events).toEqual(['tools:changed']);
        // Последующий pointerUp — уже не коммит.
        s.up(-50, -40);
        expect(s.point('p1')).toEqual({ x: 0, y: 0 });
      },
    );

    it('программный history.undo() во время драга → interrupt: editing без выделения, документ откачен на прошлую запись', () => {
      const s = setup();
      s.manager.document.movePoints(s.floorId, [{ id: 'p2', x: 500, y: 0 }]);
      s.drag(0, 0, [[-50, -40]]);
      expect(s.manager.history.undo().ok).toBe(true);
      expect(s.editing()).toMatchObject({ kind: 'editing', hover: null, selection: null });
      expect(s.point('p2')).toEqual({ x: 400, y: 0 });
      expect(s.point('p1')).toEqual({ x: 0, y: 0 });
    });

    it('interrupt() и load во время драга — editing без выделения, без коммита', () => {
      const s = setup();
      s.drag(0, 0, [[-50, -40]]);
      s.tools.interrupt();
      expect(s.editing()).toMatchObject({ kind: 'editing', hover: null, selection: null });
      s.drag(0, 0, [[-50, -40]]);
      s.manager.document.load(ringDocument());
      expect(s.editing()).toMatchObject({ kind: 'editing', hover: null, selection: null });
      expect(s.point('p1')).toEqual({ x: 0, y: 0 });
    });

    it('смена вида во время драга — отмена, выделение сохраняется, hover пуст', () => {
      const s = setup();
      s.drag(0, 0, [[-50, -40]]);
      s.manager.view.setActive('plan');
      expect(s.editing()).toMatchObject({ kind: 'editing', hover: null, selection: { kind: 'point', id: 'p1' } });
      expect(s.point('p1')).toEqual({ x: 0, y: 0 });
      expect(s.manager.history.get().canUndo).toBe(false);
    });

    it('смена инструмента посреди драга — cancel + start одним переходом, выделение снято', () => {
      const s = setup();
      s.drag(0, 0, [[-50, -40]]);
      s.toolStates.length = 0;
      expect(s.tools.start('walls')).toEqual({ ok: true, value: undefined });
      expect(s.tools.get().kind).toBe('making-walls');
      expect(s.toolStates).toHaveLength(1);
      expect(s.point('p1')).toEqual({ x: 0, y: 0 });
    });

    it('документ сменился под драгом: вершина жива — кадр пересчитан; вершина удалена — жест отменён', () => {
      const s = setup(twoBlocks());
      s.drag(200, 200, [[150, 150]]);
      s.manager.document.movePoints(s.floorId, [{ id: 'p3', x: 150, y: 150 }]);
      // Курсор в (150,150) — теперь там чужая вершина p3: снап/дроп на неё.
      expect(s.draggingPoint().dropTarget).toEqual({ kind: 'point', id: 'p3' });
      s.manager.document.deletePoint(s.floorId, 'p5');
      expect(s.editing().selection).toBeNull();
    });

    it('tools:changed — на каждый кадр драга, ни одного на дубль pointerMove', () => {
      const s = setup();
      s.drag(0, 0, [[-50, -40]]);
      s.toolStates.length = 0;
      s.move(-60, -40);
      s.move(-60, -40);
      expect(s.toolStates).toHaveLength(1);
      expect(Object.isFrozen(s.tools.get())).toBe(true);
    });
  });

  describe('драг стороны', () => {
    it('дельта проецируется на нормаль, оба конца едут одинаково; pointerUp — movePoints двух концов одной записью', () => {
      const s = setup();
      s.drag(200, 0, [[200, -2]]);
      expect(s.tools.get().kind).toBe('editing');
      s.move(230, -20);
      const drag = s.draggingWall();
      expect({ kind: 'wall', face: drag.face }).toEqual(outerFace(s, 'p1', 'p2'));
      expect(drag.selection).toEqual(outerFace(s, 'p1', 'p2'));
      expect(drag.grab).toEqual({ x: 200, y: 0 });
      expect(drag.shift).toBe(-20);
      expect(drag.pointOverrides).toEqual({ p1: { x: 0, y: -20 }, p2: { x: 400, y: -20 } });
      expect('guides' in drag).toBe(false);
      expect(s.point('p1')).toEqual({ x: 0, y: 0 });
      expect(s.events).not.toContain('document:changed');
      s.up(230, -20);
      expect(s.point('p1')).toEqual({ x: 0, y: -20 });
      expect(s.point('p2')).toEqual({ x: 400, y: -20 });
      expect(s.changes()).toBe(1);
      expect(s.manager.history.get()).toEqual({ canUndo: true, canRedo: false });
      expect(s.editing().selection).toEqual(outerFace(s, 'p1', 'p2'));
      expect(s.derived().rooms).toHaveLength(1);
      s.tools.key({ kind: 'undo' });
      expect(s.point('p1')).toEqual({ x: 0, y: 0 });
    });

    it('снап позиции конца учитывается (движение остаётся по нормали), Ctrl — без снапа', () => {
      const s = setup(twoBlocks());
      // Грань p5(200,200) → p6(300,200) блока B, нормаль вниз/вверх; тянем к y=100 (уровень p3/p4 блока A → ось Y).
      s.drag(250, 200, [[250, 150]]);
      s.move(250, 103);
      const drag = s.draggingWall();
      // Кандидат (200,103) → крест осей: x = 200 через p8, y = 100 через p3/p4 → (200,100); сдвиг ровно −100.
      expect(drag.snap.hit).toEqual({ kind: 'cross' });
      expect(drag.shift).toBe(-100);
      expect(drag.pointOverrides).toEqual({ p5: { x: 200, y: 100 }, p6: { x: 300, y: 100 } });
      s.move(250, 103, { ctrl: true });
      expect(s.draggingWall().shift).toBe(-97);
      expect(s.draggingWall().snap.hit).toEqual({ kind: 'none' });
    });

    it('снап-цель, смещённая вдоль грани, даёт только нормальную компоненту: концы не съезжают вдоль стены', () => {
      const b = createPlanBuilder();
      b.rect('outer', 0, 0, 100, 100);
      b.rect('outer', 200, 200, 300, 300);
      // Треугольник с вершиной (193,101) сбоку от будущей позиции конца a (одиночную точку без владельца GC-ит normalize).
      b.contour('outer', [b.point(193, 101), b.point(160, 40), b.point(120, 60)]);
      const s = setup(b.document());
      s.drag(250, 200, [[250, 150]]);
      // Кандидат конца a = (200,103): угловой снап к (193,101) (манхэттен 9 < 10) — цель сбоку; сдвиг берёт только
      // нормальную компоненту (−99), концы остаются на x = 200/300.
      s.move(250, 103);
      const drag = s.draggingWall();
      expect(drag.snap.hit).toEqual({ kind: 'point', id: 'p9' });
      expect(drag.shift).toBe(-99);
      expect(drag.pointOverrides).toEqual({ p5: { x: 200, y: 101 }, p6: { x: 300, y: 101 } });
    });

    it.each([
      ['Esc', (s: Setup) => s.tools.cancel()],
      ['key cancel', (s: Setup) => s.tools.key({ kind: 'cancel' })],
      ['blur', (s: Setup) => s.tools.blur()],
      ['pointerCancel', (s: Setup) => s.tools.pointerCancel()],
      ['Ctrl+Z', (s: Setup) => s.tools.key({ kind: 'undo' })],
      ['Ctrl+Y', (s: Setup) => s.tools.key({ kind: 'redo' })],
    ])('%s во время драга стороны — отмена без коммита, выделение стены сохраняется', (_, abort) => {
      const s = setup();
      s.drag(200, 0, [[230, -20]]);
      abort(s);
      expect(s.editing().selection).toEqual(outerFace(s, 'p1', 'p2'));
      expect(s.point('p1')).toEqual({ x: 0, y: 0 });
      expect(s.manager.history.get().canUndo).toBe(false);
      expect(s.events).not.toContain('document:changed');
    });

    it('interrupt / смена вида / смена инструмента / программный undo во время драга стороны; дубль pointerMove без события', () => {
      const s = setup();
      s.drag(200, 0, [[230, -20]]);
      s.toolStates.length = 0;
      s.move(230, -20);
      expect(s.toolStates).toEqual([]);
      s.tools.start('rect');
      expect(s.tools.get().kind).toBe('making-rect');
      s.tools.cancel();
      s.manager.document.movePoints(s.floorId, [{ id: 'p3', x: 500, y: 300 }]);
      s.drag(200, 0, [[230, -20]]);
      expect(s.manager.history.undo().ok).toBe(true);
      expect(s.editing()).toMatchObject({ hover: null, selection: null });
      expect(s.point('p1')).toEqual({ x: 0, y: 0 });
      s.drag(200, 0, [[230, -20]]);
      s.manager.view.setActive('orbit');
      expect(s.editing()).toMatchObject({ kind: 'editing', hover: null, selection: outerFace(s, 'p1', 'p2') });
      s.manager.view.setActive('constructor');
      s.drag(200, 0, [[230, -20]]);
      s.tools.interrupt();
      expect(s.editing()).toMatchObject({ kind: 'editing', hover: null, selection: null });
      expect(s.point('p1')).toEqual({ x: 0, y: 0 });
    });

    it('грань исчезла под драгом (команда извне) — жест отменён, мёртвое выделение снято', () => {
      const s = setup();
      s.drag(200, 0, [[230, -20]]);
      s.manager.document.deletePoint(s.floorId, 'p1');
      expect(s.editing().selection).toBeNull();
      expect(s.point('p2')).toEqual({ x: 400, y: 0 });
    });
  });

  describe('удаление вершины', () => {
    it('dblClick по выделенной вершине → deletePoint (каскад), выделение и hover сняты, одна запись', () => {
      const s = setup();
      s.click(2, 2);
      s.click(2, 2);
      s.events.length = 0;
      s.tools.doubleClick(input(2, 2));
      expect(s.point('p1')).toBeNull();
      // Обвод тела стал треугольником p2–p3–p4, режущим полость: normalize пересобирает контуры (новые точки на срезе).
      expect(s.layout().contours.every(c => !c.points.includes('p1'))).toBe(true);
      expect(s.changes()).toBe(1);
      expect(s.editing().selection).toBeNull();
      expect(s.manager.history.get()).toEqual({ canUndo: true, canRedo: false });
    });

    it('dblClick по невыделенной вершине / стороне / пустоте / после одного клика — не удаляет', () => {
      const s = setup();
      s.tools.doubleClick(input(2, 2));
      s.click(200, 150);
      s.tools.doubleClick(input(2, 2));
      s.tools.doubleClick(input(200, 2));
      s.tools.doubleClick(input(1000, 1000));
      // Один клик выделил вершину, но подтверждения (второго клика по выделенной) не было.
      s.click(2, 2);
      expect(s.editing().reclicked).toBeUndefined();
      s.tools.doubleClick(input(2, 2));
      expect(s.point('p1')).toEqual({ x: 0, y: 0 });
      // Второй клик по выделенной — подтверждение; клик мимо снимает его.
      s.click(2, 2);
      expect(s.editing().reclicked).toBe('p1');
      s.click(1000, 1000);
      expect(s.editing().reclicked).toBeUndefined();
      expect(s.events).not.toContain('document:changed');
    });

    it('двойной клик, первым кликом завершивший рисование («Прямоугольник»), угол не удаляет', () => {
      const s = setup(createPlanBuilder().document());
      s.tools.start('rect');
      s.click(0, 0);
      // Реальная последовательность двойного клика по второму углу: down/up (коммит) → down/up (клик в editing) → dblclick.
      s.click(300, 200);
      expect(s.tools.get().kind).toBe('editing');
      s.click(300, 200);
      s.tools.doubleClick(input(300, 200));
      expect(s.changes()).toBe(1);
      expect(Object.values(s.layout().points).some(p => p.x === 300 && p.y === 200)).toBe(true);
      expect(s.derived().rooms).toHaveLength(1);
    });

    it('двойной клик, первым кликом завершивший ленту «Стен» у первой точки, вершину не удаляет', () => {
      const s = setup(createPlanBuilder().document());
      s.tools.start('walls');
      s.click(0, 0);
      s.click(300, 0);
      s.click(300, 300);
      s.click(0, 300);
      s.click(0, 0);
      expect(s.tools.get().kind).toBe('editing');
      s.click(0, 0);
      s.tools.doubleClick(input(0, 0));
      expect(s.changes()).toBe(1);
      expect(Object.values(s.layout().points).some(p => p.x === 0 && p.y === 0)).toBe(true);
    });

    it('Delete/Backspace (key delete) по выделенной вершине → deletePoint; по стене/комнате/без выделения — handled: false', () => {
      const s = setup();
      expect(s.tools.key({ kind: 'delete' })).toEqual({ handled: false });
      s.click(200, 2);
      expect(s.tools.key({ kind: 'delete' })).toEqual({ handled: false });
      s.click(200, 150);
      expect(s.tools.key({ kind: 'delete' })).toEqual({ handled: false });
      expect(s.events).not.toContain('document:changed');
      s.click(2, 2);
      expect(s.tools.key({ kind: 'delete' })).toEqual({ handled: true });
      expect(s.point('p1')).toBeNull();
      expect(s.editing().selection).toBeNull();
      expect(s.changes()).toBe(1);
    });

    it('каскад: удаление вершины комнаты (inner) — контур из 3 точек, комната жива; ещё одна → контур < 3 удалён', () => {
      const s = setup();
      s.click(10, 10);
      s.tools.key({ kind: 'delete' });
      expect([...s.layout().contours.find(c => c.kind === 'inner')!.points].sort()).toEqual(['p6', 'p7', 'p8']);
      expect(s.derived().rooms).toHaveLength(1);
      s.click(390, 10);
      s.tools.key({ kind: 'delete' });
      expect(s.layout().contours.filter(c => c.kind === 'inner')).toHaveLength(0);
      expect(s.derived().rooms).toHaveLength(0);
    });
  });

  describe('нудж', () => {
    it('вершина: шаг 1 см (cm), серия — одна запись (coalesce nudge:<id>); undo откатывает всю серию', () => {
      const s = setup();
      s.click(2, 2);
      expect(s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 })).toEqual({ handled: true });
      expect(s.tools.key({ kind: 'nudge', dx: 0, dy: -1, factor: 1 })).toEqual({ handled: true });
      expect(s.tools.key({ kind: 'nudge', dx: -1, dy: 0, factor: 10 })).toEqual({ handled: true });
      expect(s.point('p1')).toEqual({ x: -9, y: -1 });
      expect(s.changes()).toBe(3);
      s.tools.key({ kind: 'undo' });
      expect(s.point('p1')).toEqual({ x: 0, y: 0 });
      expect(s.manager.history.get()).toEqual({ canUndo: false, canRedo: true });
    });

    it('шаг по единицам: mm — 0.1 см, ftin — 1.27 см, m — 1 см; factor 0.1', () => {
      const s = setup();
      s.click(2, 2);
      s.manager.document.setSettings({ units: 'mm' });
      s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 });
      expect(s.point('p1')).toEqual({ x: 0.1, y: 0 });
      s.manager.document.setSettings({ units: 'ftin' });
      s.tools.key({ kind: 'nudge', dx: 0, dy: 1, factor: 1 });
      expect(s.point('p1')).toEqual({ x: 0.1, y: 1.27 });
      s.manager.document.setSettings({ units: 'm' });
      s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 0.1 });
      expect(s.point('p1')).toEqual({ x: 0.2, y: 1.27 });
    });

    it('сторона: оба конца, ключ nudge:<a>|<b>; смена выделения на другую сторону — новая серия', () => {
      const s = setup();
      s.click(200, 2);
      expect(s.tools.key({ kind: 'nudge', dx: 0, dy: -1, factor: 1 })).toEqual({ handled: true });
      s.tools.key({ kind: 'nudge', dx: 0, dy: -1, factor: 1 });
      expect(s.point('p1')).toEqual({ x: 0, y: -2 });
      expect(s.point('p2')).toEqual({ x: 400, y: -2 });
      s.click(398, 150);
      s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 });
      expect(s.point('p2')).toEqual({ x: 401, y: -2 });
      expect(s.point('p3')).toEqual({ x: 401, y: 300 });
      s.tools.key({ kind: 'undo' });
      expect(s.point('p2')).toEqual({ x: 400, y: -2 });
      s.tools.key({ kind: 'undo' });
      expect(s.point('p2')).toEqual({ x: 400, y: 0 });
      expect(s.manager.history.get().canUndo).toBe(false);
    });

    it('комната или без выделения — handled: false (вьювер панорамирует), документ не тронут', () => {
      const s = setup();
      expect(s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 })).toEqual({ handled: false });
      s.click(200, 150);
      expect(s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 })).toEqual({ handled: false });
      expect(s.events).not.toContain('document:changed');
    });

    it('серию рвёт другой коммит (драг) и undo', () => {
      const s = setup();
      s.click(2, 2);
      s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 });
      s.drag(1, 0, [[-50, -40]]);
      s.up(-50, -40);
      s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 });
      expect(s.point('p1')).toEqual({ x: -49, y: -40 });
      s.tools.key({ kind: 'undo' });
      expect(s.point('p1')).toEqual({ x: -50, y: -40 });
      s.tools.key({ kind: 'undo' });
      expect(s.point('p1')).toEqual({ x: 1, y: 0 });
      s.tools.key({ kind: 'undo' });
      expect(s.point('p1')).toEqual({ x: 0, y: 0 });
    });
  });

  it('вне конструктора: указатель/dblClick/нудж/Delete — no-op (handled: false), выделение сохраняется до возврата', () => {
    const s = setup();
    s.click(2, 2);
    s.manager.view.setActive('plan');
    s.toolStates.length = 0;
    s.move(200, 150);
    s.click(200, 150);
    s.tools.doubleClick(input(2, 2));
    s.drag(2, 2, [[50, 50]]);
    expect(s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 })).toEqual({ handled: false });
    expect(s.tools.key({ kind: 'delete' })).toEqual({ handled: false });
    expect(s.toolStates).toEqual([]);
    expect(s.editing()).toMatchObject({ hover: null, selection: { kind: 'point', id: 'p1' } });
    expect(s.events).not.toContain('document:changed');
    s.manager.view.setActive('constructor');
    expect(s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 })).toEqual({ handled: true });
    expect(s.point('p1')).toEqual({ x: 1, y: 0 });
  });

  it('состояние заморожено на каждом переходе; payload события — снимок get()', () => {
    const s = setup();
    s.drag(0, 0, [[-50, -40]]);
    for (const state of s.toolStates) expect(Object.isFrozen(state)).toBe(true);
    expect(s.toolStates[s.toolStates.length - 1]).toBe(s.tools.get());
  });
});
