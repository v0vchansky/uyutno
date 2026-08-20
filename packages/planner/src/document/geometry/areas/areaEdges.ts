import type { PlanPosition } from '../../PlannerDocument';
import { COORDINATE_QUANTUM, quantize } from '../../quantize';
import { euclDist } from '../predicates/distance';
import { pointOnSegment } from '../predicates/pointOnSegment';
import { segmentsOverlay } from '../predicates/segmentsOverlay';

/**
 * Грань хранимого контура как пара точек — структурный минимум `WallFace` (`axes/layoutFaces`), чтобы
 * классификация рёбер зоны не тянула ни `faceRight`, ни `ref`: сюда годится и результат `layoutFaces`
 * (там `T = Point`, с id), и рёбра «сырых» координатных контуров (`contourFaces`, `T = PlanPosition`).
 */
export interface AreaFace<T extends PlanPosition = PlanPosition> {
  a: T;
  b: T;
}

/**
 * Вид участка ребра зоны (спека 02 «Вертикальные грани зоны»):
 *
 * - `wall` — участок лежит по стороне комнаты. Вертикальной грани и записи `cuts[]` не порождает: границу
 *   держит сама стена. По спеке 02 «Что видит пользователь» такая стена укорачивается до высоты зоны **и
 *   теряет верхний плинтус (молдинг)» — это случай «стена совпала с ребром зоны».
 * - `interior` — участок идёт через интерьер комнаты: порождает вертикальную грань и запись `cuts[]`.
 *
 * Третий случай спеки — стена, **целиком лежащая внутри** зоны, — здесь не виден вовсе: она не совпадает
 * ни с одним ребром зоны. Такая стена только укорачивается, молдинг сохраняет, и данные для этого отдаёт
 * не классификация рёбер, а стадия производного (0070).
 */
export type AreaEdgeKind = 'wall' | 'interior';

/** Однородно классифицированный участок ребра зоны: между `a` и `b` вид не меняется. */
export interface AreaEdgeSegment<T extends PlanPosition = PlanPosition> {
  a: T;
  b: T;
  kind: AreaEdgeKind;
}

/**
 * Допуск коллинеарности при сличении ребра зоны с гранью контура, см. Не третий эпсилон (README ядра:
 * «свой порог — именованная константа рядом с функцией»), а шаг квантования: точка, лежащая на грани
 * *по построению* (T-стык, снап), после квантования до 0.001 отходит от прямой на полкванта по каждой
 * оси — до ≈ 0.0007 см, то есть **больше** `B_EPS`. С `L_EPS` ребро зоны вдоль диагональной стены с
 * T-стыком читалось бы как «через интерьер» и получало бы лишнюю вертикальную грань. Окно приёма при
 * этом включает ровно один квант — осознанно: спека 02 и ADR 0017 C6 говорят «допуск равен шагу
 * квантования», и держать константу равной кванту честнее, чем подбирать коэффициент.
 */
export const FACE_COLLINEAR_EPS = COORDINATE_QUANTUM;

/**
 * Все рёбра зоны как пары точек — вход `cutPairs` триангуляции (`getAllPairs` референса: каждая
 * последовательная пара точек полигона, замкнуто). Контур незамкнутый, замыкающее ребро добавляется.
 * `< 2` точек — рёбер нет; ровно 2 точки — одно ребро (замыкающее совпало бы с ним же). Рёбра нулевой
 * длины (подряд идущие совпавшие точки) отбрасываются: `segmentsOverlay` ждёт отрезки ненулевой длины,
 * а зона с дублем точки всё равно не пройдёт `validateArea`. Вход не мутируется, точки — по ссылке.
 */
export const areaPairs = <T extends PlanPosition>(areaPoints: readonly T[]): [T, T][] => {
  const n = areaPoints.length;
  if (n < 2) return [];
  const closing = n === 2 ? 1 : n;
  const pairs: [T, T][] = [];
  for (let i = 0; i < closing; i++) {
    const a = areaPoints[i]!;
    const b = areaPoints[(i + 1) % n]!;
    if (euclDist(a, b) > FACE_COLLINEAR_EPS) pairs.push([a, b]);
  }
  return pairs;
};

/** Грани набора координатных контуров — каждое ребро в порядке обхода (аналог `layoutFaces` без id и стороны). */
export const contourFaces = <T extends PlanPosition>(contours: readonly (readonly T[])[]): AreaFace<T>[] =>
  contours.flatMap(contour => areaPairs(contour).map(([a, b]) => ({ a, b })));

