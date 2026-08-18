import { segmentsIntersected } from './segmentsIntersected';

describe('segmentsIntersected', () => {
  it('крест — true (в любом порядке аргументов)', () => {
    const a1 = { x: 0, y: 0 };
    const a2 = { x: 10, y: 10 };
    const b1 = { x: 0, y: 10 };
    const b2 = { x: 10, y: 0 };
    expect(segmentsIntersected(a1, a2, b1, b2)).toBe(true);
    expect(segmentsIntersected(b1, b2, a1, a2)).toBe(true);
    expect(segmentsIntersected(a2, a1, b2, b1)).toBe(true);
  });

  it('разнесённые отрезки и «продолжения мимо» — false', () => {
    expect(segmentsIntersected({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBe(false);
    expect(segmentsIntersected({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: -5 }, { x: 20, y: 5 })).toBe(false);
  });

  it('только трансверсально: касание концом, T-стык, общая вершина, коллинеарное наложение — false', () => {
    expect(segmentsIntersected({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 })).toBe(false); // T
    expect(segmentsIntersected({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 })).toBe(false); // общая вершина
    expect(segmentsIntersected({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 15, y: 0 })).toBe(false); // наложение
    expect(segmentsIntersected({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 0 })).toBe(false); // касание концом
  });

  it('вырожденные: нулевой отрезок и NaN — false', () => {
    expect(segmentsIntersected({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 10 })).toBe(false);
    expect(segmentsIntersected({ x: Number.NaN, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(
      false,
    );
  });

  it('robust: почти касание концом (сдвиг 1e-12) различается точно', () => {
    // Конец второго отрезка на 1e-12 выше прямой первого — пересечения нет; ниже — есть.
    expect(segmentsIntersected({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 1e-12 })).toBe(false);
    expect(segmentsIntersected({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 5, y: -1e-12 })).toBe(true);
  });
});
