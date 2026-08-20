import { type AnchoredRecord, type DetectedContour, matchAnchoredRecords } from './matchAnchoredRecords';

export type { AnchoredRecord } from './matchAnchoredRecords';

/** Новый пол: id его точек (уже назначенные) и координаты обвода. */
export type DetectedCover = DetectedContour;

/**
 * Пере-привязка данных полов (ADR 0017 C7/C9, [спека 02](../../../../../../docs/product/features/planner/02-rooms-floors-ceilings.md)
 * «Что происходит с полом при перерисовке стен»: «материалы и разбиение на участки переносятся на новые полы
 * по тому же правилу перекрытия площади, что и для комнат») — тот же `matchAnchoredRecords`, что у комнат:
 * у референса `rebuildCovers` перепривязывает данные пола ровно тем же `compareContoursByArea == INTERSECT`
 * с первым совпавшим донором (верифицировано).
 *
 * Точное совпадение цикла id проверяется перед тестом по площади — это то, что делает `normalize`
 * идемпотентной: повторный прогон на уже нормализованном документе обязан вернуть тех же доноров.
 *
 * Порядок `records` — порядок обхода полов при пересборке, поэтому «первый пол-донор» спеки 02
 * (флаг «скрыть потолок» при слиянии двух полов в один) — это именно возвращаемый здесь индекс.
 * Глубокое копирование подобъекта потолка при переносе (чтобы слитые полы не делили состояние потолка) —
 * забота стадии, применяющей доноров (0069), не этой чистой функции.
 */
export const matchCoverRecords = (
  records: readonly AnchoredRecord[],
  covers: readonly DetectedCover[],
): (number | null)[] => matchAnchoredRecords(records, covers);
