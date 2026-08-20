import type { PlanPosition } from '../../PlannerDocument';
import { COORDINATE_QUANTUM } from '../../quantize';
import { areaSupported } from './areaSupport';

const room: PlanPosition[] = [
  { x: 10, y: 10 },
  { x: 390, y: 10 },
  { x: 390, y: 290 },
  { x: 10, y: 290 },
];

describe('areaSupported', () => {
  it('каждая точка зоны совпала с точкой комнаты — зона опёрта', () => {
    expect(
      areaSupported(
        [
          { x: 10, y: 10 },
          { x: 390, y: 290 },
        ],
        room,
      ),
    ).toBe(true);
  });

  it('одна точка не нашла угла — зона не опёрта целиком (частичной подгонки не бывает)', () => {
    expect(
      areaSupported(
        [
          { x: 10, y: 10 },
          { x: 390, y: 290 },
          { x: 200, y: 200 },
        ],
        room,
      ),
    ).toBe(false);
  });

  it('порог — шаг квантования: сдвиг угла комнаты на 0.001 см ломает опору, на 0 — нет', () => {
    const area = [{ x: 10, y: 10 }];
    expect(areaSupported(area, [{ x: 10, y: 10 }])).toBe(true);
    expect(areaSupported(area, [{ x: 10 + COORDINATE_QUANTUM, y: 10 }])).toBe(false);
  });

  it('внутренняя сторона порога: расхождение, схлопывающееся квантованием, опору сохраняет', () => {
    expect(areaSupported([{ x: 10, y: 10 }], [{ x: 10.0004, y: 9.9996 }])).toBe(true);
  });

  it('допуск покоординатный: сдвиг по y ломает опору так же, как по x', () => {
    expect(areaSupported([{ x: 10, y: 10 }], [{ x: 10, y: 10 + COORDINATE_QUANTUM }])).toBe(false);
  });

  it('10-см снап опорой не является: точка в 5 см от угла не опёрта', () => {
    expect(areaSupported([{ x: 15, y: 10 }], room)).toBe(false);
  });

  it('пустой контур зоны опоры не имеет; пустой набор точек комнат — тоже', () => {
    expect(areaSupported([], room)).toBe(false);
    expect(areaSupported([{ x: 10, y: 10 }], [])).toBe(false);
  });

  it('лишние точки комнат и их порядок роли не играют; принимается любой Iterable', () => {
    const points = new Set<PlanPosition>([{ x: 999, y: 999 }, ...[...room].reverse()]);
    expect(areaSupported([{ x: 390, y: 290 }], points)).toBe(true);
  });

  it('вход не мутируется', () => {
    const area = [{ x: 10, y: 10 }];
    const points = [...room];
    areaSupported(area, points);
    expect(area).toEqual([{ x: 10, y: 10 }]);
    expect(points).toEqual(room);
  });

  it('NaN во входе опорой не считается', () => {
    expect(areaSupported([{ x: Number.NaN, y: 10 }], room)).toBe(false);
  });
});
