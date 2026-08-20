import { DEFAULT_SNAP_FLAGS, missSnap } from '../../document/geometry/snap/getSnapPoint';
import type { PlanPosition } from '../../document/PlannerDocument';
import type { HistoryState } from '../../engine/HistoryNamespace';
import { DEFAULT_VIEWPORT, type ToolCommon, type ToolState } from '../../engine/tools/ToolState';
import { historyAvailability } from './useHistoryButtons';

/**
 * Чистая функция доступности кнопок истории: по одному разбору на каждое состояние автомата, обе стороны каждого
 * порога. Состояния собираются литералами `ToolState` — без движка: функция обязана зависеть только от входа.
 */

const COMMON: ToolCommon = { snapFlags: DEFAULT_SNAP_FLAGS, viewport: DEFAULT_VIEWPORT };

const history = (canUndo: boolean, canRedo: boolean): HistoryState => ({ canUndo, canRedo });

const P = (x: number, y: number): PlanPosition => ({ x, y });

const editing = (): ToolState => ({ ...COMMON, kind: 'editing', hover: null, selection: null });

const makingWalls = (undo: PlanPosition[][], redo: PlanPosition[][]): ToolState => ({
  ...COMMON,
  kind: 'making-walls',
  points: [P(0, 0)],
  cursor: null,
  side: 'left',
  sideFixed: false,
  startNeighbours: null,
  preview: [],
  snap: null,
  guides: [],
  undo,
  redo,
});

const makingRoom = (undo: PlanPosition[][], redo: PlanPosition[][]): ToolState => ({
  ...COMMON,
  kind: 'making-room',
  points: [P(0, 0)],
  cursor: null,
  snap: null,
  guides: [],
  undo,
  redo,
});

const makingRect = (origin: PlanPosition | null): ToolState => ({
  ...COMMON,
  kind: 'making-rect',
  origin,
  cursor: null,
  preview: [],
  snap: null,
  guides: [],
});

const draggingPoint = (): ToolState => ({
  ...COMMON,
  kind: 'dragging-point',
  pointId: 'p1',
  selection: { kind: 'point', id: 'p1' },
  origin: P(0, 0),
  pointOverrides: {},
  snap: missSnap(P(0, 0)),
  guides: [],
  dropTarget: null,
});

const draggingWall = (): ToolState => ({
  ...COMMON,
  kind: 'dragging-wall',
  face: { contourId: 'c1', a: 'p1', b: 'p2' },
  selection: { kind: 'wall', face: { contourId: 'c1', a: 'p1', b: 'p2' } },
  grab: P(0, 0),
  shift: 0,
  pointOverrides: {},
  snap: missSnap(P(0, 0)),
});

describe('historyAvailability', () => {
  describe('editing — ровно флаги истории документа', () => {
    it('пустая история: обе кнопки недоступны', () => {
      expect(historyAvailability(editing(), history(false, false))).toEqual({ canUndo: false, canRedo: false });
    });

    it('есть что откатить: доступна только отмена', () => {
      expect(historyAvailability(editing(), history(true, false))).toEqual({ canUndo: true, canRedo: false });
    });

    it('есть что вернуть: доступен только повтор', () => {
      expect(historyAvailability(editing(), history(false, true))).toEqual({ canUndo: false, canRedo: true });
    });

    it('обе стороны истории непусты: доступны обе кнопки', () => {
      expect(historyAvailability(editing(), history(true, true))).toEqual({ canUndo: true, canRedo: true });
    });
  });

  describe('making-walls — локальные стеки инструмента, история документа не смотрится', () => {
    it('оба стека пусты: обе кнопки недоступны даже при непустой истории документа', () => {
      expect(historyAvailability(makingWalls([], []), history(true, true))).toEqual({
        canUndo: false,
        canRedo: false,
      });
    });

    it('непустой undo-стек: доступна отмена', () => {
      expect(historyAvailability(makingWalls([[]], []), history(false, false))).toEqual({
        canUndo: true,
        canRedo: false,
      });
    });

    it('непустой redo-стек: доступен повтор', () => {
      expect(historyAvailability(makingWalls([], [[P(0, 0)]]), history(false, false))).toEqual({
        canUndo: false,
        canRedo: true,
      });
    });

    it('оба стека непусты: доступны обе кнопки', () => {
      expect(historyAvailability(makingWalls([[]], [[P(0, 0)]]), history(false, false))).toEqual({
        canUndo: true,
        canRedo: true,
      });
    });
  });

  describe('making-room — те же локальные стеки', () => {
    it('оба стека пусты: обе кнопки недоступны даже при непустой истории документа', () => {
      expect(historyAvailability(makingRoom([], []), history(true, true))).toEqual({
        canUndo: false,
        canRedo: false,
      });
    });

    it('непустой undo-стек: доступна отмена', () => {
      expect(historyAvailability(makingRoom([[]], []), history(false, false))).toEqual({
        canUndo: true,
        canRedo: false,
      });
    });

    it('непустой redo-стек: доступен повтор', () => {
      expect(historyAvailability(makingRoom([], [[P(0, 0)]]), history(false, false))).toEqual({
        canUndo: false,
        canRedo: true,
      });
    });

    it('оба стека непусты: доступны обе кнопки', () => {
      expect(historyAvailability(makingRoom([[]], [[P(0, 0)]]), history(false, false))).toEqual({
        canUndo: true,
        canRedo: true,
      });
    });
  });

  describe('making-rect — угол вместо стека, redo не бывает', () => {
    it('угла нет: отменять нечего даже при непустой истории документа', () => {
      expect(historyAvailability(makingRect(null), history(true, true))).toEqual({ canUndo: false, canRedo: false });
    });

    it('угол поставлен: отмена доступна («undo до пустого холста» → editing)', () => {
      expect(historyAvailability(makingRect(P(10, 20)), history(false, false))).toEqual({
        canUndo: true,
        canRedo: false,
      });
    });

    it('повтор недоступен и при полной истории документа: Ctrl+Y в прямоугольнике — no-op', () => {
      expect(historyAvailability(makingRect(P(10, 20)), history(true, true)).canRedo).toBe(false);
    });
  });

  describe('жесты — обе кнопки отменяют сам жест, поэтому обе доступны всегда', () => {
    it('dragging-point на пустой истории документа: доступны обе', () => {
      expect(historyAvailability(draggingPoint(), history(false, false))).toEqual({ canUndo: true, canRedo: true });
    });

    it('dragging-point на полной истории документа: доступны обе', () => {
      expect(historyAvailability(draggingPoint(), history(true, true))).toEqual({ canUndo: true, canRedo: true });
    });

    it('dragging-wall на пустой истории документа: доступны обе', () => {
      expect(historyAvailability(draggingWall(), history(false, false))).toEqual({ canUndo: true, canRedo: true });
    });

    it('dragging-wall на полной истории документа: доступны обе', () => {
      expect(historyAvailability(draggingWall(), history(true, true))).toEqual({ canUndo: true, canRedo: true });
    });
  });
});
