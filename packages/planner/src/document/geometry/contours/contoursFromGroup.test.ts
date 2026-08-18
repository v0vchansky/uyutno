import type { PlanPosition } from '../../PlannerDocument';
import { contourArea } from '../predicates/contourArea';
import { type Triangulation, triangulateContours } from '../triangulate/triangulateContours';
import { contoursFromGroup } from './contoursFromGroup';

const rect = (x0: number, y0: number, x1: number, y1: number): PlanPosition[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const positions = (t: Triangulation, loop: readonly number[]): PlanPosition[] => loop.map(i => t.vertices[i]!);

describe('contoursFromGroup', () => {
  it('квадрат: обвод по fixed-рёбрам стартует с вершины min-X/min-Y и идёт по часовой (область справа)', () => {
    const t = triangulateContours({ outer: [rect(0, 0, 100, 100)], inner: [] });
    const { outline, holes, softFail } = contoursFromGroup(t, t.groups[0]!.triangles);
    expect(softFail).toBe(false);
    expect(holes).toEqual([]);
    expect(positions(t, outline!)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
    ]);
    expect(contourArea(positions(t, outline!))).toBeLessThan(0);
  });

  it('кольцо (outer с inner внутри): обвод — внешний квадрат, дырка — внутренний с обратной обмоткой', () => {
    const t = triangulateContours({ outer: [rect(0, 0, 100, 100)], inner: [rect(20, 20, 80, 80)] });
    const ringGroup = t.groups.find(g => g.fill)!;
    const { outline, holes, softFail } = contoursFromGroup(t, ringGroup.triangles);
    expect(softFail).toBe(false);
    expect(positions(t, outline!)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
    ]);
    expect(holes).toHaveLength(1);
    const hole = positions(t, holes[0]!);
    expect(hole[0]).toEqual({ x: 20, y: 20 });
    expect(contourArea(hole)).toBeGreaterThan(0);
  });

  it('две дырки в одной группе — оба повторных обхода находят свои петли', () => {
    const t = triangulateContours({
      outer: [rect(0, 0, 200, 100)],
      inner: [rect(20, 20, 80, 80), rect(120, 20, 180, 80)],
    });
    const ringGroup = t.groups.find(g => g.fill)!;
    const { holes } = contoursFromGroup(t, ringGroup.triangles);
    expect(holes.map(h => positions(t, h)[0])).toEqual([
      { x: 20, y: 20 },
      { x: 120, y: 20 },
    ]);
  });

  it('T-стык / вершина степени 3: обход выбирает экстремальный угол и не сворачивает внутрь области', () => {
    // Квадрат с перегородкой (cut-пара) от левой стороны до правой: два группы, у каждой — свой прямоугольник.
    const t = triangulateContours({
      outer: [rect(0, 0, 100, 100)],
      inner: [],
      cutPairs: [
        [
          { x: 0, y: 50 },
          { x: 100, y: 50 },
        ],
      ],
    });
    expect(t.groups).toHaveLength(2);
    const outlines = t.groups.map(g => positions(t, contoursFromGroup(t, g.triangles).outline!));
    expect(outlines.map(o => o.length)).toEqual([4, 4]);
    expect(outlines.map(o => Math.abs(contourArea(o)))).toEqual([5000, 5000]);
  });

  it('dead-end вершины (внутреннее ребро, висящее одним концом) вырезаются clearDict — ложных дырок нет', () => {
    const t = triangulateContours({
      outer: [rect(0, 0, 100, 100)],
      inner: [],
      cutPairs: [
        [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
        ],
      ],
    });
    expect(t.groups).toHaveLength(1);
    const { outline, holes, softFail } = contoursFromGroup(t, t.groups[0]!.triangles);
    expect(softFail).toBe(false);
    expect(outline).toHaveLength(4);
    expect(holes).toEqual([]);
  });

  it('группа, чьи fixed-рёбра не замыкаются (exterior-зазор невыпуклого inner), — soft-fail, obвод null', () => {
    const lShape = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 100 },
    ];
    const t = triangulateContours({ outer: [], inner: [lShape] });
    const gap = t.groups.find(g => g.innermost === null)!;
    const result = contoursFromGroup(t, gap.triangles);
    expect(result.outline).toBeNull();
    expect(result.softFail).toBe(true);
    expect(result.holes).toEqual([]);
  });

  it('пустая группа — обвод null и soft-fail', () => {
    const t = triangulateContours({ outer: [rect(0, 0, 100, 100)], inner: [] });
    expect(contoursFromGroup(t, [])).toEqual({ outline: null, holes: [], softFail: true });
  });
});
