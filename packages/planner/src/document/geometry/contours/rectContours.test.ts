import { blocksFromContour, DEFAULT_WALL_WIDTH } from '../band/blocksFromContour';
import { contourValid } from '../predicates/contourArea';
import { rectContours } from './rectContours';

const W = DEFAULT_WALL_WIDTH;

describe('rectContours', () => {
  it('обе стороны > 2 × width — полая: outer против часовой от (minX, minY), inner ужат на width', () => {
    const { outer, inner } = rectContours({ x: 300, y: 400 }, { x: 0, y: 0 }, W);
    expect(outer).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 400 },
      { x: 0, y: 400 },
    ]);
    expect(inner).toEqual([
      { x: W, y: W },
      { x: 300 - W, y: W },
      { x: 300 - W, y: 400 - W },
      { x: W, y: 400 - W },
    ]);
  });

  it.each([
    ['обе ровно 2 × width', 2 * W, 2 * W],
    ['одна ≤ 2 × width', 2 * W, 300],
    ['другая ≤ 2 × width', 300, 2 * W - 0.001],
  ])('сплошной контур: %s → inner = null', (_, w, h) => {
    const { outer, inner } = rectContours({ x: 0, y: 0 }, { x: w, y: h }, W);
    expect(inner).toBeNull();
    expect(outer).toHaveLength(4);
  });

  it('чуть больше порога с обеих сторон — полая, если полость проходит contourValid (8 × 8 — да, 7 × 7 — площадь < 50)', () => {
    expect(rectContours({ x: 0, y: 0 }, { x: 2 * W + 8, y: 2 * W + 8 }, W).inner).toEqual([
      { x: W, y: W },
      { x: W + 8, y: W },
      { x: W + 8, y: W + 8 },
      { x: W, y: W + 8 },
    ]);
    expect(rectContours({ x: 0, y: 0 }, { x: 2 * W + 7, y: 2 * W + 7 }, W).inner).toBeNull();
  });

  it('полость-сливер (contourValid = false) — сплошной контур, а не отказ команды', () => {
    // Внутренний 1 × 280: area/perim < 1 — сливер; 20 × 280 — валиден.
    expect(rectContours({ x: 0, y: 0 }, { x: 2 * W + 1, y: 300 }, W).inner).toBeNull();
    const wide = rectContours({ x: 0, y: 0 }, { x: 4 * W, y: 300 }, W).inner;
    expect(wide).not.toBeNull();
    expect(contourValid(wide!)).toBe(true);
  });

  it('вырожденный вход отдаётся как есть; неположительная width — сплошной', () => {
    expect(rectContours({ x: 5, y: 5 }, { x: 5, y: 5 }, W).outer.every(p => p.x === 5 && p.y === 5)).toBe(true);
    expect(rectContours({ x: 0, y: 0 }, { x: 300, y: 300 }, 0).inner).toBeNull();
  });

  it('полая комната совпадает с замкнутой лентой blocksFromContour по outer (сторона left — внутрь)', () => {
    const { outer, inner } = rectContours({ x: 0, y: 0 }, { x: 300, y: 400 }, W);
    const blocks = blocksFromContour(outer, W, 'left', true);
    expect(blocks).toHaveLength(4);
    // Лента обходит с вершины 1: квад k — сегмент s → e, грань офсета inner[s] → inner[e], линия outer[e] → outer[s].
    for (const [k, block] of blocks.entries()) {
      const s = (k + 1) % 4;
      const e = (k + 2) % 4;
      const expected = [inner![s]!, inner![e]!, outer[e]!, outer[s]!];
      for (const [i, corner] of block.entries()) {
        expect(corner.x).toBeCloseTo(expected[i]!.x, 6);
        expect(corner.y).toBeCloseTo(expected[i]!.y, 6);
      }
    }
  });
});
