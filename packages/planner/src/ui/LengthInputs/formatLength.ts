import type { Units } from '../../document/PlannerDocument';

/**
 * Десятичный разделитель на показ — запятая (решение автора 19, спека 07 «Единицы измерения»:
 * `toFixed` физически даёт точку, форматтер подменяет её перед выводом). На вводе принимаются оба
 * разделителя — это забота `parseLength`.
 */
export const DECIMAL_SEPARATOR = ',';

/** Разделитель, который даёт `toFixed`; ищется в строке перед подменой на `DECIMAL_SEPARATOR`. */
const TO_FIXED_SEPARATOR = '.';

/** Суффикс единиц рядом с полем (спека 07 «Единицы измерения»). Имперской системы в продукте нет (решение 18). */
const UNIT_SUFFIX: Readonly<Record<Units, string>> = {
  cm: 'см',
  m: 'м',
  mm: 'мм',
};

/** Суффикс единиц рядом с полем: `см` / `м` / `мм`. */
export const unitSuffix = (units: Units): string => UNIT_SUFFIX[units];

/**
 * Знаков после разделителя на показ (спека 07 «Единицы измерения»): сантиметры — один знак, метры — три
 * (точность документа 0.001 см = 0.00001 м, но на показ спека просит именно три), миллиметры — целые.
 */
export const UNIT_FRACTION_DIGITS: Readonly<Record<Units, number>> = {
  cm: 1,
  m: 3,
  mm: 0,
};

/** Сколько единиц в одном сантиметре: см ×1, м ÷100, мм ×10. Хранение всегда в см (CLAUDE.md, инварианты). */
const UNITS_PER_CM: Readonly<Record<Units, number>> = {
  cm: 1,
  m: 1 / 100,
  mm: 10,
};

/** См → величина в текущих единицах. */
export const cmToUnits = (cm: number, units: Units): number => cm * UNITS_PER_CM[units];

/** Величина в текущих единицах → см. Обратная `cmToUnits`. */
export const unitsToCm = (value: number, units: Units): number => value / UNITS_PER_CM[units];

/**
 * Строка длины в текущих единицах без суффикса: `toFixed` по точности единиц → обрезка хвостовых нулей и
 * повисшего разделителя (спека 07: `250`, `250,5`, `2,5`, `2`) → точка заменяется запятой.
 *
 * Научной нотации и «∞» в выводе не бывает (спека 07 «Ограничения и пороги»): не конечное число даёт пустую
 * строку, а экспоненциальная форма у `toFixed` начинается только с 1e21 — на четыре порядка выше лимита
 * парсера (100 000 см = 1e6 мм).
 */
export const formatLength = (cm: number, units: Units): string => {
  if (!Number.isFinite(cm)) return '';
  const text = trimTrailingZeros(cmToUnits(cm, units).toFixed(UNIT_FRACTION_DIGITS[units]));
  return text.replace(TO_FIXED_SEPARATOR, DECIMAL_SEPARATOR);
};

/** Площадь всегда в м² (решение 18, спека 07 «Единицы измерения») и от переключателя единиц не зависит. */
const SQUARE_CM_IN_SQUARE_M = 10_000;

/** Знаков после разделителя у площади — один, хвостовые нули **не** режутся: `20,3 м²`, `12,0 м²`. */
const AREA_FRACTION_DIGITS = 1;

/**
 * Площадь на показ: `squareCm` — см², как `DerivedRoom.area`; результат — м² с запятой и одним знаком
 * (handoff `planner-editor-ui.md` «Подписи» → «Формат», образец — `ui/Planner/planDescription.ts`).
 * Не конечное значение даёт пустую строку — как и у `formatLength`.
 */
export const formatArea = (squareCm: number): string => {
  if (!Number.isFinite(squareCm)) return '';
  const text = (squareCm / SQUARE_CM_IN_SQUARE_M).toFixed(AREA_FRACTION_DIGITS);
  return text.replace(TO_FIXED_SEPARATOR, DECIMAL_SEPARATOR);
};

/**
 * Срезает хвостовые нули и повисший разделитель у результата `toFixed`. Целую часть не трогает (`200` при
 * нуле знаков остаётся `200`), а `-0` после округления схлопывается в `0`: минус у нулевой длины — мусор.
 */
const trimTrailingZeros = (text: string): string => {
  const trimmed = text.includes(TO_FIXED_SEPARATOR) ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
  return trimmed === '-0' ? '0' : trimmed;
};
