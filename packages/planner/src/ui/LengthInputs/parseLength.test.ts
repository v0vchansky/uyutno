import { MIN_WALL_LENGTH } from '../../document/geometry/contours/validateContour';
import type { Units } from '../../document/PlannerDocument';
import { MAX_EDGE_LENGTH } from '../../engine/commands/setEdgeLength';
import type { Result } from '../../engine/Result';
import {
  type LengthError,
  type LengthErrorKind,
  lengthErrorText,
  MAX_INPUT_LENGTH,
  MIN_INPUT_LENGTH,
  parseLength,
  resolveLength,
  sanitizeLengthInput,
} from './parseLength';

/** Короткие обёртки: у поля при рисовании относительной формы нет (спека 01), у правки — есть. */
const parseAbsolute = (text: string, units: Units = 'cm') => parseLength(text, units, { allowRelative: false });
const parseRelative = (text: string, units: Units = 'cm') => parseLength(text, units, { allowRelative: true });

/** Код ошибки результата — для компактных проверок веток отказа. */
const errorKind = <T>(result: Result<T, LengthError>): LengthErrorKind | 'ok' => (result.ok ? 'ok' : result.error.kind);

describe('пороги парсера — те же константы, что у команды (не дубли-литералы)', () => {
  it('нижний порог — MIN_WALL_LENGTH (спека 01: жёсткий пол 15 см)', () => {
    expect(MIN_INPUT_LENGTH).toBe(MIN_WALL_LENGTH);
    expect(MIN_INPUT_LENGTH).toBe(15);
  });

  it('верхний лимит — MAX_EDGE_LENGTH (спека 07: 100 000 см = 1 км)', () => {
    expect(MAX_INPUT_LENGTH).toBe(MAX_EDGE_LENGTH);
    expect(MAX_INPUT_LENGTH).toBe(100_000);
  });
});

describe('sanitizeLengthInput — посимвольный фильтр (спека 07: только цифры и один разделитель)', () => {
  it('буквы и прочий мусор выбрасываются', () => {
    expect(sanitizeLengthInput('2a5b0', { allowSign: false })).toBe('250');
    expect(sanitizeLengthInput('250 см', { allowSign: false })).toBe('250');
    expect(sanitizeLengthInput('!@#', { allowSign: false })).toBe('');
  });

  it('первый разделитель остаётся как набран, второй выбрасывается', () => {
    expect(sanitizeLengthInput('250,5', { allowSign: false })).toBe('250,5');
    expect(sanitizeLengthInput('250.5', { allowSign: false })).toBe('250.5');
    expect(sanitizeLengthInput('1,2,3', { allowSign: false })).toBe('1,23');
    expect(sanitizeLengthInput('1.2.3', { allowSign: false })).toBe('1.23');
  });

  it('оба разделителя сразу: остаётся первый встреченный', () => {
    expect(sanitizeLengthInput('1,2.3', { allowSign: false })).toBe('1,23');
    expect(sanitizeLengthInput('1.2,3', { allowSign: false })).toBe('1.23');
  });

  it('знак остаётся только при allowSign', () => {
    expect(sanitizeLengthInput('+50', { allowSign: true })).toBe('+50');
    expect(sanitizeLengthInput('-50', { allowSign: true })).toBe('-50');
    expect(sanitizeLengthInput('+50', { allowSign: false })).toBe('50');
    expect(sanitizeLengthInput('-50', { allowSign: false })).toBe('50');
  });

  it('знак не в начале выбрасывается даже при allowSign', () => {
    expect(sanitizeLengthInput('5-3', { allowSign: true })).toBe('53');
    expect(sanitizeLengthInput('+-50', { allowSign: true })).toBe('+50');
    expect(sanitizeLengthInput(',-50', { allowSign: true })).toBe(',50');
  });

  it('мусор перед знаком не мешает: знак становится первым символом результата', () => {
    expect(sanitizeLengthInput('a-50', { allowSign: true })).toBe('-50');
  });

  it('пустая строка и строка из одного мусора дают пустую', () => {
    expect(sanitizeLengthInput('', { allowSign: true })).toBe('');
    expect(sanitizeLengthInput('см', { allowSign: true })).toBe('');
  });

  it('одиночные знак и разделитель сохраняются — юзер ещё печатает', () => {
    expect(sanitizeLengthInput('-', { allowSign: true })).toBe('-');
    expect(sanitizeLengthInput(',', { allowSign: false })).toBe(',');
  });
});

