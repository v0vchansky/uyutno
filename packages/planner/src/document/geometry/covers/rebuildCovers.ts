import { rebuildContours } from '../contours/rebuildContours';
import { pointInContours } from '../predicates/pointInContour';
import type { ContourSet } from '../triangulate/triangulateContours';
import { type CoverShape, coverRegionPoint, coverShapes } from './coverShape';

export interface RebuildCoversInput {
  /** Обводы существующих полов. */
  covers: ContourSet;
  /** Контуры полов-вычитаний (дырок). */
  coverHoles: ContourSet;
  /** Полости-комнаты (`inner` хранимых контуров) — граница, за которую пол не выходит. */
  rooms: ContourSet;
  /** Обводы тел стен (`outer` хранимых контуров) — вычитаются. */
  walls: ContourSet;
}

export interface RebuildCoversResult {
  covers: CoverShape[];
  /** Хоть один обход оборвался внутри `rebuildContours` — движок логирует (стадия 0069). */
  softFail: boolean;
}

/**
 * Ужимание существующих (ручных) полов под новую форму комнат — фаза (4) `normalize` (ADR 0017 C6/C9,
 * [спека 02](../../../../../../docs/product/features/planner/02-rooms-floors-ceilings.md) «Что происходит
 * с полом при перерисовке стен»). Один вызов `rebuildContours(outer = covers, inner = coverHoles,
 * bound = rooms, subtract = walls, separateContacting: true)` — ровно та комбинация, что у референса
 * (верифицировано, `rebuildCovers`): пол не выходит за полости-комнаты, тела стен из него вычитаются,
 * а `separateContacting` оставляет касающиеся полы отдельными телами (спека 02 «Слияние соседних полов»:
 * склеивает их фаза (5) через `mergeCovers`, а не подрезка).
 *
 * Следствия, за которые отвечает эта функция: пол при сжатии комнаты подрезается по новой границе; пол,
 * разрезанный новой перегородкой, распадается на несколько кусков (перегородка — fixed-рёбра, куски попадают
 * в разные группы); пол, целиком выпавший из комнат, исчезает; полы двух слитых комнат остаются на местах.
 *
 * **Почему нужен отбор «область внутри комнаты», а не только гейт триангуляции.** `classifyFill` при
 * непустых `bound`/`subtract` считает не множества, а глубины вложенности: `inside(bound) >= inside(subtract)`.
 * Это не прихоть — хранимый `outer` контур тела стен есть его **обвод** (дырка-полость отдельным контуром не
 * хранится), поэтому любая точка внутри здания лежит внутри контура стен, и строгое «вне всех `subtract`»
 * стёрло бы полы целиком (проверено: все полы исчезают). Обратная сторона глубин — кусок пола, оказавшийся
 * **вне здания вообще**, даёт `0 >= 0` и у референса выживает «висящим в воздухе». Спека 02 требует
 * обратного («висящих за пределами комнаты кусков не остаётся»; «если комната исчезает, её полы уходят
 * вместе с ней»), поэтому группа дополнительно проверяется точкой-представителем против `rooms`. Побочно
 * это закрывает вырожденный вход `rooms = []`: полов не остаётся вовсе, а не «все, что вне стен».
 *
 * Пере-привязка данных старых полов к новым — не здесь, а `reattach/matchCoverRecords` (тот же приём, что
 * у комнат: сетка 10×10, `compareContoursByArea`). Вход не мутируется, выход — свежие plain-объекты.
 */
export const rebuildCovers = ({ covers, coverHoles, rooms, walls }: RebuildCoversInput): RebuildCoversResult => {
  const result = rebuildContours({
    outer: covers,
    inner: coverHoles,
    bound: rooms,
    subtract: walls,
    separateContacting: true,
  });
  const inRooms = result.walls.filter(group => {
    const point = coverRegionPoint(result, group);
    // `point === null` (группа из одних сливеров) недостижимо — такие группы отбрасывает `triangulateContours`;
    // ветка остаётся защитой на случай изменения его контракта, тестом не покрывается.
    return point !== null && pointInContours(point, rooms, true) > 0;
  });
  return { covers: coverShapes(result, inRooms), softFail: result.softFail };
};
