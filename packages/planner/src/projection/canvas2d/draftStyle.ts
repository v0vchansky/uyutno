/**
 * Чертёжные константы конструктора — **единственное место** правки внешнего вида холста (ADR 0020 P2:
 * «стили … константы в одном месте по макету, не в ADR»).
 *
 * Источник всех чисел — нормативная таблица «состояние → атрибуты» эталона холста
 * `docs/ui/handoffs/planner/planner-canvas-reference.md`; там же курсоры и правило «что фиксировано в экранных
 * px, а что масштабируется вместе с планом». Числа, которых в таблице нет, но которые однозначно читаются со
 * сцен прототипа `Planner P0 Constructor.dc.html` (группа e8), помечены `// прототип, сцена N`.
 *
 * Цвета не хардкодятся: восемь токенов `--draft-*` живут в `apps/platform/src/client/theme-uyutno.css`
 * и читаются с холста через `getComputedStyle` (`readDraftPalette`). `DRAFT_PALETTE_FALLBACK` — те же
 * значения из эталона, нужен для headless-тестов и для случая, когда тема ещё не подключена.
 */

/** Цвета чертежа: значения — таблица «Новые токены» эталона холста. */
export interface DraftPalette {
  /** `--draft-canvas` — фон холста конструктора. */
  canvas: string;
  /** `--draft-wall-body` — тело стены (заливка между сторонами). */
  wallBody: string;
  /** `--draft-contour-line` — сторона контура. */
  contourLine: string;
  /** `--draft-room-fill` — заливка комнаты. */
  roomFill: string;
  /** `--draft-room-hatch` — штриховка комнаты. */
  roomHatch: string;
  /** `--draft-point` — обводка хендла точки. */
  point: string;
  /** `--draft-furniture-muted` — силуэты мебели в конструкторе (шаг 5+). */
  furnitureMuted: string;
  /** `--draft-guide` (= `--accent`) — гайд снапа, крестик, превью ленты; им же красится выделение. */
  guide: string;
}

/**
 * Значения токенов из эталона холста. Отдельного цвета выделения нет: выделение — тот же `--accent`,
 * что и гайд, разводятся они формой и весом (решение 4).
 */
export const DRAFT_PALETTE_FALLBACK: Readonly<DraftPalette> = Object.freeze({
  canvas: '#FFFFFF',
  wallBody: '#DEDEDE',
  contourLine: '#949494',
  roomFill: '#FCFCFC',
  roomHatch: '#F0F0F0',
  point: '#767676',
  furnitureMuted: '#EDEDED',
  guide: '#D65400', // = --accent = oklch(61% 0.18 44)
});

const TOKENS: Readonly<Record<keyof DraftPalette, string>> = Object.freeze({
  canvas: '--draft-canvas',
  wallBody: '--draft-wall-body',
  contourLine: '--draft-contour-line',
  roomFill: '--draft-room-fill',
  roomHatch: '--draft-room-hatch',
  point: '--draft-point',
  furnitureMuted: '--draft-furniture-muted',
  guide: '--draft-guide',
});

/**
 * Палитра из CSS-переменных элемента (обычно — самого канваса): токен пустой или среда без `getComputedStyle`
 * (jsdom, node) → значение из `DRAFT_PALETTE_FALLBACK`. Читается один раз при подъёме проекции и на `resize`
 * — тема статична (тёмной темы нет, решение 21).
 */
export const readDraftPalette = (element: Element | null): DraftPalette => {
  const view = element?.ownerDocument?.defaultView;
  if (!element || !view?.getComputedStyle) return { ...DRAFT_PALETTE_FALLBACK };
  const style = view.getComputedStyle(element);
  const entries = Object.entries(TOKENS) as [keyof DraftPalette, string][];
  const palette = { ...DRAFT_PALETTE_FALLBACK };
  for (const [key, token] of entries) {
    const value = style.getPropertyValue(token).trim();
    if (value !== '') palette[key] = value;
  }
  return palette;
};

/**
 * Метрики чертежа. Всё в **CSS-пикселях экрана** и не масштабируется зумом, кроме полей блока `plan`
 * (эталон, «Поведение при зуме»: фиксированы хендлы, крестик, толщина линий сторон и гайдов; масштабируются
 * тела стен, заливка и штриховка комнат, шаг штриховки, силуэты мебели).
 */
