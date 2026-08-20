import type { WritableDraft } from 'immer';

import type { Id } from '../../document/id';
import type { Cut, FloorLayout } from '../../document/PlannerDocument';
import type { PlannerStore } from '../PlannerStore';
import { ok, type Result } from '../../document/Result';
import { resolveFloor, resolvePoint, type UnknownFloorError, type UnknownPointError } from './layoutAccess';

/** Минимум точек, при котором петля-владелец (контур/пол/зона) остаётся жить после удаления вершины. */
const MIN_LOOP_POINTS = 3;

export type DeletePointError = UnknownFloorError | UnknownPointError;

/**
 * Команда `document.deletePoint` — каскад ADR 0018 D2 в одной транзакции: id снимается со всех владельцев
 * (`contours`/`covers`/`areas`), `cuts` с этим концом удаляются; контур/пол/зона, у которых осталось < 3 точек,
 * удаляются целиком (cuts зоны — с ней); слияние двух смежных стен — следствие удаления вершины из петли.
 * Сама точка из пула не удаляется — её, оставшуюся без владельцев, снимает `normalize` (GC, C7), который до
 * этого пере-привязывает комнаты по координатам ещё живой точки. Порога «контур станет невалидным» на
 * границе нет — невалидное вычищают каскад и `normalize`. Отказ только `unknown-floor`/`unknown-point`.
 */
export const deletePoint = (store: PlannerStore, floorId: Id, id: Id): Result<void, DeletePointError> => {
  const floor = resolveFloor(store.getDocument(), floorId);
  if (!floor.ok) return floor;
  const point = resolvePoint(floor.value.layout, id);
  if (!point.ok) return point;

  store.transact(draft => cascadeDelete(draft.floors.find(candidate => candidate.id === floorId)!.layout, id), {
    history: { zone: 'layout' },
  });
  return ok(undefined);
};

/** Каскад пишет в черновик только затронутые массивы: ссылки нетронутых поддеревьев сохраняются. */
const cascadeDelete = (layout: WritableDraft<FloorLayout>, id: Id): void => {
  const contours = removeFromLoops(layout.contours, id);
  if (contours.survivors) layout.contours = contours.survivors;
  const covers = removeFromLoops(layout.covers, id);
  if (covers.survivors) layout.covers = covers.survivors;
  // Зоны: удаляемая зона забирает свои cuts. Ссылки на зону у Cut в модели нет, поэтому «cuts зоны» =
  // cuts с обоими концами среди точек зоны на момент удаления, которые не держит ни одна выжившая зона.
  const areas = removeFromLoops(layout.areas, id);
  if (areas.survivors) layout.areas = areas.survivors;
  const heldBySurvivor = (cut: Cut): boolean =>
    layout.areas.some(area => area.points.includes(cut.a) && area.points.includes(cut.b));
  const cuts = layout.cuts.filter(cut => {
    if (cut.a === id || cut.b === id) return false;
    const ofRemovedArea = areas.removedPoints.has(cut.a) && areas.removedPoints.has(cut.b);
    return !ofRemovedArea || heldBySurvivor(cut);
  });
  if (cuts.length !== layout.cuts.length) layout.cuts = cuts;
};

/**
 * Снимает `id` с петель коллекции на месте; выродившиеся (< 3 точек) выбрасывает. `survivors` — новый массив,
 * только если что-то выброшено (иначе `null`: массив не трогаем); `removedPoints` — точки удалённых петель.
 */
const removeFromLoops = <L extends WritableDraft<{ points: Id[] }>>(
  loops: L[],
  id: Id,
): { survivors: L[] | null; removedPoints: Set<Id> } => {
  const removedPoints = new Set<Id>();
  const survivors = loops.filter(loop => {
    if (!loop.points.includes(id)) return true;
    const points = loop.points.filter(pointId => pointId !== id);
    if (points.length < MIN_LOOP_POINTS) {
      for (const pointId of loop.points) removedPoints.add(pointId);
      return false;
    }
    loop.points = points;
    return true;
  });
  return { survivors: survivors.length === loops.length ? null : survivors, removedPoints };
};
