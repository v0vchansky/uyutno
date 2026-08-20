import { MIN_WALL_LENGTH } from '../../document/geometry/contours/validateContour';
import type { Units } from '../../document/PlannerDocument';
import { MAX_EDGE_LENGTH } from '../../engine/commands/setEdgeLength';
import { MIN_WALL_WIDTH } from '../../engine/commands/setWallWidth';
import { err, ok, type Result } from '../../engine/Result';
import { unitsToCm } from './formatLength';

/**
 * Коды ошибок ввода длины (спека 07 «Крайние случаи» → «Локализация ошибок парсинга»): парсер возвращает код,
 * тексты — в UI. `too-many-primes`/`bare-number` относились к убранному имперскому парсеру и здесь их нет.
 * `self-intersected` — не парсер, а отказ команды `setEdgeLength` (`contour-self-intersected`); он в том же
 * союзе, чтобы у поля был один тип ошибки на все причины отказа. `rejected` — остальные отказы команд
 * (`unknown-axis`, `unknown-point`, `degenerate-edge`, `not-drawing`, …): пользователю про них сказать нечего,
 * кроме того, что размер не применился (задача 0060).
 */
export type LengthErrorKind =
  | 'empty'
  | 'negative-not-allowed'
  | 'ambiguous-decimal'
  | 'out-of-range'
  | 'too-small'
  /** То же «слишком мало», но у поля ширины стены: там свой пол — `MIN_WALL_WIDTH`, а не 15 см (ADR 0018 D1). */
  | 'width-too-small'
  | 'too-large'
  | 'self-intersected'
  | 'rejected';

export interface LengthError {
  kind: LengthErrorKind;
}

/** Разобранный ввод: абсолютная длина или относительная дельта, всегда в **см**. */
export interface ParsedLength {
  /** Строка начиналась со знака `+`/`-` — спека 01 «Форматы ввода»: сдвиг от текущей длины, а не новая длина. */
  relative: boolean;
  /** Для `relative` может быть отрицательным. */
  value: number;
}

/** Нижний порог длины ребра, см — тот же `MIN_WALL_LENGTH`, что у команды (спека 01: жёсткий пол 15 см). */
export const MIN_INPUT_LENGTH = MIN_WALL_LENGTH;

/** Верхний лимит парсера, см — тот же `MAX_EDGE_LENGTH` (спека 07: 100 000 см = 1 км). */
export const MAX_INPUT_LENGTH = MAX_EDGE_LENGTH;

/**
 * Нижний порог **ширины** стены, см — тот же `MIN_WALL_WIDTH`, что у команды. Пол длины 15 см к ширине
 * неприменим: `DEFAULT_WALL_WIDTH = 10`, и с порогом 15 стену нельзя было бы ни утоньшить, ни ввести `−N`
 * (ADR 0018 D1, «Уточнения реализации (задача 0055)»).
 */
export const MIN_INPUT_WIDTH = MIN_WALL_WIDTH;

/** Разделители, принимаемые на вводе (спека 07 «Единицы измерения»: и точка, и запятая). */
const INPUT_SEPARATORS = ['.', ','];

/** Знаки относительной формы `+N` / `-N` (спека 01 «Форматы ввода»). */
const SIGNS = ['+', '-'];

const isDigit = (char: string): boolean => char >= '0' && char <= '9';

/**
 * Посимвольный фильтр ввода (спека 07: «Принимаются только цифры и один разделитель `.` или `,`. Некорректный
 * символ игнорируется»; handoff «Валидация посимвольная»): оставляет знак `+`/`-` только первым символом
 * результата и только при `allowSign`, цифры и **первый** встреченный разделитель. Всё остальное выбрасывается.
 *
 * «Первым символом результата», а не входа: фильтр гоняется на каждое нажатие, и мусор, набранный до знака,
 * к этому моменту уже вычищен предыдущим проходом — `a` + `-` даёт `-`, как если бы `a` не набирали.
 */
export const sanitizeLengthInput = (text: string, { allowSign }: { allowSign: boolean }): string => {
  let result = '';
  let separatorSeen = false;
  for (const char of text) {
    if (isDigit(char)) {
      result += char;
    } else if (SIGNS.includes(char)) {
      if (allowSign && result === '') result += char;
    } else if (INPUT_SEPARATORS.includes(char) && !separatorSeen) {
      separatorSeen = true;
      result += char;
    }
  }
  return result;
};

