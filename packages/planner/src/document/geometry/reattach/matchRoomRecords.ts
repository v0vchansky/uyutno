import { type AnchoredRecord, type DetectedContour, matchAnchoredRecords } from './matchAnchoredRecords';

export type { AnchoredRecord } from './matchAnchoredRecords';

/** Новая комната: id её точек (уже назначенные) и координаты обвода. */
export type DetectedRoom = DetectedContour;

/**
 * Пере-привязка атрибутов комнат (ADR 0017 C7, спека 02 «Сохранение атрибутов при правках») — общий
 * `matchAnchoredRecords` с записями `rooms[]` в роли доноров: точное совпадение цикла id, иначе первое
 * перекрытие по площади, иначе `null` (новая запись с высотой проекта, Q20). Записи, не ставшие донорами,
 * остаются сиротами (по спеке, вопреки референсу).
 */
export const matchRoomRecords = (
  records: readonly AnchoredRecord[],
  rooms: readonly DetectedRoom[],
): (number | null)[] => matchAnchoredRecords(records, rooms);
