import { SIDE_PICK_MIN_EDGE, autoOffsetSide } from './autoOffsetSide';

describe('autoOffsetSide', () => {
  it('SIDE_PICK_MIN_EDGE = 5 см (спека 01)', () => {
    expect(SIDE_PICK_MIN_EDGE).toBe(5);
  });

  const start = { x: 0, y: 0 };
  const neighbours = [
    { x: -100, y: 0 },
    { x: 100, y: 0 },
  ] as const;

  it('сегмент клонится к первому (левому) соседу — left; ко второму — right', () => {
    expect(autoOffsetSide(start, { x: -30, y: 50 }, neighbours)).toBe('left');
    expect(autoOffsetSide(start, { x: 30, y: 50 }, neighbours)).toBe('right');
  });

  it('перпендикуляр к стене — ничья в пользу left (допуск B_EPS)', () => {
    expect(autoOffsetSide(start, { x: 0, y: 50 }, neighbours)).toBe('left');
    expect(autoOffsetSide(start, { x: 0, y: -50 }, neighbours)).toBe('left');
  });

  it('выбор геометрический: порядок соседей на противоположных лучах ответа не меняет', () => {
    const swapped = [neighbours[1], neighbours[0]] as const;
    expect(autoOffsetSide(start, { x: -30, y: 50 }, swapped)).toBe('left');
    expect(autoOffsetSide(start, { x: 30, y: 50 }, swapped)).toBe('right');
  });

  it('короткое ребро (манхэттен < 5 см) — null; ровно 5 — считается', () => {
    expect(autoOffsetSide(start, { x: 2, y: 2 }, neighbours)).toBeNull();
    expect(autoOffsetSide(start, { x: 2.5, y: 2.5 }, neighbours)).not.toBeNull();
    expect(autoOffsetSide(start, { x: 4.99, y: 0 }, neighbours)).toBeNull();
  });

  it('старт не в начале координат, соседи под углом (вершина существующей стены)', () => {
    const corner = { x: 100, y: 100 };
    const around = [
      { x: 0, y: 100 },
      { x: 100, y: 0 },
    ] as const;
    expect(autoOffsetSide(corner, { x: 20, y: 110 }, around)).toBe('left');
    expect(autoOffsetSide(corner, { x: 110, y: 20 }, around)).toBe('right');
  });
});
