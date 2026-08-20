import type { Bounds } from '../../document/geometry/predicates/findMinMax';
import { viewToPlan, type Viewport } from '../../document/geometry/viewport';
import type { PlanPosition } from '../../document/PlannerDocument';

/**
 * Камера конструктора — **локальное состояние проекции** (ADR 0020 P3): `{ scaleIndex, center }`; в `Document.view`
 * её нет (`ViewCameras` — только `plan/orbit/walk`), не сохраняется и не переживает пересоздание планера.
 * `scale` — CSS px на 1 см плана, база `1.0` (тогда `SNAP_DIST = 10 px` = 10 см при базовом зуме).
 */

/** Число шагов дискретной шкалы зума (эталон холста: «шкала дискретная, 41 шаг, 1,0× = 100%»). */
export const ZOOM_SCALE_STEPS = 41;

/** Индекс базового шага: `1.0×` = 100% (ADR 0020 P3). */
export const ZOOM_SCALE_BASE_INDEX = 20;

/** Крайние значения шкалы (ADR 0020 P3, реверс конструктора roomtodo `scaleVaues`). */
export const ZOOM_SCALE_MIN = 0.05;
export const ZOOM_SCALE_MAX = 10.11;

/**
 * Дискретная шкала зума: 41 шаг, индекс 20 = `1.0×`, края `0.05×` и `10.11×` (ADR 0020 P3, эталон холста).
 *
 * Промежуточные значения таблицы roomtodo в наши документы не переносились, поэтому они **выведены**, а не
 * подобраны: две геометрические прогрессии между зафиксированными якорями (`0.05 → 1.0` на индексах 0..20 и
 * `1.0 → 10.11` на 20..40). Геометрический шаг даёт равномерное ощущение зума и «густую» шкалу у мелких
 * масштабов (спека 08: «При приближении шкала гуще»). Точная таблица 41 значения — открытый вопрос
 * (см. Заметки задачи 0056); её замена — правка одной этой константы.
 */
export const CONSTRUCTOR_ZOOM_SCALES: readonly number[] = Object.freeze(
  Array.from({ length: ZOOM_SCALE_STEPS }, (_, index) => {
    if (index === ZOOM_SCALE_BASE_INDEX) return 1;
    const [from, to, steps, offset] =
      index < ZOOM_SCALE_BASE_INDEX
        ? [ZOOM_SCALE_MIN, 1, ZOOM_SCALE_BASE_INDEX, index]
        : [1, ZOOM_SCALE_MAX, ZOOM_SCALE_STEPS - 1 - ZOOM_SCALE_BASE_INDEX, index - ZOOM_SCALE_BASE_INDEX];
    // Округление до 0.0001 — чтобы шкала была стабильной строкой в тестах и в индикаторе зума 0061.
    return Math.round(from * (to / from) ** (offset / steps) * 1e4) / 1e4;
  }),
);

/** Кламп индекса шкалы в границы таблицы (ADR 0020 P7: индексы 0/40 не выходят за края). */
export const clampScaleIndex = (index: number): number =>
  Math.min(ZOOM_SCALE_STEPS - 1, Math.max(0, Math.round(index)));

/** Масштаб по индексу шкалы, px/см. */
export const scaleAt = (index: number): number => CONSTRUCTOR_ZOOM_SCALES[clampScaleIndex(index)] as number;

/** Ближайший шаг шкалы, **не превышающий** запрошенный масштаб (для `fitToContent` — иначе план вылезет из кадра). */
export const scaleIndexNotAbove = (scale: number): number => {
  for (let index = ZOOM_SCALE_STEPS - 1; index > 0; index -= 1) {
    if ((CONSTRUCTOR_ZOOM_SCALES[index] as number) <= scale) return index;
  }
  return 0;
};

/** Состояние камеры конструктора. */
export interface ConstructorCameraState {
  scaleIndex: number;
  center: PlanPosition;
}

