import { euclDist } from '../predicates/distance';
import { type Viewport, planToView } from '../viewport';
import {
  INPUT_MIN_SCREEN_LENGTH,
  LABEL_MIN_SCREEN_LENGTH,
  LABEL_OFFSET,
  LABEL_TEXT_MARGIN,
  RECT_INPUT_MIN_SCREEN_LENGTH,
  labelFits,
  placeEdgeLabel,
  ringOrientation,
} from './labelPlacement';

/** Вьюпорт 800×600 с центром в начале плана: план (px, py) → экран (px·s + 400, 300 − py·s). */
const vp = (scale = 1): Viewport => ({ scale, center: { x: 0, y: 0 }, width: 800, height: 600 });

/** Квадрат 100×100 против часовой при y вверх (площадь > 0); углы — по сторонам света на экране. */
const BL = { x: -50, y: -50 };
const BR = { x: 50, y: -50 };
const TR = { x: 50, y: 50 };
const TL = { x: -50, y: 50 };
const CCW_SQUARE = [BL, BR, TR, TL];
const CW_SQUARE = [TL, TR, BR, BL];

/** Точка плана на расстоянии 100 см от начала под углом `deg` (против часовой, y вверх). */
const polar = (deg: number) => ({
  x: 100 * Math.cos((deg * Math.PI) / 180),
  y: 100 * Math.sin((deg * Math.PI) / 180),
});

describe('пороги подписей и инпутов', () => {
  it('значения из спеки 07 «Ограничения и пороги» / 01 «Ввод длины»', () => {
    expect(LABEL_MIN_SCREEN_LENGTH).toBe(30);
    expect(LABEL_TEXT_MARGIN).toBe(30);
    expect(INPUT_MIN_SCREEN_LENGTH).toBe(45);
    expect(RECT_INPUT_MIN_SCREEN_LENGTH).toBe(70);
    expect(LABEL_OFFSET).toBe(16);
  });
});

