/**
 * Результат синхронной команды фасада (ADR 0015 A2): discriminated union, исключений наружу нет.
 * Своё, а не `neverthrow`: чужой API (`.map/.andThen`) в публичном контракте фасада не нужен.
 *
 * Живёт в `document/`, а не в `engine/`, потому что тот же примитив нужен узкому входу `format/` (`parse`
 * возвращает `Result`), а `format/` по правилу слоёв не видит `engine/` **ни в каком виде** (задача 0079,
 * ADR 0021). Файл безимпортный — переезд вниз ничего не тащит за собой.
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
