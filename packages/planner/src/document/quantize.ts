/**
 * Шаг квантования координат документа — 0.001 см (ADR 0016 B1, спека 01 «Снап»).
 * Любая координата, попадающая в документ через снап/ввод, проходит через `quantize`.
 */
export const COORDINATE_QUANTUM = 0.001;

const STEPS_PER_UNIT = 1 / COORDINATE_QUANTUM;

/**
 * Округляет значение до ближайшего кратного `COORDINATE_QUANTUM`.
 * Считает в целых шагах (`round(v * 1000) / 1000`), а не `round(v / q) * q`, чтобы не ловить хвосты
 * плавающей точки вида `0.30000000000000004`. `-0` нормализуется в `0` (иначе `Object.is` и снапшоты
 * различали бы «нулевые» точки). Не-конечные значения (`NaN`, `±Infinity`) пробрасываются как есть —
 * отсекать их обязана валидация команды фасада, а не молчаливая подмена внутри чистой функции.
 */
export const quantize = (value: number): number => {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * STEPS_PER_UNIT) / STEPS_PER_UNIT || 0;
};
