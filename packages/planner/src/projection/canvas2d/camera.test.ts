import type { Bounds } from '../../document/geometry/predicates/findMinMax';
import { planToView, viewToPlan, viewportBounds } from '../../document/geometry/viewport';
import type { PlanPosition } from '../../document/PlannerDocument';
import {
  CONSTRUCTOR_ZOOM_SCALES,
  DEFAULT_CAMERA,
  FIT_PADDING_RATIO,
  ZOOM_SCALE_BASE_INDEX,
  ZOOM_SCALE_MAX,
  ZOOM_SCALE_MIN,
  ZOOM_SCALE_STEPS,
  type CanvasSize,
  type ConstructorCameraState,
  clampScaleIndex,
  fitCamera,
  panBy,
  scaleAt,
  scaleIndexNotAbove,
  viewportOf,
  zoomStep,
} from './camera';

const LAST_INDEX = ZOOM_SCALE_STEPS - 1;

const camera = (scaleIndex: number, center: PlanPosition): ConstructorCameraState => ({ scaleIndex, center });

const size = (width: number, height: number): CanvasSize => ({ width, height });

const bounds = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({ minX, minY, maxX, maxY });

describe('camera — состояние проекции конструктора (ADR 0020 P3/P7)', () => {
  describe('CONSTRUCTOR_ZOOM_SCALES', () => {
    it('ровно ZOOM_SCALE_STEPS = 41 значение', () => {
      expect(ZOOM_SCALE_STEPS).toBe(41);
      expect(CONSTRUCTOR_ZOOM_SCALES).toHaveLength(41);
    });

    it('якоря шкалы: [0] = 0.05, [20] = 1.0 (100%), [40] = 10.11', () => {
      expect(CONSTRUCTOR_ZOOM_SCALES[0]).toBe(ZOOM_SCALE_MIN);
      expect(CONSTRUCTOR_ZOOM_SCALES[0]).toBe(0.05);
      expect(CONSTRUCTOR_ZOOM_SCALES[ZOOM_SCALE_BASE_INDEX]).toBe(1);
      expect(ZOOM_SCALE_BASE_INDEX).toBe(20);
      expect(CONSTRUCTOR_ZOOM_SCALES[LAST_INDEX]).toBe(ZOOM_SCALE_MAX);
      expect(CONSTRUCTOR_ZOOM_SCALES[LAST_INDEX]).toBe(10.11);
    });

    it('строго возрастает и вся конечна и положительна', () => {
      for (const [index, scale] of CONSTRUCTOR_ZOOM_SCALES.entries()) {
        expect(Number.isFinite(scale)).toBe(true);
        expect(scale).toBeGreaterThan(0);
        if (index > 0) expect(scale).toBeGreaterThan(CONSTRUCTOR_ZOOM_SCALES[index - 1] as number);
      }
    });

    it('таблица заморожена — правится только в исходнике', () => {
      expect(Object.isFrozen(CONSTRUCTOR_ZOOM_SCALES)).toBe(true);
    });
  });

  describe('clampScaleIndex / scaleAt', () => {
    it('внутри границ — тот же индекс', () => {
      expect(clampScaleIndex(0)).toBe(0);
      expect(clampScaleIndex(20)).toBe(20);
      expect(clampScaleIndex(LAST_INDEX)).toBe(LAST_INDEX);
    });

    it('обе стороны границ: −1 → 0, 41 → 40', () => {
      expect(clampScaleIndex(-1)).toBe(0);
      expect(clampScaleIndex(-1000)).toBe(0);
      expect(clampScaleIndex(ZOOM_SCALE_STEPS)).toBe(LAST_INDEX);
      expect(clampScaleIndex(1000)).toBe(LAST_INDEX);
    });

    it('дробный индекс округляется до ближайшего шага', () => {
      expect(clampScaleIndex(20.4)).toBe(20);
      expect(clampScaleIndex(20.5)).toBe(21);
      expect(clampScaleIndex(20.6)).toBe(21);
      expect(clampScaleIndex(-0.4)).toBe(0);
    });

    it('scaleAt — значение таблицы по клампнутому индексу', () => {
      expect(scaleAt(ZOOM_SCALE_BASE_INDEX)).toBe(1);
      expect(scaleAt(-1)).toBe(ZOOM_SCALE_MIN);
      expect(scaleAt(ZOOM_SCALE_STEPS)).toBe(ZOOM_SCALE_MAX);
      expect(scaleAt(20.4)).toBe(1);
      expect(scaleAt(13)).toBe(CONSTRUCTOR_ZOOM_SCALES[13]);
    });
  });

  describe('scaleIndexNotAbove', () => {
    it('никогда не превышает запрошенный масштаб', () => {
      for (const scale of [0.06, 0.3, 0.704, 1, 1.5, 4, 10, 10.11]) {
        expect(scaleAt(scaleIndexNotAbove(scale))).toBeLessThanOrEqual(scale);
      }
    });

    it('ниже минимума шкалы → 0 (мельче уже некуда)', () => {
      expect(scaleIndexNotAbove(0.01)).toBe(0);
      expect(scaleIndexNotAbove(ZOOM_SCALE_MIN)).toBe(0);
      expect(scaleIndexNotAbove(0)).toBe(0);
    });

    it('выше максимума шкалы → 40', () => {
      expect(scaleIndexNotAbove(100)).toBe(LAST_INDEX);
      expect(scaleIndexNotAbove(ZOOM_SCALE_MAX)).toBe(LAST_INDEX);
    });

    it('ровно на значении шкалы → этот индекс, а не соседний снизу', () => {
      for (const index of [1, 7, 20, 33, LAST_INDEX]) {
        expect(scaleIndexNotAbove(CONSTRUCTOR_ZOOM_SCALES[index] as number)).toBe(index);
      }
    });

    it('чуть ниже значения шкалы → предыдущий шаг', () => {
      const step = CONSTRUCTOR_ZOOM_SCALES[25] as number;
      expect(scaleIndexNotAbove(step - 1e-6)).toBe(24);
    });
  });

  describe('viewportOf', () => {
    it('собирает Viewport из камеры и размера кадра', () => {
      const viewport = viewportOf(camera(20, { x: 120, y: -40 }), size(800, 600));
      expect(viewport).toEqual({ scale: 1, center: { x: 120, y: -40 }, width: 800, height: 600 });
    });

    it('масштаб берётся из шкалы по индексу', () => {
      expect(viewportOf(camera(LAST_INDEX, { x: 0, y: 0 }), size(10, 10)).scale).toBe(ZOOM_SCALE_MAX);
      expect(viewportOf(camera(0, { x: 0, y: 0 }), size(10, 10)).scale).toBe(ZOOM_SCALE_MIN);
    });

    it('вьюпорт и его центр заморожены, центр — копия, а не ссылка на камеру', () => {
      const state = camera(20, { x: 1, y: 2 });
      const viewport = viewportOf(state, size(800, 600));
      expect(Object.isFrozen(viewport)).toBe(true);
      expect(Object.isFrozen(viewport.center)).toBe(true);
      expect(viewport.center).not.toBe(state.center);
      expect(viewport.center).toEqual(state.center);
    });
  });

  describe('zoomStep — зум вокруг курсора', () => {
    const frame = size(800, 600);

    it.each<[string, PlanPosition]>([
      ['центр кадра', { x: 400, y: 300 }],
      ['левый верхний угол', { x: 0, y: 0 }],
      ['правый нижний угол', { x: 800, y: 600 }],
      ['вне центра', { x: 137, y: 481 }],
    ])('точка плана под курсором (%s) остаётся под курсором при приближении', (_name, screen) => {
      const state = camera(20, { x: 250, y: -120 });
      const anchor = viewToPlan(viewportOf(state, frame), screen);
      const next = zoomStep(state, frame, 1, screen);
      const after = planToView(viewportOf(next, frame), anchor);
      expect(next.scaleIndex).toBe(21);
      expect(after.x).toBeCloseTo(screen.x, 6);
      expect(after.y).toBeCloseTo(screen.y, 6);
    });

    it.each<[string, PlanPosition]>([
      ['центр кадра', { x: 400, y: 300 }],
      ['левый верхний угол', { x: 0, y: 0 }],
      ['вне центра', { x: 137, y: 481 }],
    ])('точка плана под курсором (%s) остаётся под курсором при отдалении', (_name, screen) => {
      const state = camera(20, { x: 250, y: -120 });
      const anchor = viewToPlan(viewportOf(state, frame), screen);
      const next = zoomStep(state, frame, -1, screen);
      const after = planToView(viewportOf(next, frame), anchor);
      expect(next.scaleIndex).toBe(19);
      expect(after.x).toBeCloseTo(screen.x, 6);
      expect(after.y).toBeCloseTo(screen.y, 6);
    });

    it('якорь держится и на многошаговой дельте, и на дальних индексах шкалы', () => {
      const state = camera(6, { x: -900, y: 400 });
      const screen = { x: 90, y: 55 };
      const anchor = viewToPlan(viewportOf(state, frame), screen);
      const next = zoomStep(state, frame, 7, screen);
      const after = planToView(viewportOf(next, frame), anchor);
      expect(next.scaleIndex).toBe(13);
      expect(after.x).toBeCloseTo(screen.x, 6);
      expect(after.y).toBeCloseTo(screen.y, 6);
    });

    it('screen = null — зум вокруг центра кадра: центр камеры не меняется', () => {
      const state = camera(20, { x: 250, y: -120 });
      const next = zoomStep(state, frame, 1, null);
      expect(next.scaleIndex).toBe(21);
      expect(next.center).toBe(state.center);
    });

    it('курсор ровно в центре кадра эквивалентен screen = null', () => {
      const state = camera(20, { x: 250, y: -120 });
      const next = zoomStep(state, frame, 1, { x: 400, y: 300 });
      expect(next.center.x).toBeCloseTo(state.center.x, 9);
      expect(next.center.y).toBeCloseTo(state.center.y, 9);
    });

    it('на верхней границе шкалы возвращается та же камера по ссылке', () => {
      const state = camera(LAST_INDEX, { x: 10, y: 20 });
      expect(zoomStep(state, frame, 1, { x: 100, y: 100 })).toBe(state);
      expect(zoomStep(state, frame, 5, null)).toBe(state);
    });

    it('на нижней границе шкалы возвращается та же камера по ссылке', () => {
      const state = camera(0, { x: 10, y: 20 });
      expect(zoomStep(state, frame, -1, { x: 100, y: 100 })).toBe(state);
      expect(zoomStep(state, frame, -5, null)).toBe(state);
    });

    it('нулевая дельта — та же камера по ссылке', () => {
      const state = camera(20, { x: 10, y: 20 });
      expect(zoomStep(state, frame, 0, { x: 100, y: 100 })).toBe(state);
    });
  });

  describe('panBy', () => {
    it('нулевая дельта — та же камера по ссылке', () => {
      const state = camera(20, { x: 10, y: 20 });
      expect(panBy(state, 0, 0)).toBe(state);
    });

    it('тянем вправо — план едет вправо, центр по x уменьшается', () => {
      const next = panBy(camera(20, { x: 0, y: 0 }), 30, 0);
      expect(next.center.x).toBe(-30);
      expect(next.center.y).toBe(0);
    });

    it('тянем вниз — центр по y растёт (ось y плана вверх)', () => {
      const next = panBy(camera(20, { x: 0, y: 0 }), 0, 30);
      expect(next.center.y).toBe(30);
      expect(next.center.x).toBe(0);
    });

    it('величина делится на текущий scale: чем крупнее зум, тем меньше проезд плана', () => {
      const close = panBy(camera(LAST_INDEX, { x: 0, y: 0 }), 100, -50);
      expect(close.center.x).toBeCloseTo(-100 / ZOOM_SCALE_MAX, 9);
      expect(close.center.y).toBeCloseTo(-50 / ZOOM_SCALE_MAX, 9);
      const far = panBy(camera(0, { x: 0, y: 0 }), 100, -50);
      expect(far.center.x).toBeCloseTo(-100 / ZOOM_SCALE_MIN, 9);
      expect(far.center.y).toBeCloseTo(-50 / ZOOM_SCALE_MIN, 9);
    });

    it('индекс шкалы пан не трогает, исходная камера не мутируется', () => {
      const state = camera(17, { x: 5, y: 5 });
      const next = panBy(state, 10, 10);
      expect(next.scaleIndex).toBe(17);
      expect(state.center).toEqual({ x: 5, y: 5 });
    });

    it('экранная точка под курсором едет ровно на дельту курсора', () => {
      const frame = size(800, 600);
      const state = camera(24, { x: 100, y: 100 });
      const point = { x: 130, y: 160 };
      const before = planToView(viewportOf(state, frame), point);
      const after = planToView(viewportOf(panBy(state, 40, -25), frame), point);
      expect(after.x - before.x).toBeCloseTo(40, 6);
      expect(after.y - before.y).toBeCloseTo(-25, 6);
    });
  });

  describe('fitCamera — «в центр»', () => {
    const frame = size(800, 600);

    /** Честный fit: сколько px/см влезает в кадр с полями FIT_PADDING_RATIO. */
    const honestFit = (box: Bounds, canvas: CanvasSize): number => {
      const padding = Math.min(canvas.width, canvas.height) * FIT_PADDING_RATIO;
      const frameWidth = Math.max(1, canvas.width - padding * 2);
      const frameHeight = Math.max(1, canvas.height - padding * 2);
      const planWidth = box.maxX - box.minX;
      const planHeight = box.maxY - box.minY;
      return Math.min(
        planWidth > 0 ? frameWidth / planWidth : Number.POSITIVE_INFINITY,
        planHeight > 0 ? frameHeight / planHeight : Number.POSITIVE_INFINITY,
      );
    };

    it('центр камеры — центр габаритов', () => {
      expect(fitCamera(bounds(-500, -200, 500, 200), frame).center).toEqual({ x: 0, y: 0 });
      expect(fitCamera(bounds(100, 200, 300, 600), frame).center).toEqual({ x: 200, y: 400 });
    });

    it('выбранный шаг шкалы не превышает честный fit с полями', () => {
      const box = bounds(-500, -200, 500, 200);
      const fitted = fitCamera(box, frame);
      expect(scaleAt(fitted.scaleIndex)).toBeLessThanOrEqual(honestFit(box, frame));
      expect(CONSTRUCTOR_ZOOM_SCALES).toContain(scaleAt(fitted.scaleIndex));
    });

    it('план целиком влезает в кадр при получившемся viewport', () => {
      for (const box of [
        bounds(-500, -200, 500, 200),
        bounds(0, 0, 12_000, 9_000),
        bounds(-30, -30, 30, 30),
        bounds(1000, -4000, 1100, 4000),
      ]) {
        const fitted = fitCamera(box, frame);
        const visible = viewportBounds(viewportOf(fitted, frame));
        expect(visible.minX).toBeLessThanOrEqual(box.minX);
        expect(visible.maxX).toBeGreaterThanOrEqual(box.maxX);
        expect(visible.minY).toBeLessThanOrEqual(box.minY);
        expect(visible.maxY).toBeGreaterThanOrEqual(box.maxY);
      }
    });

    it('поля FIT_PADDING_RATIO соблюдены: план не касается краёв кадра', () => {
      const box = bounds(-500, -200, 500, 200);
      const fitted = fitCamera(box, frame);
      const padding = Math.min(frame.width, frame.height) * FIT_PADDING_RATIO;
      const viewport = viewportOf(fitted, frame);
      const left = planToView(viewport, { x: box.minX, y: box.maxY });
      const right = planToView(viewport, { x: box.maxX, y: box.minY });
      expect(left.x).toBeGreaterThanOrEqual(padding);
      expect(left.y).toBeGreaterThanOrEqual(padding);
      expect(right.x).toBeLessThanOrEqual(frame.width - padding);
      expect(right.y).toBeLessThanOrEqual(frame.height - padding);
    });

    it('bounds = null (пустой этаж) → дефолтная камера', () => {
      expect(fitCamera(null, frame)).toEqual(DEFAULT_CAMERA);
      expect(fitCamera(null, frame)).toEqual({ scaleIndex: ZOOM_SCALE_BASE_INDEX, center: { x: 0, y: 0 } });
    });

    it.each<[string, CanvasSize]>([
      ['нулевая ширина', size(0, 600)],
      ['нулевая высота', size(800, 0)],
      ['отрицательный кадр', size(-10, -10)],
    ])('вырожденный размер кадра (%s) → дефолтная камера', (_name, canvas) => {
      expect(fitCamera(bounds(-500, -200, 500, 200), canvas)).toEqual(DEFAULT_CAMERA);
    });

    it('единственная точка (нулевой bbox) → базовый шаг шкалы и центр в этой точке', () => {
      const fitted = fitCamera(bounds(370, -80, 370, -80), frame);
      expect(fitted).toEqual({ scaleIndex: ZOOM_SCALE_BASE_INDEX, center: { x: 370, y: -80 } });
    });

    it('bbox вырожден по y — масштаб считается по x', () => {
      const box = bounds(-500, 0, 500, 0);
      const fitted = fitCamera(box, frame);
      expect(fitted.scaleIndex).toBe(scaleIndexNotAbove(honestFit(box, frame)));
      expect(scaleAt(fitted.scaleIndex) * (box.maxX - box.minX)).toBeLessThanOrEqual(frame.width);
    });

    it('bbox вырожден по x — масштаб считается по y', () => {
      const box = bounds(0, -400, 0, 400);
      const fitted = fitCamera(box, frame);
      expect(fitted.scaleIndex).toBe(scaleIndexNotAbove(honestFit(box, frame)));
      expect(scaleAt(fitted.scaleIndex) * (box.maxY - box.minY)).toBeLessThanOrEqual(frame.height);
    });

    it('крошечный план не приближается сверх максимума шкалы', () => {
      expect(fitCamera(bounds(-0.5, -0.5, 0.5, 0.5), frame).scaleIndex).toBe(LAST_INDEX);
    });

    it('гигантский план не отдаляется ниже минимума шкалы', () => {
      expect(fitCamera(bounds(-1e7, -1e7, 1e7, 1e7), frame).scaleIndex).toBe(0);
    });
  });
});
