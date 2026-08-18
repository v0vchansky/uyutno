import { checkContact } from './checkContact';

const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

describe('checkContact', () => {
  it('соседние квадраты с общим ребром — контакт (в обе стороны)', () => {
    expect(checkContact(square(0, 0, 10), square(10, 0, 10))).toBe(true);
    expect(checkContact(square(10, 0, 10), square(0, 0, 10))).toBe(true);
  });

  it('частичный нахлёст рёбер (сдвиг по стене) и контакт через замыкающее ребро — контакт', () => {
    expect(checkContact(square(0, 0, 10), square(10, 5, 10))).toBe(true);
    // Замыкающее ребро A (0,10)→(0,0) против правой стороны B.
    expect(checkContact(square(0, 0, 10), square(-10, 0, 10))).toBe(true);
  });

  it('касание углами (точечное) — не контакт; разнесённые — не контакт; параллель на зазоре — не контакт', () => {
    expect(checkContact(square(0, 0, 10), square(10, 10, 10))).toBe(false);
    expect(checkContact(square(0, 0, 10), square(50, 50, 10))).toBe(false);
    expect(checkContact(square(0, 0, 10), square(10.001, 0, 10))).toBe(false);
  });

  it('вырожденные рёбра (короче B_EPS) пропускаются; пустые контуры — не контакт', () => {
    const withDegenerate = [
      { x: 10, y: 0 },
      { x: 10, y: 0.00001 },
      { x: 10, y: 10 },
      { x: 20, y: 5 },
    ];
    expect(checkContact(square(0, 0, 10), withDegenerate)).toBe(true); // ребро (10,0.00001)→(10,10) лежит на стороне
    // Только вырожденное ребро лежит на стороне квадрата — пропускается, контакта нет.
    const onlyDegenerate = [
      { x: 10, y: 5 },
      { x: 10, y: 5.00001 },
      { x: 20, y: 5 },
    ];
    expect(checkContact(square(0, 0, 10), onlyDegenerate)).toBe(false);
    expect(checkContact([], square(0, 0, 10))).toBe(false);
    expect(checkContact(square(0, 0, 10), [])).toBe(false);
  });
});
