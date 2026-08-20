import type { Id } from '../../document/id';
import type { PlannerStore } from '../PlannerStore';
import { ok, type Result } from '../Result';
import { resolveArea, type UnknownAreaError } from './loopAccess';
import { resolveFloor, type UnknownFloorError } from './layoutAccess';

export type DeleteAreaError = UnknownFloorError | UnknownAreaError;

/**
 * Команда `document.deleteArea` (ADR 0018 D1): запись снимается с `layout.areas`, дальше обычные
 * `normalize`/`rebuild` в той же транзакции.
 *
 * **Записи `cuts[]` руками не трогаются** — владения у записи нет, оно вычисляется (решение (1) эпика 0066,
 * ADR 0017 «Что важно знать»): фаза (3) `normalize` пересобирает нужный набор из интерьерных участков рёбер
 * **выживших** зон и сводит к нему хранимые (`reconcileCuts`). Поэтому грани удалённой зоны исчезают сами, а
 * участок, общий с касающейся соседкой, переживает удаление вместе со своим id и материалом, если остался
 * интерьерным у неё.
 *
 * Точки, оставшиеся без владельцев, снимает GC точек в конце `normalize`; точки, разделённые с комнатой,
 * остаются — у них есть контур-владелец.
 */
export const deleteArea = (store: PlannerStore, floorId: Id, id: Id): Result<void, DeleteAreaError> => {
  const floor = resolveFloor(store.getDocument(), floorId);
  if (!floor.ok) return floor;
  const area = resolveArea(floor.value.layout, id);
  if (!area.ok) return area;

  store.transact(
    draft => {
      const layout = draft.floors.find(candidate => candidate.id === floorId)!.layout;
      layout.areas = layout.areas.filter(candidate => candidate.id !== id);
    },
    { history: { zone: 'layout' } },
  );
  return ok(undefined);
};
