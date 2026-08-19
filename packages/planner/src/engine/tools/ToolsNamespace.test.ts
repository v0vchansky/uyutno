import { DEFAULT_WALL_WIDTH } from '../../document/geometry/band/blocksFromContour';
import { CLOSE_EPS } from '../../document/geometry/contours/contourClosure';
import { MIN_WALL_LENGTH } from '../../document/geometry/contours/validateContour';
import { DEFAULT_SNAP_FLAGS } from '../../document/geometry/snap/getSnapPoint';
import { createEmptyDocument, type PlannerDocument } from '../../document/PlannerDocument';
import type { PlannerLogger } from '../PlannerManager';
import { createTestManager, ringDocument, silentLogger } from '../testing/testManager';
import { DEFAULT_VIEWPORT, type MakingWallsState, type PointerInput, type ToolState } from './ToolState';

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
  const layout = () => manager.document.get().floors[0]!.layout;
  const derived = () => manager.document.getDerived().floors[0]!;
  return { ...tm, tools, toolStates, debug, move, click, walls, layout, derived };
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
      expect(s.tools.start('rect' as never)).toEqual({ ok: false, error: { kind: 'unknown-tool', tool: 'rect' } });
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