describe('parseLength — разбор в см (строка приходит в текущих единицах)', () => {
  it('абсолютное целое', () => {
    expect(parseAbsolute('250')).toEqual({ ok: true, value: { relative: false, value: 250 } });
  });

  it('точка и запятая дают одно значение', () => {
    expect(parseAbsolute('250.5')).toEqual({ ok: true, value: { relative: false, value: 250.5 } });
    expect(parseAbsolute('250,5')).toEqual({ ok: true, value: { relative: false, value: 250.5 } });
  });

  it('пробелы по краям не мешают', () => {
    expect(parseAbsolute('  250  ')).toEqual({ ok: true, value: { relative: false, value: 250 } });
  });

  describe('единицы пересчитываются в см', () => {
    it('метры', () => {
      expect(parseAbsolute('4,37', 'm')).toEqual({ ok: true, value: { relative: false, value: 437 } });
    });

    it('миллиметры', () => {
      expect(parseAbsolute('4370', 'mm')).toEqual({ ok: true, value: { relative: false, value: 437 } });
    });

    it('сантиметры — один к одному', () => {
      expect(parseAbsolute('437', 'cm')).toEqual({ ok: true, value: { relative: false, value: 437 } });
    });
  });

  describe('относительная форма (спека 01 «Форматы ввода»)', () => {
    it('+N — положительная дельта', () => {
      expect(parseRelative('+50')).toEqual({ ok: true, value: { relative: true, value: 50 } });
    });

    it('-N — отрицательная дельта', () => {
      expect(parseRelative('-50')).toEqual({ ok: true, value: { relative: true, value: -50 } });
    });

    it('дельта тоже в текущих единицах', () => {
      expect(parseRelative('+0,5', 'm')).toEqual({ ok: true, value: { relative: true, value: 50 } });
      expect(parseRelative('-500', 'mm')).toEqual({ ok: true, value: { relative: true, value: -50 } });
    });

    it('без знака — абсолютная длина, даже когда относительная разрешена', () => {
      expect(parseRelative('50')).toEqual({ ok: true, value: { relative: false, value: 50 } });
    });
  });

  describe('ветки отказа', () => {
    it('знак при allowRelative: false → negative-not-allowed (оба знака)', () => {
      expect(errorKind(parseAbsolute('+50'))).toBe('negative-not-allowed');
      expect(errorKind(parseAbsolute('-50'))).toBe('negative-not-allowed');
    });

    it.each<string>(['', '   ', '+', '-', ',', '.'])('нет ни одной цифры (%p) → empty', text => {
      expect(errorKind(parseRelative(text))).toBe('empty');
    });

    it('одиночный знак с разделителем — тоже empty', () => {
      expect(errorKind(parseRelative('+,'))).toBe('empty');
    });

    it('оба разделителя сразу → ambiguous-decimal', () => {
      expect(errorKind(parseAbsolute('1,2.3'))).toBe('ambiguous-decimal');
      expect(errorKind(parseAbsolute('1.2,3'))).toBe('ambiguous-decimal');
    });

    it('два одинаковых разделителя — та же неоднозначность', () => {
      expect(errorKind(parseAbsolute('1.2.3'))).toBe('ambiguous-decimal');
      expect(errorKind(parseAbsolute('1,2,3'))).toBe('ambiguous-decimal');
    });

    it('разделитель проверяется после снятия знака', () => {
      expect(errorKind(parseRelative('+1,2,3'))).toBe('ambiguous-decimal');
    });

    it('нераспознанное число (мусор среди цифр, переполнение) → out-of-range', () => {
      expect(errorKind(parseAbsolute('12abc'))).toBe('out-of-range');
      expect(errorKind(parseAbsolute('1e400'))).toBe('out-of-range');
    });
  });
});

