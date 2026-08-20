import type { PlanPosition } from '../../PlannerDocument';
import { contourArea } from '../predicates/contourArea';
import { type Viewport, planToView } from '../viewport';

/**
 * Геометрия DOM-оверлея размеров (ADR 0015 «слой ui», ADR 0020 P4 — экран ↔ план живёт во вьюпорте):
 * где и под каким углом висит подпись длины ребра и когда она вообще показывается.
 * Продуктовые правила — спека 07 «Автоматические размеры на стенах» / «Ограничения и пороги»,
 * пороги инпутов при рисовании — спека 01 «Ввод длины». Слой `document/`: только числа, ни DOM, ни React.
 */

/** Порог показа автоматической подписи длины, CSS px (спека 07 «Ограничения и пороги»). */
export const LABEL_MIN_SCREEN_LENGTH = 30;
/** Запас, который подпись обязана оставить внутри сегмента (спека 07: текст + 30 px не влезает — не рисуется). */
export const LABEL_TEXT_MARGIN = 30;
/** Порог показа поля ввода при рисовании ломаной/комнаты, CSS px (спека 01/07). */
export const INPUT_MIN_SCREEN_LENGTH = 45;
/** Порог показа полей ввода прямоугольника, CSS px (спека 01/07). */
export const RECT_INPUT_MIN_SCREEN_LENGTH = 70;
/**
 * Перпендикулярный отступ подписи от ребра, CSS px. Значение handoff'ом не задано (`planner-editor-ui.md`
 * говорит только «сдвинута перпендикулярно наружу») — взято как половина высоты поля 26 px плюс 3 px зазора,
 * округлённая до шкалы 4. Дыра вынесена в Заметки задачи 0060.
 */
export const LABEL_OFFSET = 16;

export interface EdgePlacement {
  /** Центр подписи, CSS px контейнера планера. */
  x: number;
  y: number;
  /** Поворот подписи, градусы (CSS `rotate`); нормализован в `[−90, 90)` — текст никогда не вверх ногами. */
  angle: number;
  /** Экранная длина ребра, CSS px. */
  screenLength: number;
  /** Центр ребра ушёл за рамку холста — подпись подтянута к видимому участку (спека 07 «Крайние случаи»). */
  clamped: boolean;
}

/** Ориентация кольца контура по знаку площади: `1` — против часовой (площадь > 0, y вверх), `-1` — по часовой. */
export const ringOrientation = (points: readonly PlanPosition[]): 1 | -1 => (contourArea(points) < 0 ? -1 : 1);

/**
 * Параметрическое окно `[t0, t1] ⊆ [0, 1]` видимого участка отрезка `A + t·d` внутри прямоугольника
 * `[0, width] × [0, height]` — отсечение Лианга — Барски. `null` — отрезок целиком за рамкой.
 */
const clipToCanvas = (
  ax: number,
  ay: number,
  dx: number,
  dy: number,
  width: number,
  height: number,
): [number, number] | null => {
  const p = [-dx, dx, -dy, dy];
  const q = [ax, width - ax, ay, height - ay];
  let t0 = 0;
  let t1 = 1;

  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (pi === 0) {
      // Отрезок параллелен границе: либо целиком по нужную сторону, либо видимого участка нет вовсе.
      if (qi < 0) return null;
      continue;
    }
    const r = qi / pi;
    if (pi < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }

  return [t0, t1];
};

/** Угол в `[−90, 90)`: подпись под наклоном ребра, но никогда не вверх ногами (спека 07 «авторазворот»). */
const normalizeLabelAngle = (degrees: number): number => {
  let angle = degrees;
  while (angle >= 90) angle -= 180;
  while (angle < -90) angle += 180;
  return angle;
};

/**
 * Позиция и поворот подписи длины ребра `a → b` (спека 07 «Автоматические размеры на стенах»): середина
 * сегмента на экране, сдвиг перпендикулярно **наружу своего кольца** на `offset` CSS px, поворот по углу ребра
 * с авторазворотом. `orientation` — ориентация кольца-владельца (`ringOrientation`): внутренность кольца слева
 * от `a → b` при CCW, поэтому «наружу» = правая нормаль, умноженная на `orientation`.
 */
export const placeEdgeLabel = (
  viewport: Viewport,
  a: PlanPosition,
  b: PlanPosition,
  orientation: 1 | -1,
  offset: number = LABEL_OFFSET,
): EdgePlacement => {
  const A = planToView(viewport, a);
  const B = planToView(viewport, b);
  const sdx = B.x - A.x;
  const sdy = B.y - A.y;
  const screenLength = Math.hypot(sdx, sdy);

  const midX = A.x + sdx / 2;
  const midY = A.y + sdy / 2;

  // 1. Точка привязки: середина ребра, а если она за рамкой — середина видимого участка (спека 07 «Крайние случаи»).
  let anchorX = midX;
  let anchorY = midY;
  let clamped = false;
  const midInside = midX >= 0 && midX <= viewport.width && midY >= 0 && midY <= viewport.height;
  if (screenLength > 0 && !midInside) {
    const visible = clipToCanvas(A.x, A.y, sdx, sdy, viewport.width, viewport.height);
    if (visible) {
      const t = (visible[0] + visible[1]) / 2;
      anchorX = A.x + sdx * t;
      anchorY = A.y + sdy * t;
      clamped = true;
    }
  }

  // 2. Поворот: угол ребра на экране с авторазворотом; вертикаль даёт −90 (прототип handoff'а, сцена 14).
  const angle = screenLength > 0 ? normalizeLabelAngle((Math.atan2(sdy, sdx) * 180) / Math.PI) : 0;

  // 3. Сдвиг наружу: правая нормаль к `a → b` в плане — (dy, −dx)/|d|; ось y плана вверх, экранная вниз (ADR 0020 P4).
  const pdx = b.x - a.x;
  const pdy = b.y - a.y;
  const planLength = Math.hypot(pdx, pdy);
  if (planLength > 0) {
    const nx = (pdy / planLength) * orientation;
    const ny = (-pdx / planLength) * orientation;
    anchorX += nx * offset;
    anchorY += -ny * offset;
  }

  return { x: anchorX, y: anchorY, angle, screenLength, clamped };
};

/** Влезает ли подпись шириной `textWidth` CSS px в экранную длину сегмента с запасом `LABEL_TEXT_MARGIN`. */
export const labelFits = (screenLength: number, textWidth: number): boolean =>
  textWidth + LABEL_TEXT_MARGIN <= screenLength;
