import type { Id } from '../../id';
import type { PlanPosition } from '../../PlannerDocument';
import { parallelLines } from '../predicates/angleBetweenLines';
import { euclDist } from '../predicates/distance';
import { orient2d } from '../predicates/orient2d';
import { L_EPS } from '../predicates/pointsMatch';
import { type OrientedFace, rightOriented } from '../predicates/rightOriented';
import { boxCenterSeg } from './boxCenterSeg';
import { parallelBox } from './parallelBox';

/** Ссылка на грань хранимого контура: контур и концы грани по id точек в порядке обхода контура. */
export interface FaceRef {
  contourId: Id;
  a: Id;
  b: Id;
}

/** Грань стены для поиска осей: геометрия + сторона тела (`faceRight`, см. `rightOriented`) + ссылка. */
export interface WallFace extends OrientedFace {
  ref: FaceRef;
}

/**
 * Ось стены (ADR 0017 C8) — производная, без id: `a → b` — центральный сегмент участка перекрытия пары граней,
 * `depth` — расстояние между гранями («текущая толщина» для инпута ширины, задача 0060), `faces` — пара
 * граней-источников. **Направление детерминировано:** `a` — конец с меньшим `x` (при равенстве — меньшим `y`);
 * `faces[0]` — грань слева от `a → b` (y вверх), `faces[1]` — справа (при почти совпадающих гранях, когда обе
 * середины на прямой оси, — сонаправленная оси). Угол оси — `atan2(b − a)`, один источник. `depth > 0`:
 * пары совпадающих граней (`< L_EPS`) осей не дают.
 */
export interface WallAxis {
  a: PlanPosition;
  b: PlanPosition;
  depth: number;
  faces: [FaceRef, FaceRef];
}

/**
 * Поиск осей O(n²) по парам граней (ADR 0017 C8, `findAxes` референса): `parallelLines(PARALLEL_EPS)` →
 * `rightOriented` (грани смотрят друг на друга) → `parallelBox` (участок перекрытия) → `boxCenterSeg`
 * (`MAX_WALL_WIDTH`/`MIN_WALL_LENGTH`). Ось на каждую пару по участку перекрытия, слияния нет (Q19): длинная
 * грань против двух коллинеарных коротких → две оси. Порядок — по парам `i < j` в порядке входа.
 */
export const findAxes = (faces: readonly WallFace[]): WallAxis[] => {
  const axes: WallAxis[] = [];
  for (let i = 0; i < faces.length - 1; i++) {
    const first = faces[i]!;
    for (let j = i + 1; j < faces.length; j++) {
      const second = faces[j]!;
      if (!parallelLines(first.a, first.b, second.a, second.b)) continue;
      if (!rightOriented(first, second)) continue;
      const box = parallelBox(first.a, first.b, second.a, second.b);
      if (!box) continue;
      const segment = boxCenterSeg(box);
      if (!segment) continue;
      const depth = euclDist(box[1], box[2]);
      // Совпадающие грани (общее ребро двух комнат по точкам) — стены между ними нет, оси тоже.
      if (depth < L_EPS) continue;
      axes.push(orientAxis(segment, depth, first, second));
    }
  }
  return axes;
};

/** Каноническое направление и порядок граней — контракт `WallAxis`. */
const orientAxis = (
  [p, q]: [PlanPosition, PlanPosition],
  depth: number,
  first: WallFace,
  second: WallFace,
): WallAxis => {
  const forward = p.x < q.x || (p.x === q.x && p.y <= q.y);
  const a = forward ? p : q;
  const b = forward ? q : p;
  const firstOnLeft = sideOf(a, b, first);
  const secondOnLeft = sideOf(a, b, second);
  let leftFirst: boolean;
  if (firstOnLeft !== secondOnLeft) {
    leftFirst = firstOnLeft;
  } else {
    // Обе середины на прямой оси (вырожденно тонкая стена): слева — сонаправленная оси.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    leftFirst = (first.b.x - first.a.x) * dx + (first.b.y - first.a.y) * dy > 0;
  }
  return { a, b, depth, faces: leftFirst ? [first.ref, second.ref] : [second.ref, first.ref] };
};

/** Середина грани слева от `a → b`. */
const sideOf = (a: PlanPosition, b: PlanPosition, face: OrientedFace): boolean =>
  orient2d(a, b, { x: (face.a.x + face.b.x) / 2, y: (face.a.y + face.b.y) / 2 }) > 0;
