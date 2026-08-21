import type { PlanPosition } from '../../PlannerDocument';
import { CLEAR_CONTOUR_MIN_LEN } from '../contours/clearContour';
import { euclDist } from '../predicates/distance';
import { pixelsToPlan, type Viewport } from '../viewport';

/**
 * Ручка деления грани (спека 01 «Ручка деления грани», ADR 0019 E4, задача 0096) — четвёртый, **вложенный**
 * уровень хит-теста конструктора: он проверяется только внутри грани, уже выигравшей `hitTest`, и цель наведения
 * не меняет. Позиция ручки — строго середина грани, за курсором вдоль неё ручка не едет; **вершина рождается в
 * позиции курсора**, спроецированной на саму грань (`splitPositionOn`).
 *
 * Порога показа по длине грани и по зуму нет (реверс: единственное условие отрисовки — непустая грань), кроме
 * одного геометрического: на грани короче `2 × CLEAR_CONTOUR_MIN_LEN` законной позиции для новой вершины не
 * существует вовсе — `clearContour` схлопнул бы её обратно на том же прогоне `normalize`, и жест «не сработал бы»
 * без всякой ошибки.
 */

/** Радиус диска захвата ручки, **CSS px** (верифицировано по исходнику: `CENTER_SIZE = 4`). Метрика — евклид. */
export const FACE_HANDLE_SIZE = 4;

/** Минимальная длина грани, на которой ручка показывается, см: два порога чистки контура. */
export const FACE_HANDLE_MIN_LEN = 2 * CLEAR_CONTOUR_MIN_LEN;

/** Середина грани — позиция ручки. Симметрична порядку концов. */
export const faceMidpoint = (a: PlanPosition, b: PlanPosition): PlanPosition => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

/** Есть ли на грани ручка: только длина решает, зум и подписи — нет. */
export const faceHandleAvailable = (a: PlanPosition, b: PlanPosition): boolean => euclDist(a, b) >= FACE_HANDLE_MIN_LEN;

/**
 * Курсор в диске захвата ручки: евклидово расстояние до середины грани ≤ `FACE_HANDLE_SIZE/scale`
 * (порог фиксирован в экранных px, как `POINT_SIZE`/`SNAP_DIST`, ADR 0019 E2). На грани без ручки — `false`.
 */
export const onFaceHandle = (point: PlanPosition, a: PlanPosition, b: PlanPosition, viewport: Viewport): boolean => {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  if (!faceHandleAvailable(a, b)) return false;
  return euclDist(point, faceMidpoint(a, b)) <= pixelsToPlan(viewport, FACE_HANDLE_SIZE);
};

/**
 * Позиция рождения вершины: проекция курсора на **саму грань** (вдоль грани — там же, где курсор; поперечный
 * промах до 5 px снимается), поджатая к отрезку `[CLEAR_CONTOUR_MIN_LEN, len − CLEAR_CONTOUR_MIN_LEN]`.
 *
 * Проекция, а не сырой курсор, — не вкусовщина: `normalize` режет ребро соседнего контура только реальным
 * пересечением/осевым перекрытием (`resplitSegments`/`clean-pslg`), и вершина «рядом с линией» разреза бы не
 * дала. Тот же приём уже применяется при драге точки на стену (`dropPosition`).
 *
 * `null` — грани без ручки (короче двух порогов, в том числе вырожденной): законной позиции на ней нет.
 */
export const splitPositionOn = (point: PlanPosition, a: PlanPosition, b: PlanPosition): PlanPosition | null => {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  if (!faceHandleAvailable(a, b)) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  // Длина вдоль грани от `a`, а не параметр `t`: на осевых гранях умножение на единичный вектор точное.
  const along = ((point.x - a.x) * dx + (point.y - a.y) * dy) / length;
  const clamped = Math.min(Math.max(along, CLEAR_CONTOUR_MIN_LEN), length - CLEAR_CONTOUR_MIN_LEN);
  return { x: a.x + (dx / length) * clamped, y: a.y + (dy / length) * clamped };
};
