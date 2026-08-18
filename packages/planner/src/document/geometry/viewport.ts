import type { PlanPosition } from '../PlannerDocument';
import type { Bounds } from './predicates/findMinMax';

/**
 * Видимая область конструктора — единый тип для `engine/` (`ToolState.viewport`), снапа/хит-теста, Canvas2D-проекции
 * и DOM-оверлея (ADR 0019 E1/E2, ADR 0020 P4). `scale` — CSS px на 1 см плана (база `1.0`: `SNAP_DIST = 10 px` = 10 см),
 * `center` — точка плана в центре канваса, `width`/`height` — CSS px канваса. Ось `y` плана направлена **вверх**
 * по экрану (как ортокамера Three, ADR 0020 P4). Единственный писатель — Canvas2D-проекция (`tools.setViewport`).
 * Предусловие: `scale > 0`, размеры конечны — валидирует команда фасада, чистые функции ниже не проверяют.
 */
export interface Viewport {
  scale: number;
  center: PlanPosition;
  width: number;
  height: number;
}

/** План → экран (CSS px канваса, `y` вниз): `x = (p.x − c.x)·s + w/2`, `y = h/2 − (p.y − c.y)·s`. */
export const planToView = (viewport: Viewport, point: PlanPosition): PlanPosition => ({
  x: (point.x - viewport.center.x) * viewport.scale + viewport.width / 2,
  y: viewport.height / 2 - (point.y - viewport.center.y) * viewport.scale,
});

/** Экран (CSS px канваса) → план; обратна `planToView`. */
export const viewToPlan = (viewport: Viewport, screen: PlanPosition): PlanPosition => ({
  x: (screen.x - viewport.width / 2) / viewport.scale + viewport.center.x,
  y: viewport.center.y - (screen.y - viewport.height / 2) / viewport.scale,
});

/** Экранная длина (CSS px) → длина плана (см): пороги `SNAP_DIST`/`POINT_SIZE`/`DRAG_THRESHOLD` делятся на `scale` (ADR 0019 E2). */
export const pixelsToPlan = (viewport: Viewport, pixels: number): number => pixels / viewport.scale;

/** bbox плана, видимый в канвасе, — для куллинга кандидатов снапа и хит-теста (ADR 0019 E2, спека 01 «Куллинг»). */
export const viewportBounds = (viewport: Viewport): Bounds => {
  const halfWidth = viewport.width / 2 / viewport.scale;
  const halfHeight = viewport.height / 2 / viewport.scale;
  return {
    minX: viewport.center.x - halfWidth,
    maxX: viewport.center.x + halfWidth,
    minY: viewport.center.y - halfHeight,
    maxY: viewport.center.y + halfHeight,
  };
};

/** Точка внутри bbox включительно (границы — видимы, как `pointInFrame` референса); `NaN` → `false`. */
export const boundsContain = (bounds: Bounds, point: PlanPosition): boolean =>
  point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
