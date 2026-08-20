import type { DerivedState } from '../../engine/rebuild';
import { planDescription } from './planDescription';

/** Производное минимальной формы: описанию нужны только площади комнат по этажам (см²). */
const derived = (...floors: readonly (readonly number[])[]): DerivedState =>
  ({ floors: floors.map(areas => ({ rooms: areas.map(area => ({ area })) })) }) as unknown as DerivedState;

/** `count` комнат нулевой площади — для проверки склонения. */
const rooms = (count: number): readonly number[] => Array.from({ length: count }, () => 0);

describe('planDescription — aria-label холста конструктора (решение 22, эталон «Доступность»)', () => {
  it('производного нет (null) → пустой шаблон', () => {
    expect(planDescription(null)).toBe('план: 0 комнат, 0,0 м²');
  });

  it('этажей нет → тот же пустой шаблон', () => {
    expect(planDescription(derived())).toBe('план: 0 комнат, 0,0 м²');
  });

  it('этаж без комнат → пустой шаблон', () => {
    expect(planDescription(derived([]))).toBe('план: 0 комнат, 0,0 м²');
  });

  describe('склонение «комната»', () => {
    it('одна комната', () => {
      expect(planDescription(derived([0]))).toBe('план: 1 комната, 0,0 м²');
    });

    it.each<number>([2, 3, 4])('%i — «комнаты»', count => {
      expect(planDescription(derived(rooms(count)))).toBe(`план: ${count} комнаты, 0,0 м²`);
    });

    it.each<number>([5, 6, 9, 10])('%i — «комнат»', count => {
      expect(planDescription(derived(rooms(count)))).toBe(`план: ${count} комнат, 0,0 м²`);
    });

    it.each<number>([11, 12, 13, 14])('%i — «комнат» (исключение 11–14)', count => {
      expect(planDescription(derived(rooms(count)))).toBe(`план: ${count} комнат, 0,0 м²`);
    });

    it('21 — снова «комната»', () => {
      expect(planDescription(derived(rooms(21)))).toBe('план: 21 комната, 0,0 м²');
    });

    it('22 — «комнаты», 25 — «комнат»', () => {
      expect(planDescription(derived(rooms(22)))).toBe('план: 22 комнаты, 0,0 м²');
      expect(planDescription(derived(rooms(25)))).toBe('план: 25 комнат, 0,0 м²');
    });
  });

  describe('площадь', () => {
    it('см² → м² с запятой и одним знаком', () => {
      expect(planDescription(derived([120_000]))).toBe('план: 1 комната, 12,0 м²');
      expect(planDescription(derived([123_456]))).toBe('план: 1 комната, 12,3 м²');
    });

    it('суммируется по комнатам этажа', () => {
      expect(planDescription(derived([120_000, 45_000]))).toBe('план: 2 комнаты, 16,5 м²');
    });

    it('округляется до одного знака', () => {
      expect(planDescription(derived([125_000]))).toBe('план: 1 комната, 12,5 м²');
      expect(planDescription(derived([1_234]))).toBe('план: 1 комната, 0,1 м²');
    });

    it('крупный план: три комнаты, 45 м²', () => {
      expect(planDescription(derived([200_000, 150_000, 100_000]))).toBe('план: 3 комнаты, 45,0 м²');
    });
  });

  it('считается только первый этаж — верхние в описание не идут', () => {
    expect(planDescription(derived([120_000], [999_999, 999_999]))).toBe('план: 1 комната, 12,0 м²');
  });
});
