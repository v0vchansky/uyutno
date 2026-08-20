import type { PlannerDocument } from '../document/PlannerDocument';
import type { JsonValue } from './version';

/**
 * Детерминированная запись документа: **одинаковый документ даёт байт в байт одинаковую строку**.
 *
 * Одного `JSON.stringify` для этого мало — он пишет ключи в порядке вставки, а этот порядок у нас
 * не инвариант: `layout.points` — `Record<Id, Point>`, куда точки попадают в порядке правок, а не по
 * алфавиту, и `immer` при копировании поддеревьев порядок тоже не гарантирует. Поэтому ключи объектов
 * сортируются, а порядок элементов массивов сохраняется — там он данные (обход контура), а не оформление.
 *
 * На детерминизме держится diff-guard черновика демо (задача 0083): реальный `setItem` идёт только если
 * строка отличается от прошлой, и «плавающий» порядок ключей означал бы запись на каждом тике простоя.
 *
 * Незнакомые поля, которые пронесла через себя схема (`looseObject`, forward-compat ADR 0021), пишутся
 * наравне со своими: функция ходит по фактическому объекту, а не по списку известных полей.
 */
const canonical = (value: unknown): JsonValue | undefined => {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(item => canonical(item) ?? null);
  if (typeof value === 'object') {
    const result: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = canonical((value as Record<string, unknown>)[key]);
      // `undefined` как значение в документе запрещён (ADR 0016 B5) — ключ просто не пишется, как в JSON.
      if (child !== undefined) result[key] = child;
    }
    return result;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return undefined;
};

export const serialize = (document: PlannerDocument): string => JSON.stringify(canonical(document));
