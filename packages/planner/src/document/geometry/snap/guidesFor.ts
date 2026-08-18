import type { PlanPosition } from '../../PlannerDocument';
import { RE_MITER_ANGLE } from '../band/blocksFromContour';
import { angleBetweenLines } from '../predicates/angleBetweenLines';
import { manhDist } from '../predicates/distance';
import { offsetSegment, type OffsetSide } from '../predicates/offsetPoint';
import { B_EPS, pointOnSegment } from '../predicates/pointOnSegment';
import type { AlignerPair, Segment, SnapCandidate } from './candidates';
import type { SnapResult } from './getSnapPoint';
import type { Axis } from './snapAxis';

/** Гайд: пунктир от снап-точки к источнику; `face` — параллельный пунктир второй грани будущей стены (только при рисовании стен). */
export interface SnapGuide {
  kind: 'axis-x' | 'axis-y' | 'bisector';
  from: PlanPosition;
  to: PlanPosition;
  face: Segment | null;
}

/** Предпросмотр второй грани: толщина и сторона ленты текущего инструмента «Стены» (`blocksFromContour`). */
export interface GuideFace {
  width: number;
  side: OffsetSide;
}

export interface GuideContext {
  /** Последняя зафиксированная точка рисуемого контура (без живого курсора) — угловой фильтр; вне рисования — `null`. */
  lastPoint?: PlanPosition | null;
  /** Рёбра существующих контуров этажа — подавление «снап-точка лежит на стене» (T-стык). */
  segments?: readonly Segment[];
  /** Параллельный пунктир второй грани; `null`/нет — не рисуется (драг, прямоугольник, комната по точкам). */
  face?: GuideFace | null;
}

/**
 * Угловой фильтр расширенных гайдов, рад: гайд рисуется, только если поворот от последнего сегмента
 * (`lastPoint → snapped`) к направлению на выравниватель (`snapped → Q`) не резче 135° — та же константа,
 * что лимит митра (`RE_MITER_ANGLE`, спека 01 «Визуальные подсказки»).
 */
export const GUIDE_TURN_LIMIT = RE_MITER_ANGLE;

const isSharpTurn = (from: PlanPosition, via: PlanPosition, to: PlanPosition): boolean => {
  const angle = angleBetweenLines(from, via, via, to);
  return !(angle < GUIDE_TURN_LIMIT || angle > 2 * Math.PI - GUIDE_TURN_LIMIT);
};

/** Снап-точка лежит на оси выравнивателя (`x = Q.x` для вертикали) с допуском `B_EPS`. */
const onAxis = (snapped: PlanPosition, aligner: PlanPosition, axis: Axis): boolean =>
  Math.abs(snapped[axis] - aligner[axis]) < B_EPS;

const faceFor = (from: PlanPosition, to: PlanPosition, face: GuideFace | null | undefined): Segment | null => {
  if (!face) return null;
  const offset = offsetSegment(from, to, face.width, face.side);
  return offset && { a: offset[0], b: offset[1] };
};

/**
 * Что рисовать из `SnapResult` (спека 01 «Визуальные подсказки», ADR 0019 E2; правила — `StateMakingWalls.drawAligner`
 * референса, аудит dd09 keep). Рисует вьювер (ADR 0020), здесь — только геометрия в координатах плана.
 *
 * - **Основные гайды**: к `alignerX`, `alignerY`, `bisAnchor` — от снап-точки к источнику; нулевой длины (снап-точка
 *   совпала с источником в `B_EPS`) не рисуются; осевой гайд — только если снап-точка действительно лежит на оси
 *   источника (иначе — победил угол, а «выравниватель» — просто ближайшая по оси вершина: наклонный пунктир к ней
 *   у референса — визуальный шум, у нас подавлен).
 * - **Расширенные гайды** к «проигравшим» кандидатам сырых пар (`rawAlignersX/Y`, обе стороны одной оси) и
 *   параллельный пунктир второй грани (`face`) — только при рисовании (`lastPoint`), и подавляются целиком, если
 *   снап-точка совпала с любым из выравнивателей (`B_EPS`) или лежит на существующей стене (`segments`) — T-стык:
 *   остаётся только основной снап (спека 01); каждый — при повороте от последнего сегмента не резче
 *   `GUIDE_TURN_LIMIT` и если выравниватель не на одной оси с `lastPoint` (гайд лёг бы на сам сегмент).
 *   Основной осевой гайд, прошедший эти же фильтры, получает `face`; биссектриса `face` не имеет.
 * - `face` — `offsetSegment(snapped → источник, width, side)`: где легла бы вторая грань стены, продолженной вдоль гайда
 *   с текущей стороной ленты.
 */
export const guidesFor = (snap: SnapResult, context: GuideContext = {}): SnapGuide[] => {
  const { snapped, alignerX, alignerY, bisAnchor, rawAlignersX, rawAlignersY } = snap;
  const { lastPoint = null, segments = [], face = null } = context;
  const guides: SnapGuide[] = [];

  const rawAligners = [...rawAlignersX, ...rawAlignersY].filter((q): q is SnapCandidate => q !== null);
  const coincides = rawAligners.some(q => manhDist(q, snapped) < B_EPS);
  const onWall = !coincides && segments.some(({ a, b }) => pointOnSegment(snapped, a, b, B_EPS));
  const extrasEnabled = lastPoint !== null && !coincides && !onWall;

  const extraPasses = (aligner: SnapCandidate, axis: Axis): boolean =>
    extrasEnabled &&
    onAxis(snapped, aligner, axis) &&
    Math.abs(lastPoint![axis] - aligner[axis]) >= B_EPS &&
    !isSharpTurn(lastPoint!, snapped, aligner);

  const pushAxis = (primary: SnapCandidate | null, raw: AlignerPair, axis: Axis): void => {
    const kind = axis === 'x' ? 'axis-x' : 'axis-y';
    if (primary && onAxis(snapped, primary, axis) && manhDist(snapped, primary) >= B_EPS) {
      guides.push({
        kind,
        from: snapped,
        to: primary,
        face: extraPasses(primary, axis) ? faceFor(snapped, primary, face) : null,
      });
    }
    for (const loser of raw) {
      if (!loser || loser.id === primary?.id || !extraPasses(loser, axis)) continue;
      guides.push({ kind, from: snapped, to: loser, face: faceFor(snapped, loser, face) });
    }
  };

  pushAxis(alignerX, rawAlignersX, 'x');
  pushAxis(alignerY, rawAlignersY, 'y');
  if (bisAnchor && manhDist(snapped, bisAnchor) >= B_EPS) {
    guides.push({ kind: 'bisector', from: snapped, to: bisAnchor, face: null });
  }
  return guides;
};
