import type { Id } from '../../document/id';
import type { PlanPosition } from '../../document/PlannerDocument';
import type { PlannerStore } from '../PlannerStore';

/**
 * Общий хвост `setEdgeLength`/`setWallWidth`: одна транзакция зоны `layout` с ключом коалесинга, координаты
 * (уже квантованные) пишутся поимённо — immer видит те же примитивы как no-op, записи и событий тогда нет.
 */
export const writePositions = (
  store: PlannerStore,
  floorId: Id,
  moves: ReadonlyMap<Id, PlanPosition>,
  coalesce: string,
): void => {
  store.transact(
    draft => {
      const layout = draft.floors.find(candidate => candidate.id === floorId)!.layout;
      for (const [id, { x, y }] of moves) {
        const point = layout.points[id]!;
        point.x = x;
        point.y = y;
      }
    },
    { history: { zone: 'layout', coalesce } },
  );
};
