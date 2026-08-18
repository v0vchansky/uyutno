import { dedupeConsecutivePoints } from './dedupeConsecutivePoints';

const SQUARE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe('dedupeConsecutivePoints', () => {
  it('убирает подряд идущие дубли и хвост, совпавший с первой точкой (closed)', () => {
    const input = [SQUARE[0]!, SQUARE[1]!, SQUARE[1]!, SQUARE[2]!, SQUARE[3]!, SQUARE[0]!];
    expect(dedupeConsecutivePoints(input)).toEqual(SQUARE);
  });

  it('closed = false: хвост, совпавший с первой, остаётся', () => {
    const input = [...SQUARE, SQUARE[0]!];
    expect(dedupeConsecutivePoints(input, false)).toEqual(input);
  });

  it('несмежные дубли не трогает; пустой и одноточечный входы; новый массив', () => {
    const revisit = [SQUARE[0]!, SQUARE[1]!, SQUARE[0]!, SQUARE[2]!];
    expect(dedupeConsecutivePoints(revisit)).toEqual(revisit);
    expect(dedupeConsecutivePoints([])).toEqual([]);
    expect(dedupeConsecutivePoints([SQUARE[0]!])).toEqual([SQUARE[0]!]);
    expect(dedupeConsecutivePoints(SQUARE)).not.toBe(SQUARE);
  });

  it('все точки одинаковые — остаётся одна', () => {
    expect(dedupeConsecutivePoints([SQUARE[0]!, SQUARE[0]!, SQUARE[0]!])).toEqual([SQUARE[0]!]);
  });
});
