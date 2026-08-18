import type { Id } from '../../document/id';
import type { Floor, FloorLayout, PlanPosition, PlannerDocument, Point } from '../../document/PlannerDocument';
import { contourSelfIntersected } from '../../document/geometry/predicates/contourSelfIntersected';
import { err, ok, type Result } from '../Result';

/** Общая ошибка всех команд планировки (ADR 0018 D1). */
export type UnknownFloorError = { kind: 'unknown-floor'; floorId: Id };
export type UnknownPointError = { kind: 'unknown-point'; id: Id };

/** Этаж по id из замороженного снимка — валидация на границе команды. */
export const resolveFloor = (document: PlannerDocument, floorId: Id): Result<Floor, UnknownFloorError> => {
  const floor = document.floors.find(candidate => candidate.id === floorId);
  return floor ? ok(floor) : err({ kind: 'unknown-floor', floorId });
};

/** Точка этажа по id. */
export const resolvePoint = (layout: FloorLayout, id: Id): Result<Point, UnknownPointError> => {
  const point = layout.points[id];
  return point ? ok(point) : err({ kind: 'unknown-point', id });
};

export const isFinitePosition = (position: PlanPosition): boolean =>
  Number.isFinite(position.x) && Number.isFinite(position.y);

/**
 * Даст ли сдвиг точек самопересечение хотя бы одного контура-владельца (ADR 0018 D1: проверка «результата»
 * `setEdgeLength`/`setWallWidth` до записи в черновик). Контуры считаются с подменёнными координатами.
 */
export const movesSelfIntersect = (layout: FloorLayout, moves: ReadonlyMap<Id, PlanPosition>): boolean => {
  const loops = [...layout.contours, ...layout.covers, ...layout.areas];
  for (const loop of loops) {
    if (!loop.points.some(id => moves.has(id))) continue;
    const positions: PlanPosition[] = [];
    for (const id of loop.points) {
      const position = moves.get(id) ?? layout.points[id];
      if (position) positions.push(position);
    }
    if (contourSelfIntersected(positions)) return true;
  }
  return false;
};
