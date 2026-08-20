import { rebuildContours } from '../contours/rebuildContours';
import { pointInContours } from '../predicates/pointInContour';
import type { ContourSet } from '../triangulate/triangulateContours';
import { type CoverShape, coverRegionPoint, coverShapes } from './coverShape';

export interface FindAutoCoversInput {
  /** Полости-комнаты (`inner` хранимых контуров): и seed заливки, и граница, за которую пол не выходит. */
  rooms: ContourSet;
  /** Обводы тел стен (`outer` хранимых контуров) — вычитаются. */
  walls: ContourSet;
  /**
   * **Только обводы** уже существующих (ручных, ужатых фазой (4)) полов — дырки сюда не передаются и
   * передать их нечем: занятой считается вся область внутри обвода, поэтому вырез под лестницу авто-полом
   * не зарастает. Обязательство вызывающего (стадия 0069): передать `covers[].outline`, не `holes`.
   */
  covers: ContourSet;
}

export interface FindAutoCoversResult {
  covers: CoverShape[];
  /** Хоть один обход оборвался внутри `rebuildContours` — движок логирует (стадия 0069). */
  softFail: boolean;
}

/**
 * Поиск места под дефолтный пол — фаза (5) `normalize` (ADR 0017 C6/C9,
 * [спека 02](../../../../../../docs/product/features/planner/02-rooms-floors-ceilings.md) «Автоматический пол»:
 * «дефолтный пол создаётся только в тех местах комнаты, где нет ни одного пола, поставленного вручную»).
 *
 * Дословный вызов референса (`findAutoCovers`, верифицировано), где контуры комнат играют сразу две роли:
 * `outer = rooms` — seed заливки (полость комнаты и есть то, что нужно застелить), `bound = rooms` — та же
 * граница, `subtract = walls + covers` — тела стен и уже существующие полы. `separateContacting: true` —
 * на каждую связную свободную область свой пол, а не один слитый на всю квартиру.
 *
 * **Почему поверх гейта нужен отбор по области.** `classifyFill` сравнивает глубины вложенности
 * (`inside(bound) >= inside(subtract)`), и в обычной квартире ручной пол исключается третьим контуром в
 * `subtract` — обводом тела стен, который содержит всё здание. Там, где стен нет («Комната по точкам»,
 * спека 01 «Polyline Room»), глубины перестают сходиться: у вложенных друг в друга комнат под ручным полом
 * получается «2 комнаты против 1 пола», гейт пропускает, и авто-пол дублирует ручной. Поэтому область
 * каждой группы проверяется точкой-представителем: она обязана лежать внутри хотя бы одной комнаты и вне
 * всех существующих полов. Строгим гейтом в `classifyFill` это не лечится — см. JSDoc `rebuildCovers`.
 *
 * Вход не мутируется, выход — свежие plain-объекты.
 */
export const findAutoCovers = ({ rooms, walls, covers }: FindAutoCoversInput): FindAutoCoversResult => {
  const result = rebuildContours({
    outer: rooms,
    inner: [],
    bound: rooms,
    subtract: [...walls, ...covers],
    separateContacting: true,
  });
  const free = result.walls.filter(group => {
    const point = coverRegionPoint(result, group);
    return point !== null && pointInContours(point, rooms, true) > 0 && pointInContours(point, covers, true) === 0;
  });
  return { covers: coverShapes(result, free), softFail: result.softFail };
};
