import { DEFAULT_WALL_WIDTH } from '../../document/geometry/band/blocksFromContour';
import { CLOSE_EPS } from '../../document/geometry/contours/contourClosure';
import { MIN_WALL_LENGTH } from '../../document/geometry/contours/validateContour';
import { DEFAULT_SNAP_FLAGS } from '../../document/geometry/snap/getSnapPoint';
import { createEmptyDocument, type PlannerDocument } from '../../document/PlannerDocument';
import type { PlannerLogger } from '../PlannerManager';
import { createTestManager, ringDocument, silentLogger } from '../testing/testManager';
import {
  DEFAULT_VIEWPORT,
  type MakingRectState,
  type MakingRoomState,
  type MakingWallsState,
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

/** Драйвер сценариев: указатель в координатах плана, журнал `tools:changed`, шпион `debug` для молчаливых отказов. */
const setup = (document?: PlannerDocument) => {
  const debug = jest.fn();
  const logger: PlannerLogger = { ...silentLogger, debug };
  const tm = createTestManager(document, logger);
  const { manager } = tm;
  const toolStates: ToolState[] = [];
  manager.on('tools:changed', ({ state }) => toolStates.push(state));
  const tools = manager.tools;
  const move = (x: number, y: number, mods?: Partial<PointerInput['mods']>) => tools.pointerMove(input(x, y, mods));
  const click = (x: number, y: number, mods?: Partial<PointerInput['mods']>) => {
    tools.pointerDown(input(x, y, mods));
    tools.pointerUp(input(x, y, mods));
  };
  const walls = (): MakingWallsState => {
    const state = tools.get();
    if (state.kind !== 'making-walls') throw new Error(`expected making-walls, got ${state.kind}`);
    return state;
  };
  const rect = (): MakingRectState => {
    const state = tools.get();
    if (state.kind !== 'making-rect') throw new Error(`expected making-rect, got ${state.kind}`);
    return state;
  };
  const room = (): MakingRoomState => {
    const state = tools.get();
    if (state.kind !== 'making-room') throw new Error(`expected making-room, got ${state.kind}`);
    return state;
  };
  const layout = () => manager.document.get().floors[0]!.layout;
  const derived = () => manager.document.getDerived().floors[0]!;
  const contours = () => layout().contours.map(c => [c.kind, c.points.length]);
  return { ...tm, tools, toolStates, debug, move, click, walls, rect, room, layout, derived, contours };
};

type Setup = ReturnType<typeof setup>;

/** Рисует прямоугольник 400×300 от (0,0) кликами; последний клик — в первую точку (замыкание). */
const drawRing = (s: Setup): void => {
  s.tools.start('walls');
  s.click(0, 0);
  s.click(400, 0);
  s.click(400, 300);
  s.click(0, 300);
  s.move(0, 0);
  s.click(0, 0);
};

describe('tools — автомат инструментов (ADR 0019 E1)', () => {
  describe('исходное состояние', () => {
    it('editing без hover/выделения, дефолтные флаги снапа и viewport; снимок заморожен и стабилен', () => {
      const s = setup();
      const state = s.tools.get();
      expect(state).toEqual({
        kind: 'editing',
        hover: null,
        selection: null,
        snapFlags: DEFAULT_SNAP_FLAGS,
        viewport: DEFAULT_VIEWPORT,
      });
      expect(Object.isFrozen(state)).toBe(true);
      expect(s.tools.get()).toBe(state);
      expect(s.toolStates).toEqual([]);
    });

    it('editing: указатель, dblClick, pointerCancel, blur, commitPoint, Esc без выделения — no-op без событий', () => {
      const s = setup();
      const before = s.tools.get();
      s.move(10, 10);
      s.click(10, 10);
      s.tools.doubleClick(input(10, 10));
      s.tools.pointerCancel();
      s.tools.blur();
      s.tools.cancel();
      expect(s.tools.commitPoint({ x: 1, y: 2 })).toEqual({
        ok: false,
        error: { kind: 'not-drawing', state: 'editing' },
      });
      expect(s.tools.get()).toBe(before);
      expect(s.toolStates).toEqual([]);
      expect(s.events).toEqual([]);
    });

    it('editing: key undo/redo → history.undo/redo (handled), nudge — handled: false', () => {
      const s = setup(ringDocument());
      s.manager.document.deletePoint(s.floorId, Object.keys(s.layout().points)[0]!);
      const afterDelete = s.manager.document.get();
      expect(s.tools.key({ kind: 'undo' })).toEqual({ handled: true });
      expect(s.manager.history.get()).toEqual({ canUndo: false, canRedo: true });
      expect(s.tools.key({ kind: 'redo' })).toEqual({ handled: true });
      expect(s.manager.document.get().floors[0]!.layout).toBe(afterDelete.floors[0]!.layout);
      // Пустой стек — тоже handled: клавиша принадлежит автомату, просто откатывать нечего.
      expect(s.tools.key({ kind: 'redo' })).toEqual({ handled: true });
      expect(s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 })).toEqual({ handled: false });
      expect(s.tools.key({ kind: 'cancel' })).toEqual({ handled: true });
      expect(s.toolStates).toEqual([]);
    });
  });

  describe('start', () => {
    it("start('walls') → making-walls с пустым контуром, событие tools:changed", () => {
      const s = setup();
      expect(s.tools.start('walls')).toEqual({ ok: true, value: undefined });
      expect(s.walls()).toMatchObject({
        points: [],
        cursor: null,
        side: 'left',
        sideFixed: false,
        startNeighbours: null,
        preview: [],
        snap: null,
        guides: [],
        undo: [],
        redo: [],
      });
      expect(s.toolStates).toHaveLength(1);
      expect(s.toolStates[0]).toBe(s.tools.get());
    });

    it('неизвестный инструмент → unknown-tool; вне конструктора → view-not-constructor; без этажей → no-active-floor', () => {
      const s = setup();
      expect(s.tools.start('area' as never)).toEqual({ ok: false, error: { kind: 'unknown-tool', tool: 'area' } });
      s.manager.view.setActive('plan');
      expect(s.tools.start('walls')).toEqual({ ok: false, error: { kind: 'view-not-constructor', view: 'plan' } });
      s.manager.view.setActive('constructor');
      const empty = { ...createEmptyDocument(), floors: [] };
      s.manager.document.load(empty);
      expect(s.tools.start('walls')).toEqual({ ok: false, error: { kind: 'no-active-floor' } });
      expect(s.tools.get().kind).toBe('editing');
    });

    it('старт с уже известным указателем: курсор снапнут сразу, без движения', () => {
      const s = setup();
      s.move(12.3456, 7);
      s.tools.start('walls');
      expect(s.walls().cursor).toEqual({ x: 12.346, y: 7 });
      expect(s.walls().snap?.hit).toEqual({ kind: 'none' });
    });

    it('смена инструмента посреди рисования = отмена + старт одним переходом: точки сброшены, документ не тронут', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.click(200, 0);
      s.toolStates.length = 0;
      expect(s.tools.start('walls').ok).toBe(true);
      expect(s.walls().points).toEqual([]);
      expect(s.toolStates).toHaveLength(1);
      expect(s.layout().contours).toEqual([]);
    });
  });

  describe('«Стены»: указатель и постановка точек', () => {
    it('pointerMove обновляет курсор, превью и снап; каждое движение — ровно одно tools:changed', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.toolStates.length = 0;
      s.move(100, 0);
      expect(s.walls().cursor).toEqual({ x: 100, y: 0 });
      expect(s.walls().preview).toHaveLength(1);
      s.move(200, 50);
      expect(s.walls().cursor).toEqual({ x: 200, y: 50 });
      expect(s.toolStates).toHaveLength(2);
    });

    it('дубль pointerMove в ту же точку — no-op без события; нефинитный ввод игнорируется', () => {
      const s = setup();
      s.tools.start('walls');
      s.move(50, 50);
      const before = s.tools.get();
      s.toolStates.length = 0;
      s.move(50, 50);
      s.move(Number.NaN, 50);
      s.move(50, Number.POSITIVE_INFINITY);
      expect(s.tools.get()).toBe(before);
      expect(s.toolStates).toEqual([]);
    });

    it('клик = pointerDown + pointerUp основной кнопки: точка ставится в snap.snapped на pointerUp', () => {
      const s = setup();
      s.tools.start('walls');
      s.tools.pointerDown(input(10, 20));
      expect(s.walls().points).toEqual([]);
      s.tools.pointerUp(input(10, 20));
      expect(s.walls().points).toEqual([{ x: 10, y: 20 }]);
      expect(s.walls().undo).toEqual([[]]);
      // Не основная кнопка — только движение курсора, точки нет.
      s.tools.pointerUp(input(100, 20, {}, 2));
      expect(s.walls().points).toEqual([{ x: 10, y: 20 }]);
      expect(s.walls().cursor).toEqual({ x: 100, y: 20 });
    });

    it('первая точка снапнута к моменту клика (Q31): курсор у существующего угла → точка = угол', () => {
      const s = setup(ringDocument());
      s.tools.start('walls');
      s.move(403, 302);
      expect(s.walls().snap?.hit).toEqual({ kind: 'point', id: expect.any(String) });
      s.click(403, 302);
      expect(s.walls().points).toEqual([{ x: 400, y: 300 }]);
    });

    it('Ctrl/Cmd — снап выключен: курсор = квантованный сырой, hit none, гайдов нет', () => {
      const s = setup(ringDocument());
      s.tools.start('walls');
      s.move(403, 302, { ctrl: true });
      expect(s.walls().snap).toMatchObject({ snapped: { x: 403, y: 302 }, hit: { kind: 'none' }, alignerX: null });
      expect(s.walls().guides).toEqual([]);
      s.move(403, 302, { meta: true });
      expect(s.walls().cursor).toEqual({ x: 403, y: 302 });
    });

    it('снап к точкам рисуемого контура: курсор у первой точки притягивается к ней (draft-кандидаты)', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.click(300, 0);
      s.click(300, 300);
      s.move(4, 3);
      expect(s.walls().cursor).toEqual({ x: 0, y: 0 });
      expect(s.walls().snap?.hit).toEqual({ kind: 'point', id: 'draft:0' });
    });

    it('гайды осей к точкам контура и параллельный пунктир второй грани при рисовании', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.click(300, 0);
      s.move(2, 200);
      const state = s.walls();
      expect(state.cursor).toEqual({ x: 0, y: 200 });
      expect(state.snap?.hit).toEqual({ kind: 'axis', axis: 'x' });
      expect(state.guides).toEqual([
        {
          kind: 'axis-x',
          from: { x: 0, y: 200 },
          to: { id: 'draft:0', x: 0, y: 0 },
          face: { a: { x: DEFAULT_WALL_WIDTH, y: 200 }, b: { x: DEFAULT_WALL_WIDTH, y: 0 } },
        },
      ]);
      // Гайд к самой последней точке (лёг бы на сегмент) — без второй грани.
      s.move(302, 200);
      expect(s.walls().guides).toEqual([
        { kind: 'axis-x', from: { x: 300, y: 200 }, to: { id: 'draft:1', x: 300, y: 0 }, face: null },
      ]);
    });

    it('превью — квады blocksFromContour по точкам + курсору, сторона left по умолчанию', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.move(200, 0);
      const [quad] = s.walls().preview;
      // Лента слева от направления (0,0)→(200,0) при y вверх — офсет в +y.
      expect(quad).toEqual([
        { x: 0, y: DEFAULT_WALL_WIDTH },
        { x: 200, y: DEFAULT_WALL_WIDTH },
        { x: 200, y: 0 },
        { x: 0, y: 0 },
      ]);
    });

    it('sideFixed после третьей точки', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.click(200, 0);
      expect(s.walls().sideFixed).toBe(false);
      s.click(200, 200);
      expect(s.walls().sideFixed).toBe(true);
    });

    it('старт на существующей стене: startNeighbours найдены, сторона авто-выбрана по меньшему углу (следует за курсором до третьей точки), тук-ин в превью', () => {
      const s = setup(ringDocument());
      s.tools.start('walls');
      // Внутренняя грань нижней стены кольца — y = 10, x ∈ (10, 390); старт посередине, без снапа (Ctrl).
      s.click(200, 10, { ctrl: true });
      expect(s.walls().startNeighbours).toEqual([
        { id: expect.any(String), x: 10, y: 10 },
        { id: expect.any(String), x: 390, y: 10 },
      ]);
      s.move(300, 150, { ctrl: true });
      expect(s.walls().side).toBe('right');
      // Тук-ин: начало грани офсета лежит на существующей стене (y = 10), а не на смещённой линии.
      expect(s.walls().preview[0]![0]!.y).toBeCloseTo(10, 6);
      s.move(100, 150, { ctrl: true });
      expect(s.walls().side).toBe('left');
      expect(s.walls().sideFixed).toBe(false);
      s.move(300, 150, { ctrl: true });
      expect(s.walls().side).toBe('right');
      // Ребро короче 5 см (манхэттен) в автовыборе не участвует — сторона сохраняется; ровно 5 — участвует.
      s.move(198, 12, { ctrl: true });
      expect(s.walls().side).toBe('right');
      s.move(196, 11, { ctrl: true });
      expect(s.walls().side).toBe('left');
      // После третьей точки сторона заморожена: курсор с другой стороны её не меняет.
      s.click(300, 150, { ctrl: true });
      expect(s.walls().side).toBe('right');
      expect(s.walls().sideFixed).toBe(false);
      s.click(300, 250, { ctrl: true });
      expect(s.walls().sideFixed).toBe(true);
      s.move(100, 150, { ctrl: true });
      expect(s.walls().side).toBe('right');
      // Старт в пустоте — соседей нет, сторона по умолчанию не зависит от курсора.
      s.tools.start('walls');
      s.click(1000, 1000, { ctrl: true });
      expect(s.walls().startNeighbours).toBeNull();
      s.move(1100, 900, { ctrl: true });
      expect(s.walls().side).toBe('left');
    });

    it('гард входа: ребро короче MIN_WALL_LENGTH (но длиннее толщины) — точка молча игнорируется; ровно на пороге — принимается', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      // Чуть дальше толщины — не замыкание и не точка: «мёртвая зона» (width, MIN_WALL_LENGTH).
      s.click(DEFAULT_WALL_WIDTH + 0.001, 0, { ctrl: true });
      s.click(DEFAULT_WALL_WIDTH + (MIN_WALL_LENGTH - DEFAULT_WALL_WIDTH) / 2, 0, { ctrl: true });
      expect(s.walls().points).toEqual([{ x: 0, y: 0 }]);
      expect(s.debug).toHaveBeenCalledWith(
        expect.stringContaining('walls point ignored: too-short'),
        expect.anything(),
      );
      s.click(MIN_WALL_LENGTH, 0, { ctrl: true });
      expect(s.walls().points).toHaveLength(2);
    });

    it('pointerDown в одной точке, pointerUp в другой — точка ставится там, где отпустили (снап на pointerUp)', () => {
      const s = setup();
      s.tools.start('walls');
      s.tools.pointerDown(input(0, 0));
      s.tools.pointerUp(input(100, 100));
      expect(s.walls().points).toEqual([{ x: 100, y: 100 }]);
    });

    it('гард входа: точка, совпавшая с уже поставленной (не первой/последней), игнорируется', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.click(200, 0);
      s.click(200, 200);
      s.click(0, 200);
      // (200, 0) — вторая точка: замыкания нет (не первая и далеко от последней), дубль → игнор.
      s.click(200, 0, { ctrl: true });
      expect(s.walls().points).toHaveLength(4);
      expect(s.debug).toHaveBeenCalledWith(expect.stringContaining('duplicate-point'), expect.anything());
    });

    it('петля — только от трёх точек: при двух точках клик в первую — дубль (игнор), не замыкание', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.click(200, 0);
      s.click(0, 0, { ctrl: true });
      expect(s.walls().points).toHaveLength(2);
      expect(s.events).not.toContain('document:changed');
    });

    it('гард замыкающего ребра: клик в первую точку с замыкающим ребром короче MIN_WALL_LENGTH — игнор, рисование продолжается', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.click(300, 0);
      s.click(300, 300);
      s.click(0, 12, { ctrl: true });
      s.click(0, 0, { ctrl: true });
      expect(s.walls().points).toHaveLength(4);
      expect(s.debug).toHaveBeenCalledWith(expect.stringContaining('too-short'), expect.anything());
      expect(s.layout().contours).toEqual([]);
    });

    it('команда doubleClick — no-op: не ставит точку и не завершает (ни на последней, ни на первой точке)', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.click(200, 0);
      s.click(200, 200);
      s.click(0, 200);
      s.tools.doubleClick(input(0, 200));
      s.tools.doubleClick(input(0, 0));
      expect(s.walls().points).toHaveLength(4);
      expect(s.layout().contours).toEqual([]);
    });

    it('реальный двойной клик (down/up/down/up/doubleClick): второй pointerUp — клик у последней точки → завершение открытой ленты', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.click(300, 0);
      s.click(300, 300);
      s.click(300, 300);
      s.tools.doubleClick(input(300, 300));
      expect(s.tools.get().kind).toBe('editing');
      // После normalize два квада ленты слиты в один outer-обвод (6 вершин), комнаты нет.
      expect(s.layout().contours.map(c => [c.kind, c.points.length])).toEqual([['outer', 6]]);
      expect(s.derived().rooms).toHaveLength(0);
    });
  });

  describe('«Стены»: завершение и коммит', () => {
    it('замыкание у первой точки (≤ CLOSE_EPS) → одна транзакция addContours → комната; автомат в editing', () => {
      const s = setup();
      s.events.length = 0;
      drawRing(s);
      expect(s.tools.get().kind).toBe('editing');
      expect(s.events.filter(e => e === 'document:changed')).toHaveLength(1);
      // Четыре квада ленты после normalize — один outer-обвод тела стен и один inner-контур комнаты.
      expect(s.layout().contours.map(c => [c.kind, c.points.length])).toEqual([
        ['outer', 4],
        ['inner', 4],
      ]);
      expect(s.derived().rooms).toHaveLength(1);
      expect(s.derived().walls).toHaveLength(1);
      expect(s.manager.history.get()).toEqual({ canUndo: true, canRedo: false });
      // Порядок: сначала tools:changed (editing), затем document:changed.
      const lastTools = s.events.lastIndexOf('tools:changed');
      expect(lastTools).toBeLessThan(s.events.indexOf('document:changed'));
    });

    it.each([
      ['внутри', CLOSE_EPS / 2, true],
      ['ровно на пороге', CLOSE_EPS, true],
      ['чуть дальше', CLOSE_EPS * 2, false],
    ])('порог CLOSE_EPS к первой точке без снапа (Ctrl): %s → замыкание = %p', (_, dx, closes) => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.click(400, 0);
      s.click(400, 300);
      s.click(0, 300);
      s.click(dx, 0, { ctrl: true });
      if (closes) {
        expect(s.tools.get().kind).toBe('editing');
        expect(s.derived().rooms).toHaveLength(1);
      } else {
        expect(s.walls().points).toHaveLength(5);
        expect(s.events).not.toContain('document:changed');
      }
    });

    it('клик у последней точки (≤ толщины) коммитит открытую полилинию — стена без комнаты', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.click(300, 0);
      s.click(300, 200);
      s.click(300 + DEFAULT_WALL_WIDTH, 200, { ctrl: true });
      expect(s.tools.get().kind).toBe('editing');
      expect(s.layout().contours.map(c => [c.kind, c.points.length])).toEqual([['outer', 6]]);
      expect(s.derived().rooms).toHaveLength(0);
      expect(s.derived().walls).toHaveLength(1);
    });

    it('клик на MIN_WALL_LENGTH от последней — не завершение, а новая точка', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.click(300, 0);
      s.click(300 + MIN_WALL_LENGTH, 0, { ctrl: true });
      expect(s.walls().points).toHaveLength(3);
    });

    it('открытая полилиния из одной точки: второй клик в ней — выход в editing без коммита (tooFewPoints)', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.click(0, 0);
      expect(s.tools.get().kind).toBe('editing');
      expect(s.layout().contours).toEqual([]);
      expect(s.events).not.toContain('document:changed');
      expect(s.debug).toHaveBeenCalledWith(expect.stringContaining('tooFewPoints'), expect.anything());
    });

    it.each([
      [
        'selfIntersected',
        [
          [0, 0],
          [300, 300],
          [300, 0],
          [0, 300],
        ],
      ],
      [
        'degenerate',
        [
          [0, 0],
          [300, 0],
          [600, 0],
        ],
      ],
    ] as const)(
      'молчаливый отказ на завершении (%s): editing, документ и история не тронуты, logger.debug',
      (reason, corners) => {
        const s = setup();
        s.tools.start('walls');
        for (const [x, y] of corners) s.click(x, y, { ctrl: true });
        s.click(0, 0, { ctrl: true });
        expect(s.tools.get().kind).toBe('editing');
        expect(s.layout().contours).toEqual([]);
        expect(s.manager.history.get()).toEqual({ canUndo: false, canRedo: false });
        expect(s.debug).toHaveBeenCalledWith(expect.stringContaining(reason), expect.anything());
      },
    );

    it('commitPoint — постановка без снапа тем же путём, включая замыкание', () => {
      const s = setup(ringDocument());
      s.tools.start('walls');
      // Точка в радиусе снапа от угла кольца (400, 300) ставится ровно туда, куда просили (снапа нет), квантованно.
      expect(s.tools.commitPoint({ x: 403, y: 302.0004 })).toEqual({ ok: true, value: undefined });
      expect(s.tools.commitPoint({ x: 703, y: 302 })).toEqual({ ok: true, value: undefined });
      expect(s.walls().points).toEqual([
        { x: 403, y: 302 },
        { x: 703, y: 302 },
      ]);
      // Превью без ввода указателя — по зафиксированным точкам.
      expect(s.walls().cursor).toBeNull();
      expect(s.walls().preview).toHaveLength(1);
      s.tools.commitPoint({ x: 703, y: 602 });
      s.tools.commitPoint({ x: 403, y: 602 });
      s.tools.commitPoint({ x: 403, y: 302 });
      expect(s.tools.get().kind).toBe('editing');
      expect(s.derived().rooms).toHaveLength(2);
    });

    it('commitPoint: точка, отвергнутая гардом, — too-short / duplicate-point, состояние не меняется', () => {
      const s = setup();
      s.tools.start('walls');
      s.tools.commitPoint({ x: 0, y: 0 });
      s.tools.commitPoint({ x: 200, y: 0 });
      const before = s.tools.get();
      expect(s.tools.commitPoint({ x: 212, y: 0 })).toEqual({ ok: false, error: { kind: 'too-short' } });
      expect(s.tools.commitPoint({ x: 0, y: 0 })).toEqual({ ok: false, error: { kind: 'duplicate-point' } });
      expect(s.tools.get()).toBe(before);
    });

    it('commitPoint: нефинитная точка → invalid-point, состояние не меняется', () => {
      const s = setup();
      s.tools.start('walls');
      const before = s.tools.get();
      expect(s.tools.commitPoint({ x: Number.NaN, y: 0 })).toEqual({
        ok: false,
        error: { kind: 'invalid-point', point: { x: Number.NaN, y: 0 } },
      });
      expect(s.tools.get()).toBe(before);
    });

    it('после коммита undo/redo (через tools.key в editing) откатывают и возвращают контур целиком', () => {
      const s = setup();
      drawRing(s);
      expect(s.derived().rooms).toHaveLength(1);
      s.tools.key({ kind: 'undo' });
      expect(s.derived().rooms).toHaveLength(0);
      expect(s.layout().contours).toEqual([]);
      s.tools.key({ kind: 'redo' });
      expect(s.derived().rooms).toHaveLength(1);
    });

    it('история и документ не меняются до коммита', () => {
      const s = setup(ringDocument());
      const doc = s.manager.document.get();
      const history = s.manager.history.get();
      s.tools.start('walls');
      s.click(1000, 1000);
      s.click(1300, 1000);
      s.move(1300, 1200);
      s.tools.key({ kind: 'undo' });
      s.tools.key({ kind: 'redo' });
      expect(s.manager.document.get()).toBe(doc);
      expect(s.manager.history.get()).toBe(history);
      expect(s.manager.document.isDirty()).toBe(false);
    });
  });

  describe('«Стены»: локальные undo/redo (ADR 0018 D8)', () => {
    it('Ctrl+Z снимает последнюю поставленную точку, Ctrl+Y возвращает; стеки в состоянии', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.click(200, 0);
      s.click(200, 200);
      expect(s.tools.key({ kind: 'undo' })).toEqual({ handled: true });
      expect(s.walls().points).toEqual([
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ]);
      expect(s.walls().redo).toHaveLength(1);
      expect(s.walls().sideFixed).toBe(false);
      expect(s.tools.key({ kind: 'redo' })).toEqual({ handled: true });
      expect(s.walls().points).toHaveLength(3);
      expect(s.walls().undo).toHaveLength(3);
      expect(s.walls().redo).toEqual([]);
      // Пустой redo — handled, без изменений и без события.
      s.toolStates.length = 0;
      expect(s.tools.key({ kind: 'redo' })).toEqual({ handled: true });
      expect(s.toolStates).toEqual([]);
    });

    it('новая точка после undo очищает redo', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.click(200, 0);
      s.tools.key({ kind: 'undo' });
      s.click(0, 200);
      expect(s.walls().redo).toEqual([]);
      expect(s.walls().points).toEqual([
        { x: 0, y: 0 },
        { x: 0, y: 200 },
      ]);
    });

    it('undo до пустого холста → editing; история документа не тронута; в пустом рисовании Ctrl+Z — no-op (кнопка disabled по стеку)', () => {
      const s = setup(ringDocument());
      s.manager.document.deletePoint(s.floorId, Object.keys(s.layout().points)[0]!);
      const layout = s.layout();
      s.tools.start('walls');
      s.click(1000, 1000);
      s.tools.key({ kind: 'undo' });
      expect(s.tools.get().kind).toBe('editing');
      expect(s.layout()).toBe(layout);
      s.tools.start('walls');
      s.toolStates.length = 0;
      expect(s.tools.key({ kind: 'undo' })).toEqual({ handled: true });
      expect(s.walls().undo).toEqual([]);
      expect(s.toolStates).toEqual([]);
      expect(s.layout()).toBe(layout);
    });
  });

  describe('«Стены»: отмена и прерывания', () => {
    it('Esc (cancel и key cancel) — отмена всего без коммита → editing', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.click(200, 0);
      s.tools.cancel();
      expect(s.tools.get().kind).toBe('editing');
      s.tools.start('walls');
      s.click(0, 0);
      expect(s.tools.key({ kind: 'cancel' })).toEqual({ handled: true });
      expect(s.tools.get().kind).toBe('editing');
      expect(s.layout().contours).toEqual([]);
      expect(s.events).not.toContain('document:changed');
    });

    it('pointerCancel/blur во время рисования: точки сохраняются, коммита нет, события нет', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.click(200, 0);
      s.toolStates.length = 0;
      s.tools.pointerCancel();
      s.tools.blur();
      expect(s.walls().points).toHaveLength(2);
      expect(s.toolStates).toEqual([]);
    });

    it('interrupt() → editing без коммита', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.tools.interrupt();
      expect(s.tools.get().kind).toBe('editing');
      expect(s.layout().contours).toEqual([]);
    });

    it('программный history.undo() во время рисования → beforeReplace → interrupt: editing, точки потеряны', () => {
      const s = setup(ringDocument());
      s.manager.document.deletePoint(s.floorId, Object.keys(s.layout().points)[0]!);
      s.tools.start('walls');
      s.click(1000, 1000);
      s.click(1300, 1000);
      s.events.length = 0;
      expect(s.manager.history.undo().ok).toBe(true);
      expect(s.tools.get().kind).toBe('editing');
      expect(s.events.indexOf('tools:changed')).toBeLessThan(s.events.indexOf('document:changed'));
    });

    it('history.undo() на пустом стеке хук не зовёт: рисование продолжается', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      expect(s.manager.history.undo().ok).toBe(false);
      expect(s.walls().points).toHaveLength(1);
    });

    it('document.load посреди рисования → interrupt → editing', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      expect(s.manager.document.load(createEmptyDocument()).ok).toBe(true);
      expect(s.tools.get().kind).toBe('editing');
    });

    it('view.setActive вне конструктора посреди рисования → editing без коммита; обратно — остаётся editing', () => {
      const s = setup();
      s.tools.start('walls');
      s.click(0, 0);
      s.click(200, 0);
      s.manager.view.setActive('plan');
      expect(s.tools.get().kind).toBe('editing');
      expect(s.layout().contours).toEqual([]);
      s.toolStates.length = 0;
      s.manager.view.setActive('constructor');
      expect(s.tools.get().kind).toBe('editing');
      expect(s.toolStates).toEqual([]);
    });

    it('document:changed извне во время рисования пересчитывает снап по новому индексу', () => {
      const s = setup();
      s.tools.setViewport({ scale: 1, center: { x: 0, y: 0 }, width: 4000, height: 4000 });
      s.tools.start('walls');
      s.click(1000, 1000);
      s.move(403, 302);
      expect(s.walls().snap?.hit).toEqual({ kind: 'none' });
      s.manager.document.load(ringDocument());
      // load → interrupt → editing; заново: старт и то же движение — уже с углом кольца.
      s.tools.start('walls');
      s.click(1000, 1000);
      s.move(403, 302);
      expect(s.walls().snap?.hit).toEqual({ kind: 'point', id: expect.any(String) });
      // Команда документа без замены (addContours из другого канала) — курсор пересчитан без движения.
      s.move(803, 702);
      expect(s.walls().snap?.hit).toEqual({ kind: 'none' });
      s.manager.document.addContours(s.floorId, [
        {
          kind: 'outer',
          points: [
            { x: 800, y: 700 },
            { x: 900, y: 700 },
            { x: 900, y: 800 },
            { x: 800, y: 800 },
          ],
        },
      ]);
      expect(s.tools.get().kind).toBe('making-walls');
      expect(s.walls().snap?.hit).toEqual({ kind: 'point', id: expect.any(String) });
    });
  });

  describe('«Прямоугольная комната» (ADR 0019 E3, спека 01 «Rectangle Room»)', () => {
    /** Прямоугольник от `(x0, y0)` до `(x1, y1)` двумя кликами без снапа (Ctrl). */
    const drawRect = (s: Setup, x0: number, y0: number, x1: number, y1: number): void => {
      s.tools.start('rect');
      s.click(x0, y0, { ctrl: true });
      s.click(x1, y1, { ctrl: true });
    };

    it("start('rect') → making-rect без угла и курсора, событие tools:changed", () => {
      const s = setup();
      expect(s.tools.start('rect')).toEqual({ ok: true, value: undefined });
      expect(s.rect()).toMatchObject({ origin: null, cursor: null, preview: [], snap: null, guides: [] });
      expect(s.toolStates).toHaveLength(1);
      expect(s.toolStates[0]).toBe(s.tools.get());
    });

    it('до первого клика — только живой курсор без превью; первый клик — origin (снапнут к моменту клика, Q31)', () => {
      const s = setup(ringDocument());
      s.tools.start('rect');
      s.move(403, 302);
      expect(s.rect()).toMatchObject({ origin: null, cursor: { x: 400, y: 300 }, preview: [] });
      expect(s.rect().snap?.hit).toEqual({ kind: 'point', id: expect.any(String) });
      s.click(403, 302);
      expect(s.rect().origin).toEqual({ x: 400, y: 300 });
      // Курсор в углу — прямоугольник нулевого размера, превью пусто.
      expect(s.rect().preview).toEqual([]);
      expect(s.events).not.toContain('document:changed');
    });

    it('живой прямоугольник: полая — четыре квада между outer и inner в форме ленты; каждое движение — одно событие', () => {
      const s = setup();
      s.tools.start('rect');
      s.click(0, 0);
      s.toolStates.length = 0;
      s.move(300, 400);
      const W = DEFAULT_WALL_WIDTH;
      expect(s.rect().preview).toEqual([
        [
          { x: W, y: W },
          { x: 300 - W, y: W },
          { x: 300, y: 0 },
          { x: 0, y: 0 },
        ],
        [
          { x: 300 - W, y: W },
          { x: 300 - W, y: 400 - W },
          { x: 300, y: 400 },
          { x: 300, y: 0 },
        ],
        [
          { x: 300 - W, y: 400 - W },
          { x: W, y: 400 - W },
          { x: 0, y: 400 },
          { x: 300, y: 400 },
        ],
        [
          { x: W, y: 400 - W },
          { x: W, y: W },
          { x: 0, y: 0 },
          { x: 0, y: 400 },
        ],
      ]);
      // Угол в любом квадранте: outer всегда от (minX, minY).
      s.move(-300, -400);
      expect(s.rect().preview[0]![3]).toEqual({ x: -300, y: -400 });
      expect(s.toolStates).toHaveLength(2);
      // Дубль движения — no-op без события.
      s.move(-300, -400);
      expect(s.toolStates).toHaveLength(2);
    });

    it('сплошной прямоугольник (сторона ≤ 2 × толщины) — один квад-прямоугольник в превью', () => {
      const s = setup();
      s.tools.start('rect');
      s.click(0, 0);
      s.move(2 * DEFAULT_WALL_WIDTH, 300, { ctrl: true });
      expect(s.rect().preview).toEqual([
        [
          { x: 0, y: 0 },
          { x: 2 * DEFAULT_WALL_WIDTH, y: 0 },
          { x: 2 * DEFAULT_WALL_WIDTH, y: 300 },
          { x: 0, y: 300 },
        ],
      ]);
      // Обе стороны чуть больше порога, но полость 8×8 валидна — полая; 7×7 (площадь 49 < 50) — сплошная.
      s.move(2 * DEFAULT_WALL_WIDTH + 8, 2 * DEFAULT_WALL_WIDTH + 8, { ctrl: true });
      expect(s.rect().preview).toHaveLength(4);
      s.move(2 * DEFAULT_WALL_WIDTH + 7, 2 * DEFAULT_WALL_WIDTH + 7, { ctrl: true });
      expect(s.rect().preview).toHaveLength(1);
    });

    it('снап второго угла: оси к origin (гайд без второй грани), точки существующих стен', () => {
      const s = setup(ringDocument());
      s.tools.start('rect');
      s.click(-300, -300, { ctrl: true });
      s.move(-50, -297);
      expect(s.rect().cursor).toEqual({ x: -50, y: -300 });
      expect(s.rect().snap?.hit).toEqual({ kind: 'axis', axis: 'y' });
      expect(s.rect().guides).toEqual([
        { kind: 'axis-y', from: { x: -50, y: -300 }, to: { id: 'draft:0', x: -300, y: -300 }, face: null },
      ]);
      s.move(403, 302);
      expect(s.rect().cursor).toEqual({ x: 400, y: 300 });
      // Ctrl/Cmd — снап выключен.
      s.move(403, 302, { meta: true });
      expect(s.rect().cursor).toEqual({ x: 403, y: 302 });
      expect(s.rect().guides).toEqual([]);
    });

    it('второй клик — полая комната: одна транзакция addContours (outer + inner), editing, undo/redo целиком', () => {
      const s = setup();
      s.events.length = 0;
      drawRect(s, 300, 400, 0, 0);
      expect(s.tools.get().kind).toBe('editing');
      expect(s.events.filter(e => e === 'document:changed')).toHaveLength(1);
      expect(s.events.lastIndexOf('tools:changed')).toBeLessThan(s.events.indexOf('document:changed'));
      expect(s.contours()).toEqual([
        ['outer', 4],
        ['inner', 4],
      ]);
      expect(s.derived().rooms).toHaveLength(1);
      expect(s.derived().walls).toHaveLength(1);
      // Та же геометрия, что в golden `plan-rect-room-hollow`: полость 280 × 380.
      expect(s.derived().rooms[0]!.area).toBe(106400);
      const coordinates = Object.values(s.layout().points)
        .map(p => `${p.x},${p.y}`)
        .sort();
      expect(coordinates).toEqual(['0,0', '300,0', '300,400', '0,400', '10,10', '290,10', '290,390', '10,390'].sort());
      expect(s.manager.history.get()).toEqual({ canUndo: true, canRedo: false });
      s.tools.key({ kind: 'undo' });
      expect(s.layout().contours).toEqual([]);
      s.tools.key({ kind: 'redo' });
      expect(s.derived().rooms).toHaveLength(1);
    });

    it('pointerDown в одной точке, pointerUp в другой — угол там, где отпустили; не основная кнопка при поставленном угле — только курсор', () => {
      const s = setup();
      s.tools.start('rect');
      s.tools.pointerDown(input(0, 0));
      s.tools.pointerUp(input(100, 100));
      expect(s.rect().origin).toEqual({ x: 100, y: 100 });
      s.tools.pointerUp(input(400, 500, {}, 2));
      expect(s.rect()).toMatchObject({ origin: { x: 100, y: 100 }, cursor: { x: 400, y: 500 } });
      expect(s.rect().preview).toHaveLength(4);
      expect(s.events).not.toContain('document:changed');
    });

    it('окружение меняется при поставленном угле (setSnapFlags, setViewport, document:changed извне): origin прежний, снап и превью пересчитаны', () => {
      const s = setup();
      s.tools.setViewport({ scale: 1, center: { x: 0, y: 0 }, width: 4000, height: 4000 });
      s.tools.start('rect');
      s.click(1000, 1000);
      s.move(1300, 1200);
      expect(s.rect().preview).toHaveLength(4);
      s.tools.setSnapFlags({ orthoAlign: true });
      expect(s.rect()).toMatchObject({ origin: { x: 1000, y: 1000 }, cursor: { x: 1300, y: 1200 } });
      s.manager.document.addContours(s.floorId, [
        {
          kind: 'outer',
          points: [
            { x: 1300, y: 1200 },
            { x: 1400, y: 1200 },
            { x: 1400, y: 1300 },
            { x: 1300, y: 1300 },
          ],
        },
      ]);
      expect(s.rect().origin).toEqual({ x: 1000, y: 1000 });
      expect(s.rect().snap?.hit).toEqual({ kind: 'point', id: expect.any(String) });
      // Масштаб ×2 — радиус снапа 5 см: курсор в 7 см от угла — уже мимо; превью следует за курсором.
      s.move(1307, 1200);
      expect(s.rect().cursor).toEqual({ x: 1300, y: 1200 });
      s.tools.setViewport({ scale: 2, center: { x: 1000, y: 1000 }, width: 4000, height: 4000 });
      expect(s.rect().cursor).toEqual({ x: 1307, y: 1200 });
      expect(s.rect().preview[1]![2]).toEqual({ x: 1307, y: 1200 });
    });

    it.each([
      ['обе стороны > 2 × толщины (30 × 300)', 30, 300, 1],
      ['одна сторона ровно 2 × толщины (20 × 300)', 2 * DEFAULT_WALL_WIDTH, 300, 0],
      ['полость валидна (28 × 28, полость 8 × 8)', 2 * DEFAULT_WALL_WIDTH + 8, 2 * DEFAULT_WALL_WIDTH + 8, 1],
      [
        'полость-сливер (27 × 27, площадь полости 49 < 50) → сплошной',
        2 * DEFAULT_WALL_WIDTH + 7,
        2 * DEFAULT_WALL_WIDTH + 7,
        0,
      ],
      ['полость-сливер по отношению площадь/периметр (21 × 300) → сплошной', 2 * DEFAULT_WALL_WIDTH + 1, 300, 0],
    ])('порог полой/сплошной: %s → комнат %i', (_, w, h, rooms) => {
      const s = setup();
      drawRect(s, 0, 0, w, h);
      expect(s.tools.get().kind).toBe('editing');
      expect(s.derived().rooms).toHaveLength(rooms);
      expect(s.contours()).toEqual(
        rooms === 1
          ? [
              ['outer', 4],
              ['inner', 4],
            ]
          : [['outer', 4]],
      );
      expect(s.derived().walls).toHaveLength(1);
    });

    it('гард входа: угол в origin — duplicate-point, сторона короче MIN_WALL_LENGTH — too-short (ровно 15 — принимается)', () => {
      const s = setup();
      s.tools.start('rect');
      s.click(0, 0);
      const before = s.tools.get();
      s.click(0, 0);
      expect(s.tools.get()).toBe(before);
      expect(s.debug).toHaveBeenCalledWith(
        expect.stringContaining('rect corner ignored: duplicate-point'),
        expect.anything(),
      );
      s.click(MIN_WALL_LENGTH - 0.001, 300, { ctrl: true });
      s.click(300, MIN_WALL_LENGTH - 0.001, { ctrl: true });
      expect(s.rect().origin).toEqual({ x: 0, y: 0 });
      expect(s.debug).toHaveBeenCalledWith(
        expect.stringContaining('rect corner ignored: too-short'),
        expect.anything(),
      );
      expect(s.events).not.toContain('document:changed');
      s.click(MIN_WALL_LENGTH, 300, { ctrl: true });
      expect(s.tools.get().kind).toBe('editing');
      expect(s.contours()).toEqual([['outer', 4]]);
    });

    it('commitPoint — тот же путь без снапа: первый — origin, второй — коммит; отвергнутый угол — ошибка результата', () => {
      const s = setup(ringDocument());
      s.tools.start('rect');
      expect(s.tools.commitPoint({ x: 403, y: 302 })).toEqual({ ok: true, value: undefined });
      expect(s.rect()).toMatchObject({ origin: { x: 403, y: 302 }, cursor: null, preview: [] });
      expect(s.tools.commitPoint({ x: 403, y: 302 })).toEqual({ ok: false, error: { kind: 'duplicate-point' } });
      expect(s.tools.commitPoint({ x: 410, y: 700 })).toEqual({ ok: false, error: { kind: 'too-short' } });
      expect(s.tools.commitPoint({ x: 803, y: 702 })).toEqual({ ok: true, value: undefined });
      expect(s.tools.get().kind).toBe('editing');
      expect(s.derived().rooms).toHaveLength(2);
      // Угол из инпута при уже известном указателе — курсор и превью сразу.
      s.tools.start('rect');
      s.move(300, 200);
      s.tools.commitPoint({ x: 0, y: 0 });
      expect(s.rect()).toMatchObject({ origin: { x: 0, y: 0 }, cursor: { x: 300, y: 200 } });
      expect(s.rect().preview).toHaveLength(4);
    });

    it('реальный двойной клик в origin: второй pointerUp — дубль, рисование продолжается; команда doubleClick — no-op', () => {
      const s = setup();
      s.tools.start('rect');
      s.click(0, 0);
      s.click(0, 0);
      s.tools.doubleClick(input(0, 0));
      expect(s.rect().origin).toEqual({ x: 0, y: 0 });
      expect(s.events).not.toContain('document:changed');
    });

    it('Ctrl+Z при поставленном угле — undo до пустого холста → editing; без угла — no-op; Ctrl+Y — no-op (стека нет)', () => {
      const s = setup(ringDocument());
      s.manager.document.deletePoint(s.floorId, Object.keys(s.layout().points)[0]!);
      const layout = s.layout();
      s.tools.start('rect');
      s.click(1000, 1000);
      expect(s.tools.key({ kind: 'undo' })).toEqual({ handled: true });
      expect(s.tools.get().kind).toBe('editing');
      expect(s.layout()).toBe(layout);
      s.tools.start('rect');
      s.toolStates.length = 0;
      expect(s.tools.key({ kind: 'undo' })).toEqual({ handled: true });
      expect(s.tools.key({ kind: 'redo' })).toEqual({ handled: true });
      expect(s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 })).toEqual({ handled: false });
      expect(s.toolStates).toEqual([]);
      expect(s.rect().origin).toBeNull();
      expect(s.layout()).toBe(layout);
    });

    it('Esc / interrupt / смена вида / load — отмена без коммита; blur и pointerCancel угол не рвут', () => {
      const s = setup();
      s.tools.start('rect');
      s.click(0, 0);
      s.toolStates.length = 0;
      s.tools.blur();
      s.tools.pointerCancel();
      expect(s.rect().origin).toEqual({ x: 0, y: 0 });
      expect(s.toolStates).toEqual([]);
      s.tools.cancel();
      expect(s.tools.get().kind).toBe('editing');
      s.tools.start('rect');
      s.click(0, 0);
      s.tools.interrupt();
      expect(s.tools.get().kind).toBe('editing');
      s.tools.start('rect');
      s.click(0, 0);
      s.manager.view.setActive('plan');
      expect(s.tools.get().kind).toBe('editing');
      s.manager.view.setActive('constructor');
      s.tools.start('rect');
      s.click(0, 0);
      expect(s.events).not.toContain('document:changed');
      s.manager.document.load(createEmptyDocument());
      expect(s.tools.get().kind).toBe('editing');
      expect(s.layout().contours).toEqual([]);
    });

    it('смена инструмента посреди рисования: rect с углом → walls пусто одним событием; walls с точками → rect без угла', () => {
      const s = setup();
      s.tools.start('rect');
      s.click(0, 0);
      s.toolStates.length = 0;
      expect(s.tools.start('walls').ok).toBe(true);
      expect(s.walls().points).toEqual([]);
      expect(s.toolStates).toHaveLength(1);
      s.click(0, 0);
      s.click(200, 0);
      s.toolStates.length = 0;
      expect(s.tools.start('rect').ok).toBe(true);
      expect(s.rect().origin).toBeNull();
      // Курсор известен с последнего ввода — снапнут сразу.
      expect(s.rect().cursor).toEqual({ x: 200, y: 0 });
      expect(s.toolStates).toHaveLength(1);
      expect(s.layout().contours).toEqual([]);
    });

    it('история и документ не меняются до второго клика; программный history.undo() посреди — interrupt', () => {
      const s = setup(ringDocument());
      s.manager.document.deletePoint(s.floorId, Object.keys(s.layout().points)[0]!);
      const doc = s.manager.document.get();
      const history = s.manager.history.get();
      s.tools.start('rect');
      s.click(1000, 1000);
      s.move(1300, 1200);
      expect(s.manager.document.get()).toBe(doc);
      expect(s.manager.history.get()).toBe(history);
      expect(s.manager.history.undo().ok).toBe(true);
      expect(s.tools.get().kind).toBe('editing');
    });

    it('прямоугольник поверх существующей стены: точки свариваются по координате, комнаты пересчитаны', () => {
      const s = setup(ringDocument());
      // Угол в существующем углу кольца (400, 300) — снап; второй угол — снаружи.
      s.tools.start('rect');
      s.click(403, 302);
      s.click(700, 600, { ctrl: true });
      expect(s.tools.get().kind).toBe('editing');
      expect(s.derived().rooms).toHaveLength(2);
      const corner = Object.values(s.layout().points).filter(p => p.x === 400 && p.y === 300);
      expect(corner).toHaveLength(1);
    });
  });

  describe('«Комната по точкам» (ADR 0019 E3, спека 01 «Polyline Room»)', () => {
    /** Ставит вершины кликами без снапа (Ctrl) и замыкает кликом в первую (со снапом к ней). */
    const drawRoom = (s: Setup, corners: readonly (readonly [number, number])[]): void => {
      s.tools.start('room');
      for (const [x, y] of corners) s.click(x, y, { ctrl: true });
      const [x, y] = corners[0]!;
      s.click(x, y, { ctrl: true });
    };
    const SQUARE = [
      [0, 0],
      [300, 0],
      [300, 300],
      [0, 300],
    ] as const;

    it("start('room') → making-room с пустым контуром и стеками", () => {
      const s = setup();
      expect(s.tools.start('room')).toEqual({ ok: true, value: undefined });
      expect(s.room()).toMatchObject({ points: [], cursor: null, snap: null, guides: [], undo: [], redo: [] });
      expect(s.toolStates).toHaveLength(1);
    });

    it('клики ставят вершины в snap.snapped на pointerUp; снап к своим вершинам и к существующим точкам; гайды без второй грани', () => {
      const s = setup(ringDocument());
      s.tools.start('room');
      s.click(-303, -302, { ctrl: true });
      s.tools.pointerDown(input(-50, -302));
      expect(s.room().points).toHaveLength(1);
      s.tools.pointerUp(input(-50, -302));
      expect(s.room().points).toEqual([
        { x: -303, y: -302 },
        { x: -50, y: -302 },
      ]);
      expect(s.room().undo).toEqual([[], [{ x: -303, y: -302 }]]);
      s.move(-48, -100);
      expect(s.room().cursor).toEqual({ x: -50, y: -100 });
      expect(s.room().guides).toEqual([
        { kind: 'axis-x', from: { x: -50, y: -100 }, to: { id: 'draft:1', x: -50, y: -302 }, face: null },
      ]);
      s.move(403, 302);
      expect(s.room().snap?.hit).toEqual({ kind: 'point', id: expect.any(String) });
      // Не основная кнопка — только курсор.
      s.tools.pointerUp(input(-50, -100, {}, 2));
      expect(s.room().points).toHaveLength(2);
    });

    it('замыкание кликом в первую вершину от четырёх точек → одна транзакция addContours(inner) → комната; editing', () => {
      const s = setup();
      s.events.length = 0;
      s.tools.start('room');
      for (const [x, y] of SQUARE) s.click(x, y);
      s.move(3, 2);
      expect(s.room().cursor).toEqual({ x: 0, y: 0 });
      s.click(3, 2);
      expect(s.tools.get().kind).toBe('editing');
      expect(s.events.filter(e => e === 'document:changed')).toHaveLength(1);
      expect(s.events.lastIndexOf('tools:changed')).toBeLessThan(s.events.indexOf('document:changed'));
      expect(s.contours()).toEqual([['inner', 4]]);
      expect(s.derived().rooms).toHaveLength(1);
      expect(s.derived().rooms[0]!.outline).toHaveLength(4);
      expect(s.manager.history.get()).toEqual({ canUndo: true, canRedo: false });
      s.tools.key({ kind: 'undo' });
      expect(s.derived().rooms).toHaveLength(0);
      s.tools.key({ kind: 'redo' });
      expect(s.derived().rooms).toHaveLength(1);
    });

    it('замыкание кликом в последнюю вершину (от четырёх точек) — тот же замкнутый контур', () => {
      const s = setup();
      s.tools.start('room');
      for (const [x, y] of SQUARE) s.click(x, y);
      s.click(0, 300);
      expect(s.tools.get().kind).toBe('editing');
      expect(s.contours()).toEqual([['inner', 4]]);
    });

    it.each([
      ['внутри (манхэттен 0.09)', 0.05, 0.04, 'closes'],
      ['чуть дальше — мёртвая зона (CLOSE_EPS, MIN_WALL_LENGTH): игнор too-short', 0.06, 0.05, 'too-short'],
    ])('порог CLOSE_EPS у последней вершины без снапа: %s', (_, dx, dy, outcome) => {
      const s = setup();
      s.tools.start('room');
      for (const [x, y] of SQUARE) s.click(x, y, { ctrl: true });
      s.click(dx, 300 + dy, { ctrl: true });
      if (outcome === 'closes') {
        expect(s.tools.get().kind).toBe('editing');
        expect(s.derived().rooms).toHaveLength(1);
      } else {
        expect(s.room().points).toHaveLength(4);
        expect(s.debug).toHaveBeenCalledWith(
          expect.stringContaining('room point ignored: too-short'),
          expect.anything(),
        );
      }
    });

    it('каждое движение — ровно одно tools:changed, дубль — ни одного; клик после move в ту же точку — одно событие (pointerUp); nudge — handled: false', () => {
      const s = setup();
      s.tools.start('room');
      s.click(0, 0);
      s.toolStates.length = 0;
      s.move(100, 0);
      s.move(200, 50);
      s.move(200, 50);
      expect(s.toolStates).toHaveLength(2);
      s.click(200, 50);
      expect(s.toolStates).toHaveLength(3);
      expect(s.tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 })).toEqual({ handled: false });
      expect(s.toolStates).toHaveLength(3);
      // history.undo() на пустом стеке хук не зовёт: рисование продолжается.
      expect(s.manager.history.undo().ok).toBe(false);
      expect(s.room().points).toHaveLength(2);
    });

    it.each([
      ['внутри', 0.02, 0.03, true],
      ['ровно на пороге (манхэттен)', 0.05, 0.05, true],
      ['чуть дальше', 0.06, 0.05, false],
    ])('порог CLOSE_EPS по манхэттену без снапа: %s → замыкание = %p', (_, dx, dy, closes) => {
      const s = setup();
      s.tools.start('room');
      for (const [x, y] of SQUARE) s.click(x, y, { ctrl: true });
      expect(dx + dy <= CLOSE_EPS).toBe(closes);
      s.click(dx, dy, { ctrl: true });
      if (closes) {
        expect(s.tools.get().kind).toBe('editing');
        expect(s.derived().rooms).toHaveLength(1);
      } else {
        expect(s.room().points).toHaveLength(5);
        expect(s.events).not.toContain('document:changed');
      }
    });

    it('евклид против манхэттена: диагональ 0.07/0.07 (евклид 0.099 ≤ 0.1, манхэттен 0.14) не замыкает', () => {
      const s = setup();
      s.tools.start('room');
      for (const [x, y] of SQUARE) s.click(x, y, { ctrl: true });
      s.click(0.07, 0.07, { ctrl: true });
      expect(s.room().points).toHaveLength(5);
    });

    it('меньше четырёх вершин: клик в первую или последнюю — дубль (игнор), рисование продолжается, документ не тронут', () => {
      const s = setup();
      s.tools.start('room');
      s.click(0, 0);
      s.click(300, 0);
      s.click(300, 300);
      s.click(0, 0);
      s.click(300, 300);
      expect(s.room().points).toHaveLength(3);
      expect(s.debug).toHaveBeenCalledWith(
        expect.stringContaining('room point ignored: duplicate-point'),
        expect.anything(),
      );
      expect(s.events).not.toContain('document:changed');
      // Четвёртая вершина — и замыкание работает.
      s.click(0, 300);
      s.click(0, 0);
      expect(s.tools.get().kind).toBe('editing');
      expect(s.derived().rooms).toHaveLength(1);
    });

    it('гард входа: ребро короче MIN_WALL_LENGTH — too-short (ровно 15 — принимается); дубль не первой/последней — duplicate-point', () => {
      const s = setup();
      s.tools.start('room');
      s.click(0, 0);
      s.click(MIN_WALL_LENGTH - 0.001, 0, { ctrl: true });
      expect(s.room().points).toHaveLength(1);
      expect(s.debug).toHaveBeenCalledWith(expect.stringContaining('room point ignored: too-short'), expect.anything());
      s.click(MIN_WALL_LENGTH, 0, { ctrl: true });
      s.click(MIN_WALL_LENGTH, 300, { ctrl: true });
      s.click(300, 300, { ctrl: true });
      s.click(MIN_WALL_LENGTH, 0, { ctrl: true });
      expect(s.room().points).toHaveLength(4);
      expect(s.debug).toHaveBeenCalledWith(
        expect.stringContaining('room point ignored: duplicate-point'),
        expect.anything(),
      );
    });

    it('гард замыкающего ребра: клик в первую с замыкающим ребром короче 15 см — игнор, рисование продолжается', () => {
      const s = setup();
      s.tools.start('room');
      s.click(0, 0);
      s.click(300, 0);
      s.click(300, 300);
      s.click(0, 300);
      s.click(0, 12, { ctrl: true });
      s.click(0, 0, { ctrl: true });
      expect(s.room().points).toHaveLength(5);
      expect(s.debug).toHaveBeenCalledWith(expect.stringContaining('too-short'), expect.anything());
      expect(s.layout().contours).toEqual([]);
    });

    it.each([
      [
        'selfIntersected',
        [
          [0, 0],
          [300, 300],
          [300, 0],
          [0, 300],
        ],
      ],
      [
        'degenerate',
        [
          [0, 0],
          [100, 0],
          [200, 0],
          [300, 0],
        ],
      ],
    ] as const)(
      'молчаливый отказ на замыкании (%s): editing, документ и история не тронуты, logger.debug',
      (reason, corners) => {
        const s = setup();
        drawRoom(s, corners);
        expect(s.tools.get().kind).toBe('editing');
        expect(s.layout().contours).toEqual([]);
        expect(s.manager.history.get()).toEqual({ canUndo: false, canRedo: false });
        expect(s.debug).toHaveBeenCalledWith(
          expect.stringContaining(`room contour rejected: ${reason}`),
          expect.anything(),
        );
      },
    );

    it('шестиугольник (L-форма) → одна комната с шестью вершинами; комната по точкам внутри кольца стен — вторая комната', () => {
      const s = setup(ringDocument());
      drawRoom(s, [
        [50, 50],
        [350, 50],
        [350, 150],
        [200, 150],
        [200, 250],
        [50, 250],
      ]);
      expect(s.tools.get().kind).toBe('editing');
      expect(s.derived().rooms).toHaveLength(2);
      expect(s.derived().rooms.some(room => room.outline.length === 6)).toBe(true);
    });

    it('commitPoint — постановка без снапа тем же путём, включая замыкание; отвергнутая — too-short / duplicate-point', () => {
      const s = setup();
      s.tools.start('room');
      expect(s.tools.commitPoint({ x: 0, y: 0.0004 })).toEqual({ ok: true, value: undefined });
      expect(s.tools.commitPoint({ x: 300, y: 0 })).toEqual({ ok: true, value: undefined });
      expect(s.tools.commitPoint({ x: 312, y: 0 })).toEqual({ ok: false, error: { kind: 'too-short' } });
      expect(s.tools.commitPoint({ x: 0, y: 0 })).toEqual({ ok: false, error: { kind: 'duplicate-point' } });
      expect(s.room()).toMatchObject({
        cursor: null,
        points: [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
        ],
      });
      s.tools.commitPoint({ x: 300, y: 300 });
      s.tools.commitPoint({ x: 0, y: 300 });
      // Замыкание точным вводом (манхэттен 0.05 ≤ CLOSE_EPS).
      expect(s.tools.commitPoint({ x: 0.05, y: 0 })).toEqual({ ok: true, value: undefined });
      expect(s.tools.get().kind).toBe('editing');
      expect(s.derived().rooms).toHaveLength(1);
    });

    it('локальные undo/redo: Ctrl+Z снимает вершину, Ctrl+Y возвращает, новая вершина чистит redo, undo до пустого → editing', () => {
      const s = setup(ringDocument());
      s.manager.document.deletePoint(s.floorId, Object.keys(s.layout().points)[0]!);
      const layout = s.layout();
      s.tools.start('room');
      s.click(1000, 1000);
      s.click(1300, 1000);
      s.click(1300, 1300);
      expect(s.tools.key({ kind: 'undo' })).toEqual({ handled: true });
      expect(s.room().points).toHaveLength(2);
      expect(s.room().redo).toHaveLength(1);
      expect(s.tools.key({ kind: 'redo' })).toEqual({ handled: true });
      expect(s.room().points).toHaveLength(3);
      expect(s.room().redo).toEqual([]);
      s.tools.key({ kind: 'undo' });
      s.click(1000, 1300);
      expect(s.room().redo).toEqual([]);
      expect(s.room().points[2]).toEqual({ x: 1000, y: 1300 });
      s.tools.key({ kind: 'undo' });
      s.tools.key({ kind: 'undo' });
      expect(s.room().points).toHaveLength(1);
      s.tools.key({ kind: 'undo' });
      expect(s.tools.get().kind).toBe('editing');
      expect(s.layout()).toBe(layout);
      // История документа не тронута; в пустом рисовании Ctrl+Z/Ctrl+Y — no-op без события.
      expect(s.manager.history.get()).toEqual({ canUndo: true, canRedo: false });
      s.tools.start('room');
      s.toolStates.length = 0;
      expect(s.tools.key({ kind: 'undo' })).toEqual({ handled: true });
      expect(s.tools.key({ kind: 'redo' })).toEqual({ handled: true });
      expect(s.toolStates).toEqual([]);
    });

    it('Esc / interrupt / смена вида / load / смена инструмента — отмена без коммита; blur, pointerCancel, doubleClick — no-op', () => {
      const s = setup();
      const draw = () => {
        s.tools.start('room');
        s.click(0, 0);
        s.click(300, 0);
      };
      draw();
      s.toolStates.length = 0;
      s.tools.blur();
      s.tools.pointerCancel();
      s.tools.doubleClick(input(300, 0));
      expect(s.room().points).toHaveLength(2);
      expect(s.toolStates).toEqual([]);
      s.tools.cancel();
      expect(s.tools.get().kind).toBe('editing');
      draw();
      s.tools.interrupt();
      expect(s.tools.get().kind).toBe('editing');
      draw();
      s.manager.view.setActive('plan');
      expect(s.tools.get().kind).toBe('editing');
      s.manager.view.setActive('constructor');
      draw();
      s.toolStates.length = 0;
      expect(s.tools.start('rect').ok).toBe(true);
      expect(s.rect().origin).toBeNull();
      expect(s.toolStates).toHaveLength(1);
      expect(s.events).not.toContain('document:changed');
      draw();
      s.manager.document.load(createEmptyDocument());
      expect(s.tools.get().kind).toBe('editing');
      expect(s.layout().contours).toEqual([]);
    });

    it('история и документ не меняются до замыкания; программный history.undo() → interrupt', () => {
      const s = setup(ringDocument());
      s.manager.document.deletePoint(s.floorId, Object.keys(s.layout().points)[0]!);
      const doc = s.manager.document.get();
      const history = s.manager.history.get();
      s.tools.start('room');
      s.click(1000, 1000);
      s.click(1300, 1000);
      s.tools.key({ kind: 'undo' });
      s.tools.key({ kind: 'redo' });
      expect(s.manager.document.get()).toBe(doc);
      expect(s.manager.history.get()).toBe(history);
      expect(s.manager.history.undo().ok).toBe(true);
      expect(s.tools.get().kind).toBe('editing');
    });

    it('document:changed извне во время рисования пересчитывает снап и не рвёт рисование', () => {
      const s = setup();
      s.tools.setViewport({ scale: 1, center: { x: 0, y: 0 }, width: 4000, height: 4000 });
      s.tools.start('room');
      s.click(1000, 1000);
      s.move(803, 702);
      expect(s.room().snap?.hit).toEqual({ kind: 'none' });
      s.manager.document.addContours(s.floorId, [
        {
          kind: 'outer',
          points: [
            { x: 800, y: 700 },
            { x: 900, y: 700 },
            { x: 900, y: 800 },
            { x: 800, y: 800 },
          ],
        },
      ]);
      expect(s.room().points).toHaveLength(1);
      expect(s.room().snap?.hit).toEqual({ kind: 'point', id: expect.any(String) });
    });
  });

  describe('флаги снапа и viewport', () => {
    it('setSnapFlags меняет флаги (событие), no-op без изменений; в рисовании снап пересчитывается', () => {
      const s = setup(ringDocument());
      s.tools.setSnapFlags({ orthoAlign: true });
      expect(s.tools.get().snapFlags).toEqual({ ...DEFAULT_SNAP_FLAGS, orthoAlign: true });
      expect(s.toolStates).toHaveLength(1);
      s.tools.setSnapFlags({ orthoAlign: true });
      s.tools.setSnapFlags({});
      s.tools.setSnapFlags({ pointsSnap: 'yes' as never });
      expect(s.toolStates).toHaveLength(1);

      s.tools.start('walls');
      s.move(405, 300);
      expect(s.walls().snap).toMatchObject({ snapped: { x: 400, y: 300 }, hit: { kind: 'point' } });
      s.tools.setSnapFlags({ pointsSnap: false });
      // pointsSnap off → радиус угла 2 см: 5 см от угла — уже мимо; остаются оси обеих координат — крест.
      expect(s.walls().snap).toMatchObject({ snapped: { x: 400, y: 300 }, hit: { kind: 'cross' } });
      expect(s.tools.get().snapFlags.pointsSnap).toBe(false);
    });

    it('setViewport: валидация, no-op на равный, событие и пересчёт снапа (порог = SNAP_DIST/scale)', () => {
      const s = setup(ringDocument());
      expect(s.tools.setViewport({ scale: 0, center: { x: 0, y: 0 }, width: 10, height: 10 })).toEqual({
        ok: false,
        error: { kind: 'invalid-viewport', field: 'scale', value: 0 },
      });
      expect(s.tools.setViewport({ scale: 1, center: { x: Number.NaN, y: 0 }, width: 10, height: 10 }).ok).toBe(false);
      expect(s.tools.setViewport({ scale: 1, center: { x: 0, y: 0 }, width: -1, height: 10 }).ok).toBe(false);
      expect(s.tools.setViewport({ scale: 1, center: { x: 0, y: 0 }, width: 10, height: Number.NaN }).ok).toBe(false);
      expect(s.tools.setViewport(DEFAULT_VIEWPORT)).toEqual({ ok: true, value: undefined });
      expect(s.toolStates).toEqual([]);

      const viewport = { scale: 2, center: { x: 400, y: 300 }, width: 800, height: 600 };
      expect(s.tools.setViewport(viewport).ok).toBe(true);
      expect(s.tools.get().viewport).toEqual(viewport);
      expect(s.tools.get().viewport).not.toBe(viewport);
      expect(s.toolStates).toHaveLength(1);

      s.tools.start('walls');
      // При scale = 2 радиус снапа 5 см: 7 см от угла — мимо; при scale = 1 — попадание.
      s.move(407, 300);
      expect(s.walls().snap).toMatchObject({ snapped: { x: 407, y: 300 }, hit: { kind: 'axis', axis: 'y' } });
      s.tools.setViewport({ ...viewport, scale: 1 });
      expect(s.walls().snap).toMatchObject({ snapped: { x: 400, y: 300 }, hit: { kind: 'point' } });
    });

    it('куллинг по viewport: угол вне видимой области не снапится', () => {
      const s = setup(ringDocument());
      s.tools.setViewport({ scale: 1, center: { x: 0, y: 0 }, width: 200, height: 200 });
      s.tools.start('walls');
      s.move(403, 302);
      expect(s.walls().snap?.hit).toEqual({ kind: 'none' });
    });
  });

  describe('dispose', () => {
    it('после dispose команды tools событий не порождают', () => {
      const s = setup();
      s.manager.dispose();
      s.tools.start('walls');
      s.move(1, 1);
      expect(s.toolStates).toEqual([]);
    });
  });
});
