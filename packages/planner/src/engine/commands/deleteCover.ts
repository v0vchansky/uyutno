import type { Id } from '../../document/id';
import type { PlannerStore } from '../PlannerStore';
import { ok, type Result } from '../../document/Result';
import { resolveCover, type UnknownCoverError } from './loopAccess';
import { resolveFloor, type UnknownFloorError } from './layoutAccess';

export type DeleteCoverError = UnknownFloorError | UnknownCoverError;

/**
 * Команда `document.deleteCover` ([спека 02](../../../../../docs/product/features/planner/02-rooms-floors-ceilings.md)
 * «Полы»: «пользователь может явно удалить пол и оставить комнату без покрытия»): запись снимается с
 * `layout.covers`, дальше обычные `normalize`/`rebuild` в той же транзакции.
 *
 * Что делает нормализация после удаления — её правило, не команды: у обвода это фаза (5) (`findAutoCovers`
 * застилает освободившуюся площадь комнаты дефолтным полом), у дырки — фаза (4)+(6) (вырез зарастает
 * материалом хозяина). «Комната без покрытия» в 2b поэтому наступает только там, где комнаты нет —
 * признака «пол удалён намеренно, авто-полом не застилать» модель не хранит (см. отчёт 0071).
 *
 * Точки, оставшиеся без владельцев, снимает GC точек в конце `normalize` — руками их не трогаем.
 */
export const deleteCover = (store: PlannerStore, floorId: Id, id: Id): Result<void, DeleteCoverError> => {
  const floor = resolveFloor(store.getDocument(), floorId);
  if (!floor.ok) return floor;
  const cover = resolveCover(floor.value.layout, id);
  if (!cover.ok) return cover;

  store.transact(
    draft => {
      const layout = draft.floors.find(candidate => candidate.id === floorId)!.layout;
      layout.covers = layout.covers.filter(candidate => candidate.id !== id);
    },
    { history: { zone: 'layout' } },
  );
  return ok(undefined);
};
