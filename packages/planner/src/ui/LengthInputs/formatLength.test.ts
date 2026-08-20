import type { Units } from '../../document/PlannerDocument';
import { UNITS } from '../../document/PlannerDocument';
import {
  cmToUnits,
  DECIMAL_SEPARATOR,
  formatArea,
  formatLength,
  UNIT_FRACTION_DIGITS,
  unitSuffix,
  unitsToCm,
} from './formatLength';

describe('единицы и суффиксы (спека 07 «Единицы измерения», решение 18 — имперской системы нет)', () => {
  it('суффикс на каждую единицу документа', () => {
    expect(unitSuffix('cm')).toBe('см');
    expect(unitSuffix('m')).toBe('м');
    expect(unitSuffix('mm')).toBe('мм');
  });

  it('точность показа: см — 1 знак, м — 3, мм — 0', () => {
    expect(UNIT_FRACTION_DIGITS).toEqual({ cm: 1, m: 3, mm: 0 });
  });

  it('разделитель на показ — запятая (решение 19)', () => {
    expect(DECIMAL_SEPARATOR).toBe(',');
  });

  it('все единицы документа покрыты обеими таблицами', () => {
    for (const units of UNITS) {
      expect(unitSuffix(units)).not.toBe('');
      expect(UNIT_FRACTION_DIGITS[units]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('cmToUnits / unitsToCm — хранение в см, показ в текущих единицах', () => {
  it('сантиметры не пересчитываются', () => {
    expect(cmToUnits(437, 'cm')).toBe(437);
    expect(unitsToCm(437, 'cm')).toBe(437);
  });

  it('метры — деление на 100', () => {
    expect(cmToUnits(437, 'm')).toBe(4.37);
    expect(unitsToCm(4.37, 'm')).toBe(437);
  });

  it('миллиметры — умножение на 10', () => {
    expect(cmToUnits(437, 'mm')).toBe(4370);
    expect(unitsToCm(4370, 'mm')).toBe(437);
  });

  it('ноль и отрицательное конвертируются знаково', () => {
    expect(cmToUnits(0, 'm')).toBe(0);
    expect(cmToUnits(-250, 'm')).toBe(-2.5);
    expect(unitsToCm(-2.5, 'm')).toBe(-250);
  });

  it('на метрах остаётся хвост плавающей точки, но он на порядки ниже кванта документа (0.001 см)', () => {
    expect(unitsToCm(5.1, 'm')).toBeCloseTo(510, 9);
  });
});

describe('formatLength — строка длины без суффикса (спека 07 «Единицы измерения»)', () => {
  it('сантиметры: целое и один знак', () => {
    expect(formatLength(250, 'cm')).toBe('250');
    expect(formatLength(250.5, 'cm')).toBe('250,5');
    expect(formatLength(437, 'cm')).toBe('437');
  });

  it('метры: до трёх знаков с обрезкой хвостовых нулей', () => {
    expect(formatLength(250, 'm')).toBe('2,5');
    expect(formatLength(200, 'm')).toBe('2');
    expect(formatLength(437, 'm')).toBe('4,37');
    expect(formatLength(437.5, 'm')).toBe('4,375');
  });

  it('миллиметры: округление до целого миллиметра', () => {
    expect(formatLength(437, 'mm')).toBe('4370');
    expect(formatLength(4370, 'mm')).toBe('43700');
    expect(formatLength(0.04, 'mm')).toBe('0');
    expect(formatLength(0.06, 'mm')).toBe('1');
  });

  it('пара «4,37 м / 4370 мм» из handoff — это 437 см', () => {
    expect(formatLength(437, 'm')).toBe('4,37');
    expect(formatLength(437, 'mm')).toBe('4370');
  });

  describe('обрезка хвоста', () => {
    it('нули после разделителя срезаются вместе с повисшим разделителем', () => {
      expect(formatLength(2, 'cm')).toBe('2');
      expect(formatLength(2.1, 'cm')).toBe('2,1');
      expect(formatLength(100, 'm')).toBe('1');
      expect(formatLength(110, 'm')).toBe('1,1');
    });

    it('нули внутри целой части не трогаются', () => {
      expect(formatLength(200, 'cm')).toBe('200');
      expect(formatLength(1000, 'm')).toBe('10');
      expect(formatLength(1000, 'mm')).toBe('10000');
    });
  });

  describe('округление до знака единиц', () => {
    it('вниз', () => {
      expect(formatLength(250.44, 'cm')).toBe('250,4');
      expect(formatLength(0.44, 'm')).toBe('0,004');
      expect(formatLength(0.44, 'mm')).toBe('4');
    });

    it('вверх', () => {
      expect(formatLength(250.46, 'cm')).toBe('250,5');
      expect(formatLength(0.46, 'm')).toBe('0,005');
      expect(formatLength(0.46, 'mm')).toBe('5');
    });
  });

  describe('вырожденные входы', () => {
    it('ноль — «0» в любых единицах', () => {
      for (const units of UNITS) {
        expect(formatLength(0, units)).toBe('0');
      }
    });

    it('отрицательное сохраняет знак', () => {
      expect(formatLength(-250, 'cm')).toBe('-250');
      expect(formatLength(-250, 'm')).toBe('-2,5');
      expect(formatLength(-437, 'mm')).toBe('-4370');
    });

    it('отрицательное, схлопнувшееся в ноль округлением, показывается без минуса', () => {
      expect(formatLength(-0.04, 'cm')).toBe('0');
      expect(formatLength(-0.04, 'mm')).toBe('0');
      expect(formatLength(-0, 'cm')).toBe('0');
    });

    it.each<number>([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
      'не конечное число (%p) → пустая строка, «∞» и научной нотации не бывает',
      value => {
        for (const units of UNITS) {
          expect(formatLength(value, units)).toBe('');
        }
      },
    );

    it('лимит парсера (1 км) во всех единицах без научной нотации', () => {
      expect(formatLength(100_000, 'cm')).toBe('100000');
      expect(formatLength(100_000, 'm')).toBe('1000');
      expect(formatLength(100_000, 'mm')).toBe('1000000');
    });
  });

  it('формат не зависит от порядка вызовов — таблица примеров спеки целиком', () => {
    const cases: readonly (readonly [number, Units, string])[] = [
      [250, 'cm', '250'],
      [250.5, 'cm', '250,5'],
      [250, 'm', '2,5'],
      [200, 'm', '2'],
      [437, 'mm', '4370'],
    ];
    for (const [cm, units, expected] of cases) {
      expect(formatLength(cm, units)).toBe(expected);
    }
  });
});

describe('formatArea — площадь всегда в м² (решение 18, handoff «Формат»)', () => {
  it('см² → м² с запятой и одним знаком', () => {
    expect(formatArea(120_000)).toBe('12,0');
    expect(formatArea(203_000)).toBe('20,3');
  });

  it('хвостовой ноль у площади не срезается — в отличие от длины', () => {
    expect(formatArea(0)).toBe('0,0');
    expect(formatArea(10_000)).toBe('1,0');
  });

  it('округляется до одного знака в обе стороны', () => {
    expect(formatArea(123_400)).toBe('12,3');
    expect(formatArea(126_000)).toBe('12,6');
    expect(formatArea(1_234)).toBe('0,1');
  });

  it('не конечное значение → пустая строка', () => {
    expect(formatArea(Number.NaN)).toBe('');
    expect(formatArea(Number.POSITIVE_INFINITY)).toBe('');
  });
});
