import type { PlanPosition } from '../../PlannerDocument';
import { MIN_WALL_LENGTH } from '../contours/validateContour';
import { MAX_WALL_WIDTH, boxCenterSeg } from './boxCenterSeg';
import type { ParallelBox } from './parallelBox';

const p = (x: number, y: number): PlanPosition => ({ x, y });
/** Бокс `[E, F, G, H]` вдоль оси X: E = (0,0), F = (length, 0), G = (length, width), H = (0, width). */
const box = (length: number, width: number): ParallelBox => [p(0, 0), p(length, 0), p(length, width), p(0, width)];

describe('boxCenterSeg', () => {
  it('константы: MAX_WALL_WIDTH = 80, MIN_WALL_LENGTH = 15', () => {
    expect(MAX_WALL_WIDTH).toBe(80);
    expect(MIN_WALL_LENGTH).toBe(15);
  });

  it('концы сегмента — середины HE и FG', () => {
    expect(boxCenterSeg(box(100, 10))).toEqual([p(0, 5), p(100, 5)]);
    // Наклонный бокс: середины считаются покомпонентно.
    expect(boxCenterSeg([p(0, 0), p(30, 40), p(22, 46), p(-8, 6)])).toEqual([p(-4, 3), p(26, 43)]);
  });

  it('толщина |FG|: ровно 80 — ок, 80.001 → null', () => {
    expect(boxCenterSeg(box(100, 80))).toEqual([p(0, 40), p(100, 40)]);
    expect(boxCenterSeg(box(100, 80.001))).toBeNull();
  });

  it('длина |EF|: 14.999 → null, ровно 15 — ок', () => {
    expect(boxCenterSeg(box(14.999, 10))).toBeNull();
    expect(boxCenterSeg(box(15, 10))).toEqual([p(0, 5), p(15, 5)]);
  });

  it('нулевая толщина (грани совпадают) допустима', () => {
    expect(boxCenterSeg(box(50, 0))).toEqual([p(0, 0), p(50, 0)]);
  });

  it('направление — от E к F, без канонизации', () => {
    expect(boxCenterSeg([p(100, 0), p(0, 0), p(0, 10), p(100, 10)])).toEqual([p(100, 5), p(0, 5)]);
  });

  it('NaN в координатах не отсекается: пороговые сравнения с NaN ложны — сегмент с NaN (фактическое поведение)', () => {
    // |FG| = NaN: `NaN > 80` ложно → проверка толщины пройдена; NaN протекает в результат.
    const result = boxCenterSeg([p(0, 0), p(100, 0), p(Number.NaN, 10), p(0, 10)]);
    expect(result).not.toBeNull();
    expect(Number.isNaN(result![1].x)).toBe(true);
  });
});