describe('resolveLength — строка → конечная длина ребра в см', () => {
  const absolute = { units: 'cm', current: 100, allowRelative: false } as const;
  const relative = { units: 'cm', current: 100, allowRelative: true } as const;

  it('абсолютный ввод заменяет длину', () => {
    expect(resolveLength('250', absolute)).toEqual({ ok: true, value: 250 });
  });

  describe('нижний порог (спека 01: жёсткий пол 15 см)', () => {
    it('ровно min — принимается', () => {
      expect(resolveLength('15', absolute)).toEqual({ ok: true, value: MIN_INPUT_LENGTH });
    });

    it('min − 0.001 см — отказ too-small', () => {
      expect(errorKind(resolveLength('14,999', absolute))).toBe('too-small');
    });

    it('ввод «0» — too-small, а не empty (спека 07 «Крайние случаи»)', () => {
      expect(errorKind(resolveLength('0', absolute))).toBe('too-small');
    });

    it('свой min из опций перекрывает дефолт', () => {
      expect(resolveLength('1', { ...absolute, min: 0 })).toEqual({ ok: true, value: 1 });
      expect(errorKind(resolveLength('20', { ...absolute, min: 50 }))).toBe('too-small');
    });
  });

  describe('верхний лимит (спека 07: 100 000 см = 1 км)', () => {
    it('ровно max — принимается', () => {
      expect(resolveLength('100000', absolute)).toEqual({ ok: true, value: MAX_INPUT_LENGTH });
    });

    it('max + 1 — отказ too-large', () => {
      expect(errorKind(resolveLength('100001', absolute))).toBe('too-large');
    });

    it('в метрах лимит тот же километр', () => {
      expect(resolveLength('1000', { ...absolute, units: 'm' })).toEqual({ ok: true, value: MAX_INPUT_LENGTH });
      expect(errorKind(resolveLength('1001', { ...absolute, units: 'm' }))).toBe('too-large');
    });

    it('свой max из опций перекрывает дефолт', () => {
      expect(errorKind(resolveLength('300', { ...absolute, max: 200 }))).toBe('too-large');
    });
  });

  describe('относительная форма применяется к current', () => {
    it('+N прибавляет', () => {
      expect(resolveLength('+50', relative)).toEqual({ ok: true, value: 150 });
    });

    it('-N вычитает', () => {
      expect(resolveLength('-50', relative)).toEqual({ ok: true, value: 50 });
    });

    it('дельта в метрах пересчитывается в см до сложения', () => {
      expect(resolveLength('+50', { units: 'm', current: 100, allowRelative: true })).toEqual({
        ok: true,
        value: 5100,
      });
    });

    it('дельта в миллиметрах', () => {
      expect(resolveLength('+500', { units: 'mm', current: 100, allowRelative: true })).toEqual({
        ok: true,
        value: 150,
      });
    });

    it('дельта, уводящая ровно в ноль, — too-small', () => {
      expect(errorKind(resolveLength('-100', relative))).toBe('too-small');
    });

    it('дельта, уводящая ниже нуля, — тоже too-small (не «отрицательная длина»)', () => {
      expect(errorKind(resolveLength('-150', relative))).toBe('too-small');
    });

    it('дельта, вылезающая за километр, — too-large', () => {
      expect(errorKind(resolveLength('+100000', relative))).toBe('too-large');
    });

    it('ошибка парсера проходит наружу как есть', () => {
      expect(errorKind(resolveLength('+50', absolute))).toBe('negative-not-allowed');
      expect(errorKind(resolveLength('', absolute))).toBe('empty');
      expect(errorKind(resolveLength('1,2.3', absolute))).toBe('ambiguous-decimal');
    });
  });
});

describe('lengthErrorText — тексты плашки (решение 5, handoff «Плашка ошибки»)', () => {
  it('три текста дословно из handoff', () => {
    expect(lengthErrorText('too-small')).toBe('Стена короче 15 см');
    expect(lengthErrorText('too-large')).toBe('Больше километра не бывает');
    expect(lengthErrorText('self-intersected')).toBe('Контур сам себя пересечёт');
  });

  it('out-of-range показывает тот же текст, что и too-large', () => {
    expect(lengthErrorText('out-of-range')).toBe(lengthErrorText('too-large'));
  });

  it('тексты, которых handoff не задаёт (ждут подтверждения дизайна)', () => {
    expect(lengthErrorText('empty')).toBe('Введите длину');
    expect(lengthErrorText('negative-not-allowed')).toBe('Здесь только точная длина');
    expect(lengthErrorText('width-too-small')).toBe('Стена тоньше 1 см');
    expect(lengthErrorText('ambiguous-decimal')).toBe('Оставьте один разделитель');
    // Прочие отказы команд (`unknown-axis`, `not-drawing`, …) объяснить нечем — общий текст (задача 0060).
    expect(lengthErrorText('rejected')).toBe('Так изменить размер не получится');
  });

  it('текст есть у каждого кода — пустых нет', () => {
    const kinds: readonly LengthErrorKind[] = [
      'empty',
      'negative-not-allowed',
      'ambiguous-decimal',
      'out-of-range',
      'too-small',
      'too-large',
      'self-intersected',
      'rejected',
    ];
    for (const kind of kinds) {
      expect(lengthErrorText(kind)).not.toBe('');
    }
  });
});