describe('ringOrientation', () => {
  it('кольцо против часовой (площадь > 0) → 1', () => {
    expect(ringOrientation(CCW_SQUARE)).toBe(1);
  });

  it('кольцо по часовой (площадь < 0) → −1', () => {
    expect(ringOrientation(CW_SQUARE)).toBe(-1);
  });

  it('вырожденное кольцо (< 3 точек, нулевая площадь, коллинеарные точки) → 1', () => {
    expect(ringOrientation([])).toBe(1);
    expect(ringOrientation([{ x: 0, y: 0 }])).toBe(1);
    expect(
      ringOrientation([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBe(1);
    expect(
      ringOrientation([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]),
    ).toBe(1);
  });
});

describe('labelFits', () => {
  it('текст с запасом 30 px влезает — true, ровно на границе тоже true', () => {
    expect(labelFits(100, 50)).toBe(true);
    expect(labelFits(80, 50)).toBe(true); // 50 + 30 === 80
  });

  it('на 0.001 px короче порога — false', () => {
    expect(labelFits(79.999, 50)).toBe(false);
    expect(labelFits(60, 50)).toBe(false);
  });

  it('нулевой текст помещается только в сегмент от 30 px', () => {
    expect(labelFits(LABEL_TEXT_MARGIN, 0)).toBe(true);
    expect(labelFits(LABEL_TEXT_MARGIN - 0.001, 0)).toBe(false);
  });
});

describe('placeEdgeLabel — экранная длина', () => {
  it('scale = 1: screenLength = евклидова длина ребра', () => {
    const a = { x: -60, y: 0 };
    const b = { x: 40, y: 0 };
    expect(placeEdgeLabel(vp(1), a, b, 1).screenLength).toBeCloseTo(euclDist(a, b) * 1, 9);
    expect(placeEdgeLabel(vp(1), a, b, 1).screenLength).toBeCloseTo(100, 9);
  });

  it('scale = 2: screenLength = евклидова длина × 2', () => {
    const a = { x: -60, y: 0 };
    const b = { x: 40, y: 0 };
    expect(placeEdgeLabel(vp(2), a, b, 1).screenLength).toBeCloseTo(euclDist(a, b) * 2, 9);
    expect(placeEdgeLabel(vp(2), a, b, 1).screenLength).toBeCloseTo(200, 9);
  });

  it('screenLength — всегда полная длина ребра, даже когда подпись подтянута к рамке', () => {
    // Ребро уходит далеко вправо за край: середина за рамкой, часть видна.
    const placement = placeEdgeLabel(vp(1), { x: 300, y: 0 }, { x: 700, y: 0 }, 1);
    expect(placement.clamped).toBe(true);
    expect(placement.screenLength).toBeCloseTo(400, 9);
  });
});

describe('placeEdgeLabel — сдвиг наружу кольца', () => {
  const viewport = vp(1);

  it('CCW-кольцо: подпись нижнего ребра уходит вниз по экрану (наружу квадрата)', () => {
    const mid = planToView(viewport, { x: 0, y: -50 });
    const placement = placeEdgeLabel(viewport, BL, BR, 1);
    expect(placement.x).toBeCloseTo(mid.x, 9);
    expect(placement.y).toBeCloseTo(mid.y + LABEL_OFFSET, 9);
    expect(placement.y).toBeGreaterThan(mid.y);
  });

  it('CCW-кольцо: подпись верхнего ребра уходит вверх по экрану', () => {
    const mid = planToView(viewport, { x: 0, y: 50 });
    const placement = placeEdgeLabel(viewport, TR, TL, 1);
    expect(placement.x).toBeCloseTo(mid.x, 9);
    expect(placement.y).toBeCloseTo(mid.y - LABEL_OFFSET, 9);
    expect(placement.y).toBeLessThan(mid.y);
  });

  it('CCW-кольцо: правое ребро уходит вправо, левое — влево', () => {
    const rightMid = planToView(viewport, { x: 50, y: 0 });
    const right = placeEdgeLabel(viewport, BR, TR, 1);
    expect(right.x).toBeCloseTo(rightMid.x + LABEL_OFFSET, 9);
    expect(right.y).toBeCloseTo(rightMid.y, 9);

    const leftMid = planToView(viewport, { x: -50, y: 0 });
    const left = placeEdgeLabel(viewport, TL, BL, 1);
    expect(left.x).toBeCloseTo(leftMid.x - LABEL_OFFSET, 9);
    expect(left.y).toBeCloseTo(leftMid.y, 9);
  });

  it('CW-кольцо: сдвиг зеркальный — то же ребро уходит в противоположную сторону', () => {
    const mid = planToView(viewport, { x: 0, y: -50 });
    // Обход по часовой: нижнее ребро проходится справа налево.
    const placement = placeEdgeLabel(viewport, BR, BL, ringOrientation(CW_SQUARE));
    expect(placement.y).toBeCloseTo(mid.y + LABEL_OFFSET, 9);

    // То же направление ребра, но объявленная ориентация кольца обратная → сдвиг переворачивается.
    const flipped = placeEdgeLabel(viewport, BL, BR, -1);
    expect(flipped.y).toBeCloseTo(mid.y - LABEL_OFFSET, 9);
  });

  it('offset = 0 — подпись ровно в середине ребра; произвольный offset масштабирует сдвиг', () => {
    const mid = planToView(viewport, { x: 0, y: -50 });
    const zero = placeEdgeLabel(viewport, BL, BR, 1, 0);
    expect(zero.x).toBeCloseTo(mid.x, 9);
    expect(zero.y).toBeCloseTo(mid.y, 9);
    expect(placeEdgeLabel(viewport, BL, BR, 1, 40).y).toBeCloseTo(mid.y + 40, 9);
  });

  it('сдвиг перпендикулярен ребру и по модулю равен offset (диагональ)', () => {
    const a = { x: -50, y: -50 };
    const b = { x: 50, y: 50 };
    const mid = planToView(viewport, { x: 0, y: 0 });
    const placement = placeEdgeLabel(viewport, a, b, 1);
    const shift = { x: placement.x - mid.x, y: placement.y - mid.y };
    expect(Math.hypot(shift.x, shift.y)).toBeCloseTo(LABEL_OFFSET, 9);
    // Скалярное произведение с экранным направлением ребра — 0.
    const A = planToView(viewport, a);
    const B = planToView(viewport, b);
    expect(shift.x * (B.x - A.x) + shift.y * (B.y - A.y)).toBeCloseTo(0, 9);
  });
});

describe('placeEdgeLabel — авторазворот угла', () => {
  const viewport = vp(1);
  const O = { x: 0, y: 0 };

  it.each<[number, { x: number; y: number }, number]>([
    [0, { x: 100, y: 0 }, 0],
    [45, { x: 100, y: 100 }, -45],
    [89, polar(89), -89],
    [90, { x: 0, y: 100 }, -90],
    [91, polar(91), 89],
    [135, { x: -100, y: 100 }, 45],
    [180, { x: -100, y: 0 }, 0],
    [270, { x: 0, y: -100 }, -90],
  ])('ребро под %i° плана → угол подписи %p → %f', (_deg, b, expected) => {
    expect(placeEdgeLabel(viewport, O, b, 1).angle).toBeCloseTo(expected, 9);
  });

  it('угол всегда в [−90, 90) — шаг 1° по полному обороту', () => {
    for (let deg = -360; deg <= 360; deg++) {
      const { angle } = placeEdgeLabel(viewport, O, polar(deg), 1);
      expect(angle).toBeGreaterThanOrEqual(-90);
      expect(angle).toBeLessThan(90);
    }
  });

  it('вертикальное ребро даёт ровно −90 в обе стороны (прототип handoff, сцена 14)', () => {
    expect(placeEdgeLabel(viewport, O, { x: 0, y: 100 }, 1).angle).toBe(-90);
    expect(placeEdgeLabel(viewport, O, { x: 0, y: -100 }, 1).angle).toBe(-90);
  });
});

describe('placeEdgeLabel — clamped к рамке холста', () => {
  const viewport = vp(1);

  it('ребро целиком в кадре → clamped = false, точка = середина (плюс сдвиг)', () => {
    const a = { x: -100, y: 0 };
    const b = { x: 100, y: 0 };
    const placement = placeEdgeLabel(viewport, a, b, 1, 0);
    expect(placement.clamped).toBe(false);
    expect(placement.x).toBeCloseTo(400, 9);
    expect(placement.y).toBeCloseTo(300, 9);
  });

  it('середина за правым краем, но часть ребра видна → clamped = true и точка внутри рамки', () => {
    // Экран: A = (700, 300), B = (1100, 300); середина x = 900 > 800, видимый участок t ∈ [0, 0.25].
    const placement = placeEdgeLabel(viewport, { x: 300, y: 0 }, { x: 700, y: 0 }, 1, 0);
    expect(placement.clamped).toBe(true);
    expect(placement.x).toBeCloseTo(750, 9);
    expect(placement.y).toBeCloseTo(300, 9);
    expect(placement.x).toBeGreaterThanOrEqual(0);
    expect(placement.x).toBeLessThanOrEqual(viewport.width);
    expect(placement.y).toBeGreaterThanOrEqual(0);
    expect(placement.y).toBeLessThanOrEqual(viewport.height);
  });

  it('середина за нижним краем, но часть ребра видна → clamped = true', () => {
    // Экран: A = (400, 500), B = (400, 1100); середина y = 800 > 600, видимый участок t ∈ [0, 1/6].
    const placement = placeEdgeLabel(viewport, { x: 0, y: -200 }, { x: 0, y: -800 }, 1, 0);
    expect(placement.clamped).toBe(true);
    expect(placement.y).toBeCloseTo(550, 9);
    expect(placement.y).toBeLessThanOrEqual(viewport.height);
  });

  it('ребро целиком вне кадра → clamped = false и геометрическая середина', () => {
    // Экран: A = (900, 300), B = (1000, 300) — правее рамки целиком.
    const placement = placeEdgeLabel(viewport, { x: 500, y: 0 }, { x: 600, y: 0 }, 1, 0);
    expect(placement.clamped).toBe(false);
    expect(placement.x).toBeCloseTo(950, 9);
    expect(placement.y).toBeCloseTo(300, 9);
  });

  it('ребро целиком вне кадра по вертикали (параллельно границе) → clamped = false', () => {
    // Экран: y = 900 — ниже рамки, отрезок горизонтален, ветка `pi === 0 && qi < 0`.
    const placement = placeEdgeLabel(viewport, { x: -100, y: -600 }, { x: 100, y: -600 }, 1, 0);
    expect(placement.clamped).toBe(false);
    expect(placement.x).toBeCloseTo(400, 9);
    expect(placement.y).toBeCloseTo(900, 9);
  });

  it('середина ровно на границе рамки считается видимой → clamped = false', () => {
    // Экран: A = (600, 300), B = (1000, 300), середина x = 800 = ширина рамки.
    const placement = placeEdgeLabel(viewport, { x: 200, y: 0 }, { x: 600, y: 0 }, 1, 0);
    expect(placement.clamped).toBe(false);
    expect(placement.x).toBeCloseTo(800, 9);
  });
});

describe('placeEdgeLabel — вырожденное ребро', () => {
  it('a === b: angle = 0, screenLength = 0, сдвига нет', () => {
    const viewport = vp(1);
    const a = { x: 25, y: -40 };
    const expected = planToView(viewport, a);
    const placement = placeEdgeLabel(viewport, a, { ...a }, 1);
    expect(placement.screenLength).toBe(0);
    expect(placement.angle).toBe(0);
    expect(placement.clamped).toBe(false);
    expect(placement.x).toBeCloseTo(expected.x, 9);
    expect(placement.y).toBeCloseTo(expected.y, 9);
  });

  it('вырожденное ребро за рамкой холста тоже не клампится', () => {
    const viewport = vp(1);
    const a = { x: 5000, y: 5000 };
    const placement = placeEdgeLabel(viewport, a, { ...a }, -1);
    expect(placement.clamped).toBe(false);
    expect(placement.angle).toBe(0);
    expect(placement.screenLength).toBe(0);
  });
});
