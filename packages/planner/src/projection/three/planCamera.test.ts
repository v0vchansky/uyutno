import {
  computePlanFrustum,
  PLAN_CAMERA_ELEVATION,
  PLAN_CAMERA_FAR,
  PLAN_CAMERA_NEAR,
  PLAN_VIEW_HEIGHT_FAR,
  PLAN_VIEW_HEIGHT_NEAR,
  planZoomToViewHeight,
} from './planCamera';

describe('planZoomToViewHeight — шкала зума 2D-плана', () => {
  it('zoom 0 — дальний предел, zoom 1 — ближний', () => {
    expect(planZoomToViewHeight(0)).toBe(PLAN_VIEW_HEIGHT_FAR);
    expect(planZoomToViewHeight(1)).toBeCloseTo(PLAN_VIEW_HEIGHT_NEAR, 9);
  });

  it('дефолтный zoom 0.5 — среднее геометрическое пределов (10 м)', () => {
    expect(planZoomToViewHeight(0.5)).toBeCloseTo(Math.sqrt(PLAN_VIEW_HEIGHT_FAR * PLAN_VIEW_HEIGHT_NEAR), 9);
    expect(planZoomToViewHeight(0.5)).toBeCloseTo(1000, 9);
  });

  it('монотонно убывает с ростом зума (больше zoom — ближе)', () => {
    let previous = planZoomToViewHeight(0);
    for (let zoom = 0.1; zoom <= 1; zoom += 0.1) {
      const height = planZoomToViewHeight(zoom);
      expect(height).toBeLessThan(previous);
      previous = height;
    }
  });

  it('равные шаги зума дают равные множители масштаба (геометрическая шкала)', () => {
    const ratioA = planZoomToViewHeight(0.2) / planZoomToViewHeight(0.3);
    const ratioB = planZoomToViewHeight(0.7) / planZoomToViewHeight(0.8);
    expect(ratioA).toBeCloseTo(ratioB, 9);
  });

  it('значения вне [0, 1] клампятся к пределам', () => {
    expect(planZoomToViewHeight(-1)).toBe(PLAN_VIEW_HEIGHT_FAR);
    expect(planZoomToViewHeight(2)).toBeCloseTo(PLAN_VIEW_HEIGHT_NEAR, 9);
  });

  it('NaN не клампится и даёт NaN (валидация зума — на границе команд)', () => {
    expect(Number.isNaN(planZoomToViewHeight(NaN))).toBe(true);
  });
});

describe('computePlanFrustum — ортофрустум из камеры вида plan и вьюпорта', () => {
  const camera = { x: 100, y: 200, zoom: 0.5 };

  it('высота кадра — из зума, ширина — по aspect; фрустум симметричен вокруг нуля', () => {
    const frustum = computePlanFrustum(camera, { width: 1600, height: 800 });
    expect(frustum.top).toBeCloseTo(500, 9);
    expect(frustum.bottom).toBeCloseTo(-500, 9);
    expect(frustum.right).toBeCloseTo(1000, 9);
    expect(frustum.left).toBeCloseTo(-1000, 9);
  });

  it('портретный вьюпорт сужает ширину, высота кадра не меняется', () => {
    const frustum = computePlanFrustum(camera, { width: 400, height: 800 });
    expect(frustum.top).toBeCloseTo(500, 9);
    expect(frustum.right).toBeCloseTo(250, 9);
  });

  it('центр камеры (x, y) на фрустум не влияет — его применяет позиция камеры', () => {
    const a = computePlanFrustum({ x: 0, y: 0, zoom: 0.5 }, { width: 800, height: 600 });
    const b = computePlanFrustum({ x: 5000, y: -5000, zoom: 0.5 }, { width: 800, height: 600 });
    expect(a).toEqual(b);
  });

  it('вырожденный вьюпорт (0×0, нулевая высота, отрицательный размер) считается квадратным', () => {
    const square = computePlanFrustum(camera, { width: 700, height: 700 });
    expect(computePlanFrustum(camera, { width: 0, height: 0 })).toEqual(square);
    expect(computePlanFrustum(camera, { width: 800, height: 0 })).toEqual(square);
    expect(computePlanFrustum(camera, { width: -1, height: 600 })).toEqual(square);
  });

  it('zoom NaN даёт NaN-фрустум — не маскируется (валидация зума — на границе команд)', () => {
    const frustum = computePlanFrustum({ x: 0, y: 0, zoom: NaN }, { width: 800, height: 600 });
    expect(Number.isNaN(frustum.top)).toBe(true);
  });

  it('дробные CSS-размеры (ResizeObserver) допустимы', () => {
    const frustum = computePlanFrustum(camera, { width: 1000.5, height: 500.25 });
    expect(frustum.right / frustum.top).toBeCloseTo(1000.5 / 500.25, 9);
  });

  it('константы глубины ортокамеры: камера выше far/2, near > 0, far покрывает пол и ниже', () => {
    expect(PLAN_CAMERA_NEAR).toBeGreaterThan(0);
    expect(PLAN_CAMERA_FAR).toBeGreaterThan(PLAN_CAMERA_ELEVATION);
  });
});
