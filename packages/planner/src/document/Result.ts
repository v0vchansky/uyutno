/**
 * Результат синхронной команды фасада (ADR 0015 A2): discriminated union, исключений наружу нет.
 * Своё, а не `neverthrow`: чужой API (`.map/.andThen`) в публичном контракте фасада не нужен.
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
