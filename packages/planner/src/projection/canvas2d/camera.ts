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

/**
 * Сколько CSS px кадра с каждой стороны закрыто **непрозрачными оверлеями скина** (рейл, панель инструментов,
 * полоса подсказок с группой контролов). Канвас лежит `inset: 0` во всю ширину контейнера, панели — оверлеи
 * поверх него (решение 13 брифа: каталог и панели холст не отодвигают), поэтому камера обязана знать про
 * закрытую часть: иначе `fitToContent` центрует план по всему кадру и часть геометрии уезжает под глухую
 * панель, откуда её не достать ни кликом, ни взглядом.
 *
 * Значения приходят **снаружи** — их сообщает сам скин (`ui/ConstructorSkin`, `setViewportInsets`): проекция
 * размеров панелей не знает и знать не должна (ADR 0015: `projection/` про React-скин ничего не знает).
 */
export interface ViewportInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Кадр без оверлеев — состояние до того, как скин сообщит свои размеры (и весь headless-режим). */
export const NO_INSETS: Readonly<ViewportInsets> = Object.freeze({ left: 0, right: 0, top: 0, bottom: 0 });

/** Видимая часть кадра: её размер и смещение её центра относительно центра кадра, CSS px. */
export interface SafeFrame {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Видимая часть кадра по insets. Если оверлеи «съели» кадр целиком (узкое окно, кривые значения снаружи) —
 * вырождаемся в полный кадр: лучше вписать план под панель, чем считать fit по отрицательному размеру.
 */
export const safeFrameOf = (size: CanvasSize, insets: ViewportInsets = NO_INSETS): SafeFrame => {
  const width = size.width - insets.left - insets.right;
  const height = size.height - insets.top - insets.bottom;
  if (width <= 0 || height <= 0) return { width: size.width, height: size.height, offsetX: 0, offsetY: 0 };
  return {
    width,
    height,
    offsetX: insets.left + width / 2 - size.width / 2,
    offsetY: insets.top + height / 2 - size.height / 2,
  };
};

/**
 * Камера, у которой точка плана `plan` попадает в центр **видимой** части кадра. При нулевых insets — ровно
 * `center = plan`, то есть поведение до введения insets.
 */
export const centeredCamera = (plan: PlanPosition, scaleIndex: number, safe: SafeFrame): ConstructorCameraState => {
  const scale = scaleAt(scaleIndex);
  return {
    scaleIndex,
    // Знаки — из `planToView`: экранный `x` растёт с планом, экранный `y` — против.
    center: { x: plan.x - safe.offsetX / scale, y: plan.y + safe.offsetY / scale },
  };
};

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
 *
 * Считается по **видимой** части кадра (`insets`), а не по всему канвасу: и масштаб, и центр. Иначе план
 * вписывается в кадр целиком, но его левая часть оказывается под рейлом и панелью инструментов.
 */
export const fitCamera = (
  bounds: Bounds | null,
  size: CanvasSize,
  insets: ViewportInsets = NO_INSETS,
): ConstructorCameraState => {
  if (size.width <= 0 || size.height <= 0) return { ...DEFAULT_CAMERA };
  const safe = safeFrameOf(size, insets);
  // Пустой этаж — вписывать нечего: базовый шаг и начало координат в центре видимой части.
  if (!bounds) return centeredCamera(DEFAULT_CAMERA.center, ZOOM_SCALE_BASE_INDEX, safe);
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const padding = Math.min(safe.width, safe.height) * FIT_PADDING_RATIO;
  const frameWidth = Math.max(1, safe.width - padding * 2);
  const frameHeight = Math.max(1, safe.height - padding * 2);
  const planWidth = bounds.maxX - bounds.minX;
  const planHeight = bounds.maxY - bounds.minY;
  // Единственная точка (или вырожденный по обеим осям план) — масштабировать нечего, берём базовый шаг.
  if (planWidth <= 0 && planHeight <= 0) return centeredCamera(center, ZOOM_SCALE_BASE_INDEX, safe);
  const fit = Math.min(
    planWidth > 0 ? frameWidth / planWidth : Number.POSITIVE_INFINITY,
    planHeight > 0 ? frameHeight / planHeight : Number.POSITIVE_INFINITY,
  );
  return centeredCamera(center, scaleIndexNotAbove(fit), safe);
};
