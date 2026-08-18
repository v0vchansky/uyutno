import { TRIANGLE_NARROW, triangleArea, triangleCenter, triangleIsNarrow } from './triangle';

describe('triangleCenter', () => {
  it('центроид — среднее вершин, отрицательные координаты', () => {
    expect(triangleCenter({ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 3 })).toEqual({ x: 1, y: 1 });
    expect(triangleCenter({ x: -3, y: -3 }, { x: 3, y: -3 }, { x: 0, y: 6 })).toEqual({ x: 0, y: 0 });
  });
});

describe('triangleArea', () => {
  it('знаковая: против часовой (y вверх) > 0, по часовой < 0, вырожденный = 0', () => {
    expect(triangleArea({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 })).toBe(6);
    expect(triangleArea({ x: 0, y: 0 }, { x: 0, y: 3 }, { x: 4, y: 0 })).toBe(-6);
    expect(triangleArea({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe(0);
  });
});

describe('triangleIsNarrow', () => {
  it('TRIANGLE_NARROW = 0.1 (ADR 0017 C3)', () => {
    expect(TRIANGLE_NARROW).toBe(0.1);
  });

  it('нормальный треугольник — false; любая сторона короче 0.1 по манхэттену — true', () => {
    expect(triangleIsNarrow({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 })).toBe(false);
    expect(triangleIsNarrow({ x: 0, y: 0 }, { x: 0.04, y: 0.04 }, { x: 0, y: 10 })).toBe(true); // AB = 0.08
    expect(triangleIsNarrow({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0.05 })).toBe(true); // BC
    expect(triangleIsNarrow({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0.05, y: 0 })).toBe(true); // CA
  });

  it('порог: сторона ровно 0.1 — не узкий (строго меньше), 0.0999 — узкий; метрика манхэттен', () => {
    expect(triangleIsNarrow({ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0, y: 10 })).toBe(false);
    expect(triangleIsNarrow({ x: 0, y: 0 }, { x: 0.0999, y: 0 }, { x: 0, y: 10 })).toBe(true);
    // Евклид 0.0707 < 0.1, но манхэттен 0.1 — не узкий.
    expect(triangleIsNarrow({ x: 0, y: 0 }, { x: 0.05, y: 0.05 }, { x: 0, y: 10 })).toBe(false);
  });

  it('свой minLen', () => {
    expect(triangleIsNarrow({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, 15)).toBe(true);
  });
});
