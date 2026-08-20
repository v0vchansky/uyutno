import type { PlanPosition } from '../../PlannerDocument';
import { euclDist } from '../predicates/distance';
import { lineIntersectLine } from '../predicates/lineIntersectLine';
import { type OffsetSide, offsetSegment } from '../predicates/offsetPoint';

/**
 * Отступ осевой линии плинтуса от грани внутрь комнаты, см — `d = 1` в `createPlinths` референса
 * (`plannercore.js:55411`, верифицировано). Это не толщина профиля: профиль (16 форм, спека 02
 * «Форма профиля») приходит мешам на шаге 4, а ядро отдаёт только осевой квад свипа.
 */
export const PLINTH_OFFSET = 1;

/**
 * Предел выноса митры, см — `maxDist = d * 2` референса. Дальше угол считается слишком острым, и вместо
 * точки пересечения соседних осевых линий берётся просто смещённый конец текущей (плоский торец).
 * Порог берётся **по расстоянию от угла контура**, а не по углу: `|B, Bx| = d / sin(θ/2)`, поэтому
 * `PLINTH_MAX_MITER` соответствует внутреннему углу 60° — ровно и включительно (`>` в проверке).
 */
export const PLINTH_MAX_MITER = PLINTH_OFFSET * 2;

/**
 * Осевой квад свипа плинтуса вдоль грани `b → c`: `[B, C, Bx, Cx]` — порядок аргументов
 * `wall.bottomPlinth.setPoints(B, C, Bx, Cx)` референса. `B`/`C` — концы самой грани, `Bx`/`Cx` — те же
 * концы, отведённые внутрь комнаты с учётом соседних граней (митра или плоский торец).
 */
export type PlinthQuad = readonly [PlanPosition, PlanPosition, PlanPosition, PlanPosition];

export interface PlinthQuadInput {
  /** Точка кольца контура **перед** `b`. */
  a: PlanPosition;
  b: PlanPosition;
  c: PlanPosition;
  /** Точка кольца контура **после** `c`. */
  d: PlanPosition;
  /** Сторона смещения от направления `b → c` — внутрь комнаты (выводится из `faceRight`, см. `layoutFaces`). */
  side: OffsetSide;
}

/**
 * Квад свипа плинтуса вдоль одной грани комнаты — `createPlinths` референса (`plannercore.js:55411–55474`,
 * верифицировано) на наших предикатах.
 *
 * Осевые линии трёх подряд идущих граней (`a→b`, `b→c`, `c→d`) смещаются на `PLINTH_OFFSET` **в одну и ту
 * же сторону** `side` (внутрь комнаты); `Bx` — пересечение прямых предыдущей и текущей, `Cx` — текущей и
 * следующей. Пересечение ищется как у **прямых**, не отрезков (`asSegment: false`): у тупого угла точка
 * митры лежит за концами обоих смещённых отрезков. Нет пересечения (соседние грани параллельны — угол
 * развёрнут или грань вырождена) либо вынос дальше `PLINTH_MAX_MITER` — берётся смещённый конец текущей
 * грани: плоский торец.
 *
 * `null` — сама грань вырождена (`|bc| < L_EPS`): свипить нечего. Вырожденность соседних граней на
 * результат не влияет — они просто не дают митры.
 *
 * Чистая функция: вход не мутируется, все четыре точки выхода — свежие объекты (`B`/`C` копируются, чтобы
 * в производное не утекли узлы замороженного снимка вместе с их `id`).
 */
export const plinthQuad = ({ a, b, c, d, side }: PlinthQuadInput): PlinthQuad | null => {
  const current = offsetSegment(b, c, PLINTH_OFFSET, side);
  if (!current) return null;
  const [bpc, cpc] = current;
  const previous = offsetSegment(a, b, PLINTH_OFFSET, side);
  const next = offsetSegment(c, d, PLINTH_OFFSET, side);
  const bx = previous && lineIntersectLine(previous[0], previous[1], bpc, cpc, { asSegment: false });
  const cx = next && lineIntersectLine(bpc, cpc, next[0], next[1], { asSegment: false });
  return [{ x: b.x, y: b.y }, { x: c.x, y: c.y }, miter(b, bx, bpc), miter(c, cx, cpc)];
};

/** Точка митры, если она есть и не дальше `PLINTH_MAX_MITER` от угла контура; иначе плоский торец. */
const miter = (corner: PlanPosition, candidate: PlanPosition | null, flat: PlanPosition): PlanPosition =>
  candidate !== null && euclDist(corner, candidate) <= PLINTH_MAX_MITER ? candidate : flat;
