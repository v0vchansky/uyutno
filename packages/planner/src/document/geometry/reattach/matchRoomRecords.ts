import type { PlanPosition } from '../../PlannerDocument';
import type { Id } from '../../id';
import { sameCycle } from '../contours/cyclicSequence';
import { compareContoursByArea } from '../predicates/compareContours';

/** Запись `rooms[]` с якорем, разрешённым по координатам черновика (пропавшие id пропущены). */
export interface AnchoredRecord {
  anchorIds: readonly Id[];
  anchor: readonly PlanPosition[];
}

/** Новая комната: id её точек (уже назначенные) и координаты обвода. */
export interface DetectedRoom {
  ids: readonly Id[];
  outline: readonly PlanPosition[];
}

/** Минимум точек якоря, чтобы запись могла быть донором (ADR 0017 C7). */
const MIN_DONOR_POINTS = 3;

/**
 * Пере-привязка атрибутов комнат по площади (ADR 0017 C7, спека 02 «Сохранение атрибутов при правках»):
 * для каждой новой комнаты — индекс записи-донора: сначала запись, чей якорь **тождествен** обводу комнаты
 * (та же циклическая последовательность id — та же комната, гарантирует идемпотентность `normalize`
 * там, где сетка 10×10 промахивается на тонких комнатах), иначе первая (в порядке `records`) запись с
 * `compareContoursByArea(anchor, outline) == 'intersect'` (сетка по bbox старого контура); якорь короче
 * 3 точек донором быть не может. Донор не расходуется: обе половинки разделённой комнаты наследуют одну запись.
 * `null` — донора нет (новая запись с высотой проекта, Q20). Записи, не ставшие донорами, — сироты (остаются).
 */
export const matchRoomRecords = (
  records: readonly AnchoredRecord[],
  rooms: readonly DetectedRoom[],
): (number | null)[] =>
  rooms.map(room => {
    const exact = records.findIndex(
      record => record.anchorIds.length >= MIN_DONOR_POINTS && sameCycle(record.anchorIds, room.ids),
    );
    if (exact !== -1) return exact;
    const byArea = records.findIndex(
      record =>
        record.anchor.length >= MIN_DONOR_POINTS && compareContoursByArea(record.anchor, room.outline) === 'intersect',
    );
    return byArea === -1 ? null : byArea;
  });
