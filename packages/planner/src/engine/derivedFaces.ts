import { contourFaces, edgeOnFace } from '../document/geometry/areas/areaEdges';
import { contourArea } from '../document/geometry/predicates/contourArea';
import { type OffsetSide } from '../document/geometry/predicates/offsetPoint';
import { locatePointInContour } from '../document/geometry/predicates/pointInContour';
import { type PlinthQuad, plinthQuad } from '../document/geometry/skirting/plinthQuad';
import type { Id } from '../document/id';
import type { PlanPosition } from '../document/PlannerDocument';

/**
 * Грань комнаты — ребро её `inner`-контура в порядке обхода (та же единица адресации, что у `FaceRef`
 * осей: контур + пара id концов, ADR 0017 C8). Несёт две производные величины, которые шагу 4 нужны,
 * чтобы строить меши стен «как будто зоны уже есть» (build-order, «Осознанные переносы»):
 *
 * - `top` — верх стены на этой грани, см: высота комнаты (`Room.ceilingHeight`), а под зоной — высота зоны;
 * - `underArea` — грань **совпала** с ребром зоны, поэтому верхнего плинтуса (молдинга) у неё нет.
 *
 * Спека 02 «Что видит пользователь» разводит эти два случая явно: «стены, совпадающие с ребром зоны,
 * укорачиваются до высоты зоны **и теряют верхний плинтус**; стены, целиком лежащие внутри зоны, — только
 * укорачиваются». Поэтому `underArea` — не «накрыта зоной», а именно «совпала с её ребром».
 */
export interface DerivedFace {
  readonly roomId: Id;
  readonly contourId: Id;
  readonly a: Id;
  readonly b: Id;
  readonly top: number;
  readonly underArea: boolean;
}

/**
 * Плинтус вдоль грани комнаты — осевой квад свипа (`points`, см. `plinthQuad`) и вид: `bottom` — плинтус у
 * пола, `top` — потолочный молдинг. На грань их два, а под ребром зоны верхний отсутствует (`underArea`).
 *
 * **Профиля здесь нет.** Спека 02 «Форма профиля» требует 16 встроенных форм (нормализованные полилинии +
 * дефолтные глубина/высота, у верхних — отступ до потолка), но нужны они только мешам (шаг 4), а полного
 * банка значений в наших доках нет. Производное отдаёт ось свипа и `kind`; профиль и его `elevation`
 * приходят шагом 4/7 и форму этой записи не меняют.
 *
 * **`gaps` заведён пустым.** Разрывы под проёмами — шаг 6 (спека 02 «Разрывы под проёмами»); поле есть
 * уже сейчас, чтобы их приход не менял форму производного. Пара — отрезок `[от, до]` в долях длины грани.
 */
export interface DerivedSkirting {
  readonly roomId: Id;
  readonly contourId: Id;
  readonly a: Id;
  readonly b: Id;
  readonly kind: 'bottom' | 'top';
  readonly points: PlinthQuad;
  readonly gaps: readonly (readonly [number, number])[];
}

/** Комната как источник граней: `inner`-контур (id и координаты по индексу) плюс высота её потолка. */
export interface FaceRoom {
  contourId: Id;
  roomId: Id;
  points: readonly Id[];
  positions: readonly PlanPosition[];
  ceilingHeight: number;
}

/** Зона как источник понижения: координаты её контура и высота, см. */
export interface FaceArea {
  points: readonly PlanPosition[];
  height: number;
}

export interface DerivedFacesInput {
  rooms: readonly FaceRoom[];
  /** Выжившие зоны в порядке `layout.areas` — при конфликте побеждает последняя (как у референса). */
  areas: readonly FaceArea[];
}

export interface DerivedFacesResult {
  faces: DerivedFace[];
  skirtings: DerivedSkirting[];
}

/** Общий пустой список разрывов: поле есть у каждого плинтуса, значение до шага 6 всегда одно. */
const EMPTY_GAPS: readonly (readonly [number, number])[] = [];

