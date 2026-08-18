import type { PlanPosition } from '../../PlannerDocument';
import { type FaceRef, type WallFace, findAxes } from './findAxes';

const p = (x: number, y: number): PlanPosition => ({ x, y });
const face = (a: PlanPosition, b: PlanPosition, faceRight: boolean, name: string): WallFace => ({
  a,
  b,
  faceRight,
  ref: { contourId: 'c', a: `${name}.a`, b: `${name}.b` },
});
const refName = (ref: FaceRef): string => ref.a.replace(/\.a$/, '');

/**
 * Две горизонтальные грани, смотрящие друг на друга: нижняя `(0,0)→(100,0)` с телом сверху (`faceRight = false`:
 * справа от +X — низ), верхняя `(100,10)→(0,10)` с телом снизу (справа от −X — верх, поэтому тоже `false`).
 */
const lower = face(p(0, 0), p(100, 0), false, 'lower');
const upper = face(p(100, 10), p(0, 10), false, 'upper');

describe('findAxes', () => {
  it('две грани друг напротив друга на 10 → одна ось по середине, depth 10, faces[0] — грань слева от a→b', () => {
    const axes = findAxes([lower, upper]);
    expect(axes).toHaveLength(1);
    const [axis] = axes;
    expect(axis!.a).toEqual(p(0, 5));
    expect(axis!.b).toEqual(p(100, 5));
    expect(axis!.depth).toBe(10);
    // Слева от (0,5)→(100,5) при y вверх — верхняя грань.
    expect(refName(axis!.faces[0])).toBe('upper');
    expect(refName(axis!.faces[1])).toBe('lower');
  });

  it('канонический порядок: обмен граней во входе даёт ту же ось (a, b, faces)', () => {
    expect(findAxes([upper, lower])).toEqual(findAxes([lower, upper]));
  });

  it('вертикальная стена: a — конец с меньшим y; faces[0] — грань слева (x меньше)', () => {
    const left = face(p(0, 100), p(0, 0), false, 'left'); // тело справа от −Y — это −x; тело в +x → false
    const right = face(p(10, 0), p(10, 100), false, 'right'); // справа от +Y — +x; тело в −x → false
    const axes = findAxes([right, left]);
    expect(axes).toHaveLength(1);
    expect(axes[0]!.a).toEqual(p(5, 0));
    expect(axes[0]!.b).toEqual(p(5, 100));
    expect(refName(axes[0]!.faces[0])).toBe('left');
    expect(refName(axes[0]!.faces[1])).toBe('right');
  });

  it('грани «спиной друг к другу» (тела наружу) → осей нет', () => {
    const lowerOut = face(p(0, 0), p(100, 0), true, 'lower');
    const upperOut = face(p(100, 10), p(0, 10), true, 'upper');
    expect(findAxes([lowerOut, upperOut])).toEqual([]);
    // Одна смотрит, другая нет — тоже нет.
    expect(findAxes([lower, upperOut])).toEqual([]);
    expect(findAxes([lowerOut, upper])).toEqual([]);
  });

  it('не параллельные грани → осей нет', () => {
    const tilted = face(p(100, 10), p(0, 20), false, 'tilted');
    expect(findAxes([lower, tilted])).toEqual([]);
  });

  it('толщина: 80 — ось, > 80 — нет', () => {
    expect(findAxes([lower, face(p(100, 80), p(0, 80), false, 'u80')])).toHaveLength(1);
    expect(findAxes([lower, face(p(100, 80.001), p(0, 80.001), false, 'u80')])).toEqual([]);
  });

  it('перекрытие: 15 — ось, короче 15 — нет', () => {
    expect(findAxes([lower, face(p(115, 10), p(85, 10), false, 'u')])).toHaveLength(1);
    expect(findAxes([lower, face(p(114, 10), p(90, 10), false, 'u')])).toEqual([]);
  });

  it('касание концами (перекрытия нет) → осей нет', () => {
    expect(findAxes([lower, face(p(200, 10), p(100, 10), false, 'u')])).toEqual([]);
  });

  it('длинная грань против двух коллинеарных коротких → две оси по участкам перекрытия, без слияния', () => {
    const short1 = face(p(40, 10), p(0, 10), false, 's1');
    const short2 = face(p(100, 10), p(60, 10), false, 's2');
    const axes = findAxes([lower, short1, short2]);
    expect(axes).toHaveLength(2);
    expect(axes[0]!.a).toEqual(p(0, 5));
    expect(axes[0]!.b).toEqual(p(40, 5));
    expect(refName(axes[0]!.faces[0])).toBe('s1');
    expect(refName(axes[0]!.faces[1])).toBe('lower');
    expect(axes[1]!.a).toEqual(p(60, 5));
    expect(axes[1]!.b).toEqual(p(100, 5));
    expect(refName(axes[1]!.faces[0])).toBe('s2');
  });

  it('порядок осей — по парам i < j в порядке входа', () => {
    const short1 = face(p(40, 10), p(0, 10), false, 's1');
    const short2 = face(p(100, 10), p(60, 10), false, 's2');
    const axes = findAxes([short2, lower, short1]);
    expect(refName(axes[0]!.faces[0])).toBe('s2');
    expect(refName(axes[1]!.faces[0])).toBe('s1');
  });

  it('совпадающие грани (нулевая толщина — общее ребро двух комнат по точкам): оси нет — стены между ними нет', () => {
    const forward = face(p(0, 0), p(100, 0), true, 'fwd');
    const backward = face(p(100, 0), p(0, 0), true, 'bwd');
    expect(findAxes([forward, backward])).toEqual([]);
    expect(findAxes([backward, forward])).toEqual([]);
  });

  it('почти совпадающие грани (толщина 1e-6 ≥ L_EPS, тело между ними): ось есть, faces[0] — грань слева', () => {
    const forward = face(p(0, 0), p(100, 0), false, 'fwd');
    const backward = face(p(100, 1e-6), p(0, 1e-6), false, 'bwd');
    const axes = findAxes([backward, forward]);
    expect(axes).toHaveLength(1);
    expect(axes[0]!.depth).toBeCloseTo(1e-6, 9);
    expect(refName(axes[0]!.faces[0])).toBe('bwd');
    expect(refName(axes[0]!.faces[1])).toBe('fwd');
  });

  it('совпадающие грани с faceRight = false обе — «спиной» → осей нет', () => {
    expect(findAxes([face(p(0, 0), p(100, 0), false, 'a'), face(p(100, 0), p(0, 0), false, 'b')])).toEqual([]);
  });

  it('ref передаются по ссылке', () => {
    const axes = findAxes([lower, upper]);
    expect(axes[0]!.faces[0]).toBe(upper.ref);
    expect(axes[0]!.faces[1]).toBe(lower.ref);
  });

  it('пустой вход и одна грань → []', () => {
    expect(findAxes([])).toEqual([]);
    expect(findAxes([lower])).toEqual([]);
  });

  it('вход не мутируется', () => {
    const a = face(p(0, 0), p(100, 0), false, 'lower');
    const b = face(p(100, 10), p(0, 10), false, 'upper');
    findAxes([a, b]);
    expect(a).toEqual(lower);
    expect(b).toEqual(upper);
  });

  it('несколько независимых стен → по оси на каждую', () => {
    const lower2 = face(p(0, 200), p(100, 200), false, 'lower2');
    const upper2 = face(p(100, 210), p(0, 210), false, 'upper2');
    const axes = findAxes([lower, upper, lower2, upper2]);
    expect(axes).toHaveLength(2);
    expect(axes[1]!.a).toEqual(p(0, 205));
  });
});
