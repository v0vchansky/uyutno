import type { PlanPosition } from '../../PlannerDocument';
import { CLEAR_CONTOUR_MIN_LEN, clearContour } from './clearContour';
import { canonicalCycleKey } from './cyclicSequence';

const p = (x: number, y: number): PlanPosition => ({ x, y });
const rect = (w: number, h: number): PlanPosition[] => [p(0, 0), p(w, 0), p(w, h), p(0, h)];

/** Циклический ключ по координатам — для сравнения контуров с точностью до сдвига начала. */
const cycleKey = (contour: readonly PlanPosition[]): string => canonicalCycleKey(contour.map(v => `${v.x},${v.y}`));

const expectSubsetOfInput = (result: readonly PlanPosition[] | null, input: readonly PlanPosition[]): void => {
  expect(result).not.toBeNull();
  for (const item of result!) expect(input.some(source => source === item)).toBe(true);
};

describe('clearContour', () => {
  it('порог слияния — 5 см', () => {
    expect(CLEAR_CONTOUR_MIN_LEN).toBe(5);
  });

  describe('отказы (null)', () => {
    it('меньше 3 вершин', () => {
      expect(clearContour([])).toBeNull();
      expect(clearContour([p(0, 0), p(100, 0)])).toBeNull();
    });

    it('контур не проходит contourValid: площадь < 50', () => {
      expect(clearContour(rect(7, 7))).toBeNull(); // 49
      expect(clearContour(rect(10, 5))).not.toBeNull(); // 50, ratio 50/30
    });

    it('контур не проходит contourValid: сливер (площадь / периметр < 1)', () => {
      // 100 × 1.9: площадь 190, периметр 203.8 → 0.93 < 1.
      expect(clearContour(rect(100, 1.9))).toBeNull();
      // 100 × 2.1: 210 / 204.2 > 1 → валиден.
      expect(clearContour(rect(100, 2.1))).not.toBeNull();
    });

    it('нет ни одного ребра ≥ 5: правильный 100-угольник радиуса 60 (ребро ≈ 3.8, площадь огромная)', () => {
      const polygon = Array.from({ length: 100 }, (_, i) =>
        p(60 * Math.cos((2 * Math.PI * i) / 100), 60 * Math.sin((2 * Math.PI * i) / 100)),
      );
      expect(clearContour(polygon)).toBeNull();
    });

    it('после чистки осталось < 3 вершин: треугольник с коротким катетом — вершина напротив становится иглой', () => {
      // Площадь 98 ≥ 50, периметр ≈ 85 → валиден; цепочка (40,0)-(40,4.9) не коллинеарна — обе остаются,
      // но соседи вершины (0,0) — (40,4.9) и (40,0) — ближе 5: игла удаляется, остаётся 2 → null.
      expect(clearContour([p(0, 0), p(40, 0), p(40, 4.9)])).toBeNull();
    });
  });

  describe('чистый вход', () => {
    it('прямоугольник, начинающийся с длинного ребра, возвращается без изменений: те же объекты, тот же порядок', () => {
      const input = rect(100, 50);
      const result = clearContour(input)!;
      expect(result).not.toBe(input);
      expect(result).toHaveLength(4);
      result.forEach((item, i) => expect(item).toBe(input[i]));
    });

    it('обобщённая коллинеарность не трогается: точка посередине длинного ребра остаётся', () => {
      const input = [p(0, 0), p(50, 0), p(100, 0), p(100, 50), p(0, 50)];
      expect(clearContour(input)).toEqual(input);
    });

    it('сохраняет объекты с дополнительными полями (generic)', () => {
      const input = [
        { x: 0, y: 0, id: 'a' },
        { x: 100, y: 0, id: 'b' },
        { x: 100, y: 50, id: 'c' },
        { x: 0, y: 50, id: 'd' },
      ];
      const result = clearContour(input)!;
      expect(result.map(v => v.id)).toEqual(['a', 'b', 'c', 'd']);
    });
  });

  describe('цепочки близких вершин', () => {
    it('первая вершина цепочки лежит на прямой prev→last: выживает только последняя', () => {
      const input = [p(0, 0), p(100, 0), p(100, 50), p(3, 50), p(0, 50)];
      const result = clearContour(input)!;
      expect(result).toEqual([p(0, 0), p(100, 0), p(100, 50), p(0, 50)]);
      expectSubsetOfInput(result, input);
    });

    it('последняя вершина цепочки лежит на прямой first→next: выживает только первая', () => {
      const input = [p(0, 0), p(100, 0), p(100, 50), p(0, 50), p(0, 47)];
      const result = clearContour(input)!;
      expect(result).toEqual([p(0, 0), p(100, 0), p(100, 50), p(0, 50)]);
      expectSubsetOfInput(result, input);
    });

    it('ни одна не коллинеарна (торец тонкой стены 3×100): выживают обе', () => {
      const input = rect(100, 3);
      const result = clearContour(input)!;
      expect(result).toHaveLength(4);
      expect(cycleKey(result)).toBe(cycleKey(input));
      expectSubsetOfInput(result, input);
    });

    it('ни одна не коллинеарна (скошенный угол): выживают обе [A, B]', () => {
      const input = [p(0, 0), p(100, 0), p(100, 50), p(3, 50), p(0, 47)];
      const result = clearContour(input)!;
      expect(result).toEqual(input);
    });

    it('порог: ровно 5.0 — не сливается, 4.99 — сливается', () => {
      const exact = [p(0, 0), p(100, 0), p(100, 50), p(5, 50), p(0, 50)];
      expect(clearContour(exact)).toEqual(exact);
      const below = [p(0, 0), p(100, 0), p(100, 50), p(4.99, 50), p(0, 50)];
      expect(clearContour(below)).toEqual([p(0, 0), p(100, 0), p(100, 50), p(0, 50)]);
    });

    it('цепочка из трёх близких вершин на одной прямой схлопывается целиком', () => {
      const input = [p(0, 0), p(100, 0), p(100, 50), p(6, 50), p(3, 50), p(0, 50)];
      const result = clearContour(input)!;
      expect(result).toEqual([p(0, 0), p(100, 0), p(100, 50), p(0, 50)]);
    });

    it('цепочка через конец массива (короткое ребро между последней и первой): last на prev→first — остаётся first', () => {
      const input = [p(0, 0), p(100, 0), p(100, 100), p(0, 100), p(0, 3)];
      const result = clearContour(input)!;
      expect(result).toHaveLength(4);
      expect(cycleKey(result)).toBe(cycleKey(rect(100, 100)));
      expect(result).not.toContain(input[4]);
      expectSubsetOfInput(result, input);
    });

    it('цепочка через конец массива: first на last→next — остаётся last', () => {
      const input = [p(0, 3), p(0, 100), p(100, 100), p(100, 0), p(0, 0)];
      const result = clearContour(input)!;
      expect(result).toHaveLength(4);
      expect(result).not.toContain(input[0]);
      expect(cycleKey(result)).toBe(cycleKey([p(0, 100), p(100, 100), p(100, 0), p(0, 0)]));
      expectSubsetOfInput(result, input);
    });

    it('цепочка через конец массива, ни одна не коллинеарна: обе остаются, порядок обхода сохранён циклически', () => {
      const input = [p(0, 3), p(100, 0), p(100, 50), p(0, 50), p(0, 0)];
      const result = clearContour(input)!;
      expect(result).toHaveLength(5);
      expect(cycleKey(result)).toBe(cycleKey(input));
      expectSubsetOfInput(result, input);
    });

    it('старт с короткого ребра: начало сдвигается на длинное ребро, результат — циклический сдвиг', () => {
      const input = [p(3, 50), p(0, 50), p(0, 0), p(100, 0), p(100, 50)];
      const result = clearContour(input)!;
      expect(result).toHaveLength(4);
      expect(cycleKey(result)).toBe(cycleKey(rect(100, 50)));
    });
  });

  describe('иглы', () => {
    it('вершина, соседи которой ближе 5 друг к другу, удаляется (квадрат с иглой)', () => {
      const needle = p(50, 30);
      const input = [p(0, 0), p(48, 0), needle, p(52, 0), p(100, 0), p(100, 100), p(0, 100)];
      const result = clearContour(input)!;
      expect(result).not.toContain(needle);
      // Соседи иглы после её удаления — цепочка (48,0)-(52,0) на прямой: остаётся одна.
      expect(result).toEqual([p(0, 0), p(52, 0), p(100, 0), p(100, 100), p(0, 100)]);
      expectSubsetOfInput(result, input);
    });

    it('соседи ровно на 5 — не игла', () => {
      const needle = p(50, 30);
      const input = [p(0, 0), p(47.5, 0), needle, p(52.5, 0), p(100, 0), p(100, 100), p(0, 100)];
      expect(clearContour(input)).toEqual(input);
    });

    it('игла в самом начале массива (индекс 0) удаляется через циклических соседей', () => {
      const needle = p(50, 30);
      const input = [needle, p(52, 0), p(100, 0), p(100, 100), p(0, 100), p(0, 0), p(48, 0)];
      const result = clearContour(input)!;
      expect(result).not.toContain(needle);
      expect(result).toHaveLength(5);
    });
  });

  describe('идемпотентность', () => {
    const cases: Record<string, PlanPosition[]> = {
      прямоугольник: rect(100, 50),
      'цепочка в середине': [p(0, 0), p(100, 0), p(100, 50), p(3, 50), p(0, 50)],
      'цепочка через конец': [p(0, 0), p(100, 0), p(100, 100), p(0, 100), p(0, 3)],
      'цепочка через конец (обе остаются)': [p(0, 3), p(100, 0), p(100, 50), p(0, 50), p(0, 0)],
      игла: [p(0, 0), p(48, 0), p(50, 30), p(52, 0), p(100, 0), p(100, 100), p(0, 100)],
      'скошенный угол': [p(0, 0), p(100, 0), p(100, 50), p(3, 50), p(0, 47)],
    };
    for (const [name, input] of Object.entries(cases)) {
      it(`clearContour(clearContour(c)) == clearContour(c): ${name}`, () => {
        const once = clearContour(input);
        expect(once).not.toBeNull();
        expect(clearContour(once!)).toEqual(once);
      });
    }

    it('тонкая стена 3×100: повторный проход даёт тот же цикл (начало может сдвигаться)', () => {
      const once = clearContour(rect(100, 3))!;
      const twice = clearContour(once)!;
      expect(twice).toHaveLength(once.length);
      expect(cycleKey(twice)).toBe(cycleKey(once));
    });
  });
});