/**
 * Производные высоты граней комнат и плинтусы (задача 0070, ADR 0017 C9; спека 02 «Плинтусы», «Зоны»,
 * «Вертикальные грани зоны», «Что видит пользователь»).
 *
 * **Высоты — дословно по референсу** (`plannercore.js:61833–61864`, верифицировано): зоны обходятся по
 * порядку, и для каждой сначала помечаются грани, **совпавшие** с её рёбрами (`top = area.height`,
 * `underArea = true`), затем — грани, целиком лежащие **внутри** её контура (оба конца внутри либо один
 * внутри и один на границе): им ставится та же высота, но `underArea` не трогается, и верхний плинтус
 * остаётся. Грань, не задетая ни одной зоной, получает высоту своей комнаты.
 *
 * Расхождения с референсом, оба осознанные:
 *
 * - **высота по умолчанию — `Room.ceilingHeight`**, а не глобальный `cap.wallsHeight` (у референса
 *   `res.walls[i].height = WC.core.cap.wallsHeight`): спека 02 «Высота потолка» задаёт высоту на уровне
 *   комнаты, и она «влияет и на потолок, и на верхнюю границу стен внутри комнаты»;
 * - **совпадение грани с ребром зоны ищется наложением отрезков** (`edgeOnFace`, допуск
 *   `FACE_COLLINEAR_EPS`), а не тождеством объектов концов (`wallPairs[j][0].link` референса). Причина та
 *   же, что у `classifyAreaEdges`: у нас зона опёрта на точки комнат геометрически, «соседство по массиву»
 *   ломается на T-стыках и на общей стене двух комнат. Побочный эффект — грань, покрытую ребром зоны лишь
 *   частично (вершина чужого контура посреди грани), мы считаем совпавшей целиком; референс не считал бы
 *   её совпавшей вовсе, то есть оставлял бы молдинг висеть над крышкой зоны.
 *
 * **Грани только у комнат** (`inner`-контуров): у референса `createPlinths` обходит и обводы тел стен
 * (`roomsOuter`), но их граням плинтус тут же выключается — `if (DW.outer) { bottomPlinth.exists = false;
 * topPlinth.exists = false }` (`plannercore.js:61741`), — так что снаружи здания плинтуса нет и у него.
 *
 * **Сторона свипа — внутрь комнаты**, и берётся она из ориентации контура ровно так же, как `faceRight` в
 * `layoutFaces`: у `inner`-контура против часовой полость слева от `a → b` (`faceRight = true`), значит
 * плинтус уходит влево. Вырожденная грань (`|bc| < L_EPS`) гранью не считается — ни высоты, ни плинтусов
 * она не даёт; после `normalize` таких не бывает (обвод чищен `clearContour`).
 *
 * Чистая функция: вход не мутируется, точки квадов — свежие объекты.
 */
export const derivedFaces = ({ rooms, areas }: DerivedFacesInput): DerivedFacesResult => {
  const faces: DerivedFace[] = [];
  const skirtings: DerivedSkirting[] = [];
  const areaEdges = areas.map(area => contourFaces([area.points]));

  for (const room of rooms) {
    const n = room.positions.length;
    if (n < 3 || room.points.length !== n) continue;
    // Ориентация контура → сторона тела стены (`faceRight` у `layoutFaces`) → сторона свипа внутрь комнаты.
    const side: OffsetSide = contourArea(room.positions) > 0 ? 'left' : 'right';
    const entries = room.positions.map((b, index) => ({
      index,
      b,
      c: room.positions[(index + 1) % n]!,
      quad: plinthQuad({
        a: room.positions[(index + n - 1) % n]!,
        b,
        c: room.positions[(index + 1) % n]!,
        d: room.positions[(index + 2) % n]!,
        side,
      }),
      top: room.ceilingHeight,
      underArea: false,
    }));

    areas.forEach((area, areaIndex) => {
      const edges = areaEdges[areaIndex]!;
      const coincided = new Set<number>();
      for (const entry of entries) {
        if (entry.quad === null || !edgeOnFace(entry.b, entry.c, edges)) continue;
        entry.top = area.height;
        entry.underArea = true;
        coincided.add(entry.index);
      }
      for (const entry of entries) {
        if (entry.quad === null || coincided.has(entry.index)) continue;
        const from = locatePointInContour(entry.b, area.points);
        const to = locatePointInContour(entry.c, area.points);
        if (from === 'outside' || to === 'outside') continue;
        // «Целиком внутри»: оба конца внутри либо один внутри и один на границе (референс, 61860).
        if (from === 'boundary' && to === 'boundary') continue;
        entry.top = area.height;
      }
    });

    for (const entry of entries) {
      if (entry.quad === null) continue;
      const a = room.points[entry.index]!;
      const b = room.points[(entry.index + 1) % n]!;
      const ref = { roomId: room.roomId, contourId: room.contourId, a, b };
      faces.push({ ...ref, top: entry.top, underArea: entry.underArea });
      skirtings.push({ ...ref, kind: 'bottom', points: entry.quad, gaps: EMPTY_GAPS });
      if (!entry.underArea) skirtings.push({ ...ref, kind: 'top', points: entry.quad, gaps: EMPTY_GAPS });
    }
  }

  return { faces, skirtings };
};