/**
 * Разбор строки в `ParsedLength`. Строка — в **текущих единицах**, `value` — всегда в см.
 *
 * `allowRelative = false` (инпут при рисовании — только абсолютная длина, спека 01 «Форматы ввода»): ведущий
 * `+`/`-` даёт `negative-not-allowed`. Больше одного разделителя в строке → `ambiguous-decimal` (спека 07
 * перечисляет случай «оба разделителя сразу»; два одинаковых — та же неоднозначность и та же подсказка).
 * Нет ни одной цифры (пусто, одиночный `+`/`-`, одиночный разделитель) → `empty`; не конечное число →
 * `out-of-range`. Пороги длины проверяет `resolveLength`, не парсер.
 */
export const parseLength = (
  text: string,
  units: Units,
  { allowRelative }: { allowRelative: boolean },
): Result<ParsedLength, LengthError> => {
  const trimmed = text.trim();
  const first = trimmed[0] ?? '';
  const sign = SIGNS.includes(first) ? first : null;
  if (sign !== null && !allowRelative) return err({ kind: 'negative-not-allowed' });

  const digits = sign === null ? trimmed : trimmed.slice(1);
  if (separatorCount(digits) > 1) return err({ kind: 'ambiguous-decimal' });
  if (![...digits].some(isDigit)) return err({ kind: 'empty' });

  const magnitude = unitsToCm(Number(digits.replace(',', '.')), units);
  if (!Number.isFinite(magnitude)) return err({ kind: 'out-of-range' });

  return ok({ relative: sign !== null, value: sign === '-' ? -magnitude : magnitude });
};

/**
 * Полный путь «строка → конечная длина в см» для поля: разбор, применение относительной формы к `current`
 * (тоже в см), проверка порогов. `> max` → `too-large`, `< min` → `too-small` (включая `0` и отрицательный
 * результат — спека 01: «Ввод `0` отклоняется как “слишком мало”, жёсткий пол 15 см»).
 */
export const resolveLength = (
  text: string,
  {
    units,
    current,
    allowRelative,
    min = MIN_INPUT_LENGTH,
    max = MAX_INPUT_LENGTH,
  }: { units: Units; current: number; allowRelative: boolean; min?: number; max?: number },
): Result<number, LengthError> => {
  const parsed = parseLength(text, units, { allowRelative });
  if (!parsed.ok) return parsed;

  const { relative, value } = parsed.value;
  const length = relative ? current + value : value;
  if (!Number.isFinite(length)) return err({ kind: 'out-of-range' });
  if (length > max) return err({ kind: 'too-large' });
  if (length < min) return err({ kind: 'too-small' });
  return ok(length);
};

/**
 * Тексты ошибок у поля (решение 5: кольцо danger на поле плюс горизонтальная плашка рядом). Три из них —
 * дословно из handoff `planner-editor-ui.md` («Плашка ошибки»); остальные handoff не задаёт — они требуют
 * подтверждения дизайна (Заметки задачи 0060).
 */
const LENGTH_ERROR_TEXT: Readonly<Record<LengthErrorKind, string>> = {
  'too-small': 'Стена короче 15 см',
  'width-too-small': `Стена тоньше ${MIN_WALL_WIDTH} см`,
  'too-large': 'Больше километра не бывает',
  'out-of-range': 'Больше километра не бывает',
  'self-intersected': 'Контур сам себя пересечёт',
  empty: 'Введите длину',
  // `+N`/`−N` понимают только поля правки готовой геометрии (спека 01 «Форматы ввода»), поэтому текст говорит
  // не про знак, а про то, что здесь ждут саму длину.
  'negative-not-allowed': 'Здесь только точная длина',
  'ambiguous-decimal': 'Оставьте один разделитель',
  rejected: 'Так изменить размер не получится',
};

/** Текст ошибки у поля по коду. Хардкод-строк в самом парсере нет (спека 07 «Локализация ошибок парсинга»). */
export const lengthErrorText = (kind: LengthErrorKind): string => LENGTH_ERROR_TEXT[kind];

/** Сколько символов-разделителей в строке — оба вида считаются вместе. */
const separatorCount = (text: string): number => [...text].filter(char => INPUT_SEPARATORS.includes(char)).length;