/** Дефолт (ADR 0020 P3): индекс 20 (`1.0×`), центр `(0, 0)`. */
export const DEFAULT_CAMERA: Readonly<ConstructorCameraState> = Object.freeze({
  scaleIndex: ZOOM_SCALE_BASE_INDEX,
  center: Object.freeze({ x: 0, y: 0 }),
});

/** Поле вокруг габаритов плана при `fitToContent`, доля меньшей стороны кадра. */
export const FIT_PADDING_RATIO = 0.08;

/** Размер кадра в CSS px. */
export interface CanvasSize {
  width: number;
  height: number;
}

/** Viewport из состояния камеры и размера кадра — единственный способ его собрать. */
export const viewportOf = (camera: ConstructorCameraState, size: CanvasSize): Viewport =>
  Object.freeze({
    scale: scaleAt(camera.scaleIndex),
    center: Object.freeze({ x: camera.center.x, y: camera.center.y }),
    width: size.width,
    height: size.height,
  });

/**
 * Шаг зума **вокруг курсора** (ADR 0020 P3): точка плана под курсором остаётся под ним. `delta` — шаг индекса
 * (`+1` — приблизить). `screen` — позиция курсора в CSS px канваса; `null` — зум вокруг центра кадра.
 * На краю шкалы возвращается та же камера (по ссылке) — вызывающий не порождает лишний `tools:changed`.
 */
export const zoomStep = (
  camera: ConstructorCameraState,
  size: CanvasSize,
  delta: number,
  screen: PlanPosition | null,
): ConstructorCameraState => {
  const scaleIndex = clampScaleIndex(camera.scaleIndex + delta);
  if (scaleIndex === camera.scaleIndex) return camera;
  if (!screen) return { scaleIndex, center: camera.center };

  const anchor = viewToPlan(viewportOf(camera, size), screen);
  const next = scaleAt(scaleIndex);
  // Центр сдвигается так, чтобы `planToView(anchor)` не изменился: сохраняем смещение курсора от центра в плане.
  return {
    scaleIndex,
    center: {
      x: anchor.x - (screen.x - size.width / 2) / next,
      y: anchor.y + (screen.y - size.height / 2) / next,
    },
  };
};

/** Пан на экранную дельту (CSS px): курсор тянет план за собой. */
export const panBy = (camera: ConstructorCameraState, dx: number, dy: number): ConstructorCameraState => {
  if (dx === 0 && dy === 0) return camera;
  const scale = scaleAt(camera.scaleIndex);
  return {
    scaleIndex: camera.scaleIndex,
    center: { x: camera.center.x - dx / scale, y: camera.center.y + dy / scale },
  };
};

/**
 * «В центр» (ADR 0020 P3): габариты всех точек этажа с полями → ближайший шаг шкалы, **не превышающий** fit;
 * пустой этаж или вырожденный кадр — дефолт.
 */
export const fitCamera = (bounds: Bounds | null, size: CanvasSize): ConstructorCameraState => {
  if (!bounds || size.width <= 0 || size.height <= 0) return { ...DEFAULT_CAMERA };
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const padding = Math.min(size.width, size.height) * FIT_PADDING_RATIO;
  const frameWidth = Math.max(1, size.width - padding * 2);
  const frameHeight = Math.max(1, size.height - padding * 2);
  const planWidth = bounds.maxX - bounds.minX;
  const planHeight = bounds.maxY - bounds.minY;
  // Единственная точка (или вырожденный по обеим осям план) — масштабировать нечего, берём базовый шаг.
  if (planWidth <= 0 && planHeight <= 0) return { scaleIndex: ZOOM_SCALE_BASE_INDEX, center };
  const fit = Math.min(
    planWidth > 0 ? frameWidth / planWidth : Number.POSITIVE_INFINITY,
    planHeight > 0 ? frameHeight / planHeight : Number.POSITIVE_INFINITY,
  );
  return { scaleIndex: scaleIndexNotAbove(fit), center };
};
