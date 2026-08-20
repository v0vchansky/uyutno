import type { HitTarget, ToolKind, ToolState } from '../../engine/tools/ToolState';
import { cursorFor } from './cursorFor';

/**
 * Минимальный литерал состояния: `cursorFor` читает только `kind` и `hover`, остальные поля union'а
 * для решения не нужны — собираем ровно то, что участвует в таблице «Курсоры» эталона холста.
 */
const state = (value: { kind: ToolKind; hover?: HitTarget | null }): ToolState => value as unknown as ToolState;

const hoverPoint: HitTarget = { kind: 'point', id: 'p1' };
const hoverWall: HitTarget = { kind: 'wall', face: { contourId: 'c1', a: 'p1', b: 'p2' } };
const hoverRoom: HitTarget = { kind: 'room', roomId: 'r1' };

describe('cursorFor — таблица «Курсоры» эталона холста (planner-canvas-reference.md)', () => {
  describe('рисование → перекрестие', () => {
    it.each<ToolKind>(['making-walls', 'making-rect', 'making-room'])('%s → crosshair', kind => {
      expect(cursorFor(state({ kind }), false)).toBe('crosshair');
    });
  });

  describe('editing → grab только на «хватаемых» целях', () => {
    it('наведение на точку → grab', () => {
      expect(cursorFor(state({ kind: 'editing', hover: hoverPoint }), false)).toBe('grab');
    });

    it('наведение на сторону → grab', () => {
      expect(cursorFor(state({ kind: 'editing', hover: hoverWall }), false)).toBe('grab');
    });

    it('наведение на комнату таблицей не описано — она не «хватается», остаётся default', () => {
      expect(cursorFor(state({ kind: 'editing', hover: hoverRoom }), false)).toBe('default');
    });

    it('над пустым холстом (hover = null) → default', () => {
      expect(cursorFor(state({ kind: 'editing', hover: null }), false)).toBe('default');
    });
  });

  describe('перетаскивание → grabbing', () => {
    it.each<ToolKind>(['dragging-point', 'dragging-wall'])('%s → grabbing', kind => {
      expect(cursorFor(state({ kind }), false)).toBe('grabbing');
    });
  });

  describe('панорамирование перебивает любое состояние', () => {
    it.each<ToolKind>(['editing', 'making-walls', 'making-rect', 'making-room', 'dragging-point', 'dragging-wall'])(
      'panning поверх %s → grabbing',
      kind => {
        expect(cursorFor(state({ kind }), true)).toBe('grabbing');
      },
    );

    it('panning поверх наведения на точку — тоже grabbing, а не grab', () => {
      expect(cursorFor(state({ kind: 'editing', hover: hoverPoint }), true)).toBe('grabbing');
    });
  });
});
