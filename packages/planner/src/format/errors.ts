/**
 * Ошибки разбора конверта (ADR 0021, спека 10 «Ошибочные сценарии»). Исключений наружу нет — всё едет
 * в `Result` (ADR 0015 A2).
 *
 * - `corrupt` — «битый проект» спеки: нечитаемый JSON, отсутствие `format`/`version`/`floors`,
 *   структурно негодное содержимое. UI показывает модалку «Не удалось открыть проект».
 * - `unsupported-version` — документ записан более новым бандлом. UI предлагает **перезагрузить
 *   страницу**: у нас веб, обновлять пользователю нечего, у него просто устаревший бандл во вкладке.
 *
 * Битые id-ссылки сюда не попадают вовсе: запись молча пропускается, проект читается (ADR 0016 B2).
 */
export type CorruptReason =
  'invalid-json' | 'not-an-object' | 'missing-format' | 'missing-version' | 'missing-floors' | 'schema';

export type ParseError =
  | { kind: 'corrupt'; reason: CorruptReason; detail: string }
  | { kind: 'unsupported-version'; version: number; supported: number };

export const corrupt = (reason: CorruptReason, detail: string): ParseError => ({ kind: 'corrupt', reason, detail });