export const DRAFT_METRICS = Object.freeze({
  /** Величины в единицах плана (см) при `1,0×` — рисуются в мировых координатах и едут с планом. */
  plan: Object.freeze({
    /**
     * Шаг штриховки комнаты по нормали к линиям, px при `1,0×` → см плана (эталон: «шаг 8px, наклон 45°»).
     * Сам наклон 45° зашит направлением линий в `drawFrame.drawHatch` и отдельной константой не дублируется.
     */
    hatchStep: 8,
  }),

  /** Комната. */
  room: Object.freeze({
    /** Толщина линии штриховки, CSS px (в таблице не разведена по спискам «фиксировано/масштабируется» — см. Заметки 0056). */
    hatchWidth: 1,
    /** Заливка `--accent` 6% поверх штриховки. */
    hoverAlpha: 0.06,
    /** Заливка `--accent` 10%. */
    selectedAlpha: 0.1,
    /** Контур кольца выделенной комнаты, CSS px. */
    selectedRingWidth: 1,
  }),

  /** Сторона контура и её состояния. */
  face: Object.freeze({
    /** Линия 1.4px `--draft-contour-line`, стыки без скругления. */
    width: 1.4,
    /** Под наведением — 2px `--accent`. */
    hoverWidth: 2,
    /** Выделенная — 2.6px `--accent` сплошная. */
    selectedWidth: 2.6,
  }),

  /** Хендл точки: шесть состояний таблицы эталона, все — фиксированный экранный размер. */
  handle: Object.freeze({
    /** Покой: кружок r 4.2px, заливка `--draft-canvas`, обводка 1.4px `--draft-point`. */
    radius: 4.2,
    strokeWidth: 1.4,
    /** Наведение: тот же кружок, обводка 1.6px `--accent`, ореол r 6.6px `--accent` 14%. */
    hoverStrokeWidth: 1.6,
    hoverHaloRadius: 6.6,
    hoverHaloAlpha: 0.14,
    /** Выделен: залитый `--accent` кружок r 5.8px с белым ядром r 3px. */
    selectedRadius: 5.8,
    selectedCoreRadius: 3,
    /** Перетаскивается: залитый `--accent` r 4.2px, ореол r 7.2px `--accent` 10%. */
    draggingHaloRadius: 7.2,
    draggingHaloAlpha: 0.1,
    /** Цель «замкнуть контур»: залитый `--accent` r 4.2px в кольце 1.3px `--accent` r 7.6px (решение 2). */
    closeRingRadius: 7.6,
    closeRingWidth: 1.3,
    /** Цель «завершить открытую стену»: пустой кружок с обводкой 1.8px в квадратной рамке 1.3px, радиус 2px. */
    finishStrokeWidth: 1.8,
    finishFrameWidth: 1.3,
    finishFrameRadius: 2,
    /** Сторона квадратной рамки, CSS px — прототип, сцена 3b (`rect` 14.4×14.4). */
    finishFrameSize: 14.4,
  }),

  /** Превью рисования. */
  preview: Object.freeze({
    /** Превью ленты: заливка `--accent` 12%. */
    bandAlpha: 0.12,
    /** Вторая грань превью — пунктир 3/3 `--draft-contour-line`; толщина 1px — прототип, сцена 2. */
    bandFaceWidth: 1,
    bandFaceDash: Object.freeze([3, 3]),
    /** Живой сегмент к курсору: линия 1.4px `--accent`, сплошная. */
    liveWidth: 1.4,
  }),

  /** Гайды снапа и крестик — все семь веток одним стилем (решение 4). */
  snap: Object.freeze({
    /** Гайд: линия 1px `--draft-guide`, пунктир 4/3, тянется от точки снапа к источнику. */
    guideWidth: 1,
    guideDash: Object.freeze([4, 3]),
    /** Параллельный пунктир второй грани: 1px `--draft-contour-line`, пунктир 3/3. */
    faceWidth: 1,
    faceDash: Object.freeze([3, 3]),
    /** Крестик курсора: две линии 1.2px `--draft-guide`, плечо 6px. */
    crossWidth: 1.2,
    crossArm: 6,
  }),
});

/**
 * Курсоры холста (эталон, таблица «Курсоры»). Крестик снапа рисуется поверх курсора и его не заменяет.
 */
export const DRAFT_CURSORS = Object.freeze({
  /** Рисование — перекрестие. */
  drawing: 'crosshair',
  /** Наведение на точку или на сторону. */
  hover: 'grab',
  /** Перетаскивание и панорамирование (ПКМ или Space). */
  dragging: 'grabbing',
  /** Над пустым холстом. */
  idle: 'default',
});
