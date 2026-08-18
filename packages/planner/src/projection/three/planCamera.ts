import type { PlanCamera } from '../../document/PlannerDocument';

/** Размер вьюпорта в CSS-пикселях (контейнер канваса). */
export interface ViewportSize {
  width: number;
  height: number;
}

/** Границы ортофрустума вокруг центра камеры, см (`OrthographicCamera.left/right/top/bottom`). */
export interface OrthoFrustum {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Шкала зума 2D-плана: нормализованный `zoom ∈ [0, 1]` документа (спека 08/10) → видимая высота кадра, см,
 * по геометрической интерполяции между дальним и ближним пределами (равные шаги зума = равные множители
 * масштаба, как у дискретной шкалы спеки 08). Дефолтный `zoom = 0.5` даёт 10 м по вертикали — типовая
 * квартира в кадре. Пределы — временное решение шага 1; смысл шкалы (и 41-шаговую дискретизацию) фиксирует
 * ADR G, до него документ хранит только число.
 */
export const PLAN_VIEW_HEIGHT_FAR = 10_000;
export const PLAN_VIEW_HEIGHT_NEAR = 100;

export const planZoomToViewHeight = (zoom: number): number => {
  const clamped = Math.min(1, Math.max(0, zoom));
  return PLAN_VIEW_HEIGHT_FAR * (PLAN_VIEW_HEIGHT_NEAR / PLAN_VIEW_HEIGHT_FAR) ** clamped;
};

/**
 * Фрустум ортокамеры сверху для камеры вида `plan`: высота кадра — из зума, ширина — по aspect вьюпорта,
 * центр — `(0, 0)` (в мир камеру ставит проекция по `camera.x/y`). Вырожденный вьюпорт (нулевая/отрицательная
 * сторона) считается квадратным, чтобы фрустум оставался валидным до первого resize.
 */
export const computePlanFrustum = (camera: PlanCamera, viewport: ViewportSize): OrthoFrustum => {
  const halfHeight = planZoomToViewHeight(camera.zoom) / 2;
  const aspect = viewport.width > 0 && viewport.height > 0 ? viewport.width / viewport.height : 1;
  const halfWidth = halfHeight * aspect;
  return { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight };
};

/**
 * Высота ортокамеры плана над полом и её отсечение, см: камера смотрит строго вниз с 100 м, в кадр попадает
 * всё от 100 м над полом до 100 м под ним (ортопроекции глубина на масштаб не влияет).
 */
export const PLAN_CAMERA_ELEVATION = 10_000;
export const PLAN_CAMERA_NEAR = 1;
export const PLAN_CAMERA_FAR = 20_000;
