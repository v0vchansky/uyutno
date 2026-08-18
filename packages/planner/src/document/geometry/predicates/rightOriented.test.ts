import { type OrientedFace, rightOriented } from './rightOriented';

const face = (ax: number, ay: number, bx: number, by: number, faceRight: boolean): OrientedFace => ({
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  faceRight,
});

describe('rightOriented', () => {
  // Две горизонтальные грани: нижняя `y = 0` слева направо, верхняя `y = 10`.
  const lower = (faceRight: boolean) => face(0, 0, 100, 0, faceRight);

  it('сонаправленные грани, вторая слева от первой: пара только при faceRight = (false, true)', () => {
    const upperSame = (faceRight: boolean) => face(0, 10, 100, 10, faceRight);
    expect(rightOriented(lower(false), upperSame(true))).toBe(true);
    expect(rightOriented(lower(true), upperSame(false))).toBe(false);
    expect(rightOriented(lower(false), upperSame(false))).toBe(false);
    expect(rightOriented(lower(true), upperSame(true))).toBe(false);
  });

  it('сонаправленные, вторая справа от первой (ниже): пара только при faceRight = (true, false)', () => {
    const below = (faceRight: boolean) => face(0, -10, 100, -10, faceRight);
    expect(rightOriented(lower(true), below(false))).toBe(true);
    expect(rightOriented(lower(false), below(true))).toBe(false);
  });

  it('противонаправленные, вторая слева: пара только при faceRight = (false, false)', () => {
    const upperReversed = (faceRight: boolean) => face(100, 10, 0, 10, faceRight);
    expect(rightOriented(lower(false), upperReversed(false))).toBe(true);
    expect(rightOriented(lower(true), upperReversed(true))).toBe(false);
    expect(rightOriented(lower(false), upperReversed(true))).toBe(false);
  });

  it('противонаправленные, вторая справа: пара только при faceRight = (true, true)', () => {
    const belowReversed = (faceRight: boolean) => face(100, -10, 0, -10, faceRight);
    expect(rightOriented(lower(true), belowReversed(true))).toBe(true);
    expect(rightOriented(lower(false), belowReversed(false))).toBe(false);
  });

  it('«сонаправленность» грубая: угол < π/2 или > 3π/2 — считается parallel; ровно π/2 — нет', () => {
    // Вторая грань под 45° начинается слева от первой (y > 0): parallel-ветка.
    expect(rightOriented(lower(false), face(0, 10, 50, 60, true))).toBe(true);
    // Перпендикуляр (угол ровно π/2) — ветка !parallel.
    expect(rightOriented(lower(false), face(0, 10, 0, 60, false))).toBe(true);
    expect(rightOriented(lower(false), face(0, 10, 0, 60, true))).toBe(false);
  });

  it('угол > 3π/2 (сонаправленность «с другой стороны круга») — тоже parallel-ветка', () => {
    // Вторая грань под −45° (вниз-вправо), начало слева от первой.
    expect(rightOriented(lower(false), face(0, 10, 50, -40, true))).toBe(true);
    expect(rightOriented(lower(false), face(0, 10, 50, -40, false))).toBe(false);
  });

  it('вторая начинается на прямой первой (orient2d = 0) — «не слева»', () => {
    // Начало второй лежит на прямой первой: LR = false → ветка «справа».
    expect(rightOriented(lower(true), face(200, 0, 300, 0, false))).toBe(true);
    expect(rightOriented(lower(false), face(200, 0, 300, 0, true))).toBe(false);
  });
});