/**
 * Ребро `a → b` лежит по грани контура: коллинеарное наложение с реальным нахлёстом (`segmentsOverlay`
 * с `FACE_COLLINEAR_EPS`). Касание грани одним только концом наложением не считается — `segmentsOverlay`
 * отсекает его отрицательным слаком; поэтому ребро, стартующее из угла комнаты и уходящее внутрь,
 * остаётся интерьерным. Предикат отвечает «есть ли нахлёст», а не «покрыто ли ребро целиком», поэтому
 * применять его можно только к участкам, уже разрезанным по концам граней (`classifyAreaEdges`).
 */
export const edgeOnFace = (a: PlanPosition, b: PlanPosition, faces: readonly AreaFace[]): boolean =>
  faces.some(face => segmentsOverlay(a, b, face.a, face.b, FACE_COLLINEAR_EPS));

/**
 * Точки разреза ребра `a → b`: концы граней, лежащие строго внутри него (дальше `FACE_COLLINEAR_EPS` от
 * обоих концов), в порядке следования вдоль ребра. Наложение грани на ребро может начаться или кончиться
 * только в конце грани либо на конце самого ребра — поэтому после разреза в этих точках каждый участок
 * однороден. Дубли координат схлопываются по квантованному ключу.
 */
const splitPoints = <T extends PlanPosition>(a: T, b: T, faces: readonly AreaFace<T>[]): T[] => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const found: { point: T; along: number }[] = [];
  const seen = new Set<string>();
  for (const face of faces) {
    for (const point of [face.a, face.b]) {
      if (euclDist(point, a) <= FACE_COLLINEAR_EPS || euclDist(point, b) <= FACE_COLLINEAR_EPS) continue;
      if (!pointOnSegment(point, a, b, FACE_COLLINEAR_EPS)) continue;
      const key = `${quantize(point.x)}|${quantize(point.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ point, along: ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq });
    }
  }
  return found.sort((first, second) => first.along - second.along).map(entry => entry.point);
};

/**
 * Классификация рёбер зоны против граней хранимых контуров — **по участкам**, а не по ребру целиком
 * (аналог `getCutWallPairs` референса по смыслу; буква у референса другая: он спрашивает
 * `cont.indexOf(A)`/`indexOf(B)` — соседство концов по тождеству объектов точек в массиве контура, с
 * шорткатом `A.contour != B.contour`. У нас зона опёрта на точки комнат геометрически, а «соседство»
 * ломается на T-стыках и на общей стене двух комнат, поэтому вопрос решается наложением отрезков).
 *
 * **Почему по участкам.** Ребро зоны может идти по грани и продолжаться за её конец — в L-образной комнате
 * грань обрывается на повороте, а ребро зоны идёт дальше через интерьер. Один вид на всё ребро оставил бы
 * реально интерьерный кусок без вертикальной грани (спека 02: грань нужна «на тех рёбрах зоны, что идут
 * через интерьер комнаты»), а `interiorCutEdges` тот же кусок пометил бы интерьерным — наборы разошлись бы.
 * Поэтому ребро режется по концам граней (`splitPoints`), и каждый участок классифицируется целиком.
 *
 * Выход — плоский список участков в порядке обхода зоны; **длина результата числу рёбер зоны не равна**
 * (было так до 2026-08-20). Концы участков — либо точки зоны, либо концы граней, то есть в обоих случаях
 * хранимые точки этажа: стадия `normalize` (0069) разрешает их в id по тождеству квантованной координаты
 * (тот же ключ, что у `areaSupported`) и складывает интерьерные участки в `requiredCuts`.
 *
 * Вход не мутируется, точки участков — те же объекты, что во входе (при `T = Point` id доезжают сами).
 */
export const classifyAreaEdges = <T extends PlanPosition>(
  areaPoints: readonly T[],
  faces: readonly AreaFace<T>[],
): AreaEdgeSegment<T>[] => {
  const segments: AreaEdgeSegment<T>[] = [];
  for (const [a, b] of areaPairs(areaPoints)) {
    const chain = [a, ...splitPoints(a, b, faces), b];
    for (let i = 0; i < chain.length - 1; i++) {
      const from = chain[i]!;
      const to = chain[i + 1]!;
      if (euclDist(from, to) <= FACE_COLLINEAR_EPS) continue;
      segments.push({ a: from, b: to, kind: edgeOnFace(from, to, faces) ? 'wall' : 'interior' });
    }
  }
  return segments;
};
