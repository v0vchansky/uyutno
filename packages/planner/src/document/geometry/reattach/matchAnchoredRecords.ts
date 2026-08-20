import type { PlanPosition } from '../../PlannerDocument';
import type { Id } from '../../id';
import { sameCycle } from '../contours/cyclicSequence';
import { compareContoursByArea } from '../predicates/compareContours';

/** Запись с якорем, разрешённым по координатам черновика (пропавшие id пропущены). */
export interface AnchoredRecord {
  anchorIds: readonly Id[];
  anchor: readonly PlanPosition[];
}

/** Обнаруженная сущность пересборки (комната, пол): id её точек (уже назначенные) и координаты обвода. */
export interface DetectedContour {
  ids: readonly Id[];
  outline: readonly PlanPosition[];
}

/** Минимум точек якоря, чтобы запись могла быть донором (ADR 0017 C7). */
export const MIN_DONOR_POINTS = 3;

/**
 * Пере-привязка атрибутов по перекрытию площади (ADR 0017 C7, [спека 02](../../../../../../docs/product/features/planner/02-rooms-floors-ceilings.md)
 * «Сохранение атрибутов при правках») — общий приём для комнат (`matchRoomRecords`) и полов
 * (`matchCoverRecords`): у референса это один и тот же код с точностью до массива.
 *
 * Для каждой обнаруженной сущности — индекс записи-донора: сначала запись, чей якорь **тождествен** обводу
 * (та же циклическая последовательность id — та же сущность, гарантирует идемпотентность `normalize` там,
 * где сетка 10×10 промахивается на тонких контурах), иначе первая (в порядке `records`) запись с
 * `compareContoursByArea(anchor, outline) == 'intersect'` (сетка по bbox старого контура); якорь короче
 * `MIN_DONOR_POINTS` точек донором быть не может. Донор **не расходуется**: обе половинки разделённой
 * сущности наследуют одну запись. `null` — донора нет. Записи, не ставшие донорами, — сироты.
 */
export const matchAnchoredRecords = (
  records: readonly AnchoredRecord[],
  detected: readonly DetectedContour[],
): (number | null)[] =>
  detected.map(item => {
    const exact = records.findIndex(
      record => record.anchorIds.length >= MIN_DONOR_POINTS && sameCycle(record.anchorIds, item.ids),
    );
    if (exact !== -1) return exact;
    const byArea = records.findIndex(
      record =>
        record.anchor.length >= MIN_DONOR_POINTS && compareContoursByArea(record.anchor, item.outline) === 'intersect',
    );
    return byArea === -1 ? null : byArea;
  });
