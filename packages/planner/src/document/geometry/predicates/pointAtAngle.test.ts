import { pointAtAngle, rotateXY } from './pointAtAngle';

describe('pointAtAngle', () => {
  const O = { x: 0, y: 0 };

  it('phi = 0 — вдоль направления a→b на расстоянии r', () => {
    const p = pointAtAngle(O, { x: 3, y: 4 }, 0, 10);
    expect(p.x).toBeCloseTo(6, 12);
    expect(p.y).toBeCloseTo(8, 12);
  });

  it('phi = +π/2 — поворот против часовой (y вверх) от направления', () => {
    const p = pointAtAngle(O, { x: 10, y: 0 }, Math.PI / 2, 5);
    expect(p.x).toBeCloseTo(0, 12);
    expect(p.y).toBeCloseTo(5, 12);
  });

  it('все четыре квадранта направления, включая вертикали (без деления на ноль)', () => {
    expect(pointAtAngle(O, { x: -10, y: 0 }, 0, 1).x).toBeCloseTo(-1, 12);
    expect(pointAtAngle(O, { x: 0, y: 10 }, 0, 1).y).toBeCloseTo(1, 12);
    expect(pointAtAngle(O, { x: 0, y: -10 }, 0, 1).y).toBeCloseTo(-1, 12);
    const q = pointAtAngle(O, { x: -10, y: -10 }, 0, Math.SQRT2);
    expect(q.x).toBeCloseTo(-1, 12);
    expect(q.y).toBeCloseTo(-1, 12);
  });

  it('a == b — направление +X (atan2(0, 0) = 0)', () => {
    expect(pointAtAngle(O, O, 0, 2)).toEqual({ x: 2, y: 0 });
  });

  it('точка отсчёта не в начале координат; r = 0 — сама точка a', () => {
    expect(pointAtAngle({ x: 5, y: 5 }, { x: 6, y: 5 }, Math.PI, 2).x).toBeCloseTo(3, 12);
    expect(pointAtAngle({ x: 5, y: 5 }, { x: 6, y: 5 }, 1, 0)).toEqual({ x: 5, y: 5 });
  });
});

describe('rotateXY', () => {
  it('поворот на π/2 против часовой: (1, 0) → (0, 1); на π — (−1, 0); на 0 — без изменений', () => {
    const q = rotateXY({ x: 1, y: 0 }, Math.PI / 2);
    expect(q.x).toBeCloseTo(0, 12);
    expect(q.y).toBeCloseTo(1, 12);
    expect(rotateXY({ x: 1, y: 0 }, Math.PI).x).toBeCloseTo(-1, 12);
    expect(rotateXY({ x: 3, y: -4 }, 0)).toEqual({ x: 3, y: -4 });
  });

  it('отрицательный угол — по часовой', () => {
    const q = rotateXY({ x: 0, y: 1 }, -Math.PI / 2);
    expect(q.x).toBeCloseTo(1, 12);
    expect(q.y).toBeCloseTo(0, 12);
  });
});
