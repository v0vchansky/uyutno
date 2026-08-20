import { DRAFT_CURSORS, DRAFT_METRICS, DRAFT_PALETTE_FALLBACK, readDraftPalette } from './draftStyle';

/** Фейковый элемент: `readDraftPalette` ходит только по `ownerDocument.defaultView.getComputedStyle`. */
const elementWith = (values: Readonly<Record<string, string>>) => {
  const getPropertyValue = jest.fn((token: string): string => values[token] ?? '');
  const getComputedStyle = jest.fn(() => ({ getPropertyValue }));
  const element = { ownerDocument: { defaultView: { getComputedStyle } } };
  return { element: element as unknown as Element, getComputedStyle, getPropertyValue };
};

const CSS_TOKENS: Readonly<Record<string, string>> = {
  '--draft-canvas': '#111111',
  '--draft-wall-body': '#222222',
  '--draft-contour-line': '#333333',
  '--draft-room-fill': '#444444',
  '--draft-room-hatch': '#555555',
  '--draft-point': '#666666',
  '--draft-furniture-muted': '#777777',
  '--draft-guide': '#888888',
};

describe('draftStyle', () => {
  describe('readDraftPalette', () => {
    it('элемента нет (null) → копия фолбэка, а не сама константа', () => {
      const palette = readDraftPalette(null);
      expect(palette).toEqual(DRAFT_PALETTE_FALLBACK);
      expect(palette).not.toBe(DRAFT_PALETTE_FALLBACK);
    });

    it('все восемь токенов читаются из CSS', () => {
      const { element, getComputedStyle } = elementWith(CSS_TOKENS);
      expect(readDraftPalette(element)).toEqual({
        canvas: '#111111',
        wallBody: '#222222',
        contourLine: '#333333',
        roomFill: '#444444',
        roomHatch: '#555555',
        point: '#666666',
        furnitureMuted: '#777777',
        guide: '#888888',
      });
      expect(getComputedStyle).toHaveBeenCalledTimes(1);
      expect(getComputedStyle).toHaveBeenCalledWith(element);
    });

    it('значение токена обрезается по краям', () => {
      const { element } = elementWith({ ...CSS_TOKENS, '--draft-guide': '  #D65400\n' });
      expect(readDraftPalette(element).guide).toBe('#D65400');
    });

    it('пустой токен → фолбэк только для этого ключа', () => {
      const { element } = elementWith({ ...CSS_TOKENS, '--draft-point': '', '--draft-guide': '   ' });
      const palette = readDraftPalette(element);
      expect(palette.point).toBe(DRAFT_PALETTE_FALLBACK.point);
      expect(palette.guide).toBe(DRAFT_PALETTE_FALLBACK.guide);
      expect(palette.canvas).toBe('#111111');
      expect(palette.wallBody).toBe('#222222');
    });

    it('тема не подключена (все токены пусты) → фолбэк целиком', () => {
      const { element } = elementWith({});
      expect(readDraftPalette(element)).toEqual(DRAFT_PALETTE_FALLBACK);
    });

    it('среда без getComputedStyle (node/headless) → фолбэк целиком', () => {
      const detached = { ownerDocument: { defaultView: {} } } as unknown as Element;
      expect(readDraftPalette(detached)).toEqual(DRAFT_PALETTE_FALLBACK);
      const orphan = { ownerDocument: null } as unknown as Element;
      expect(readDraftPalette(orphan)).toEqual(DRAFT_PALETTE_FALLBACK);
    });

    it('фолбэк — значения таблицы «Новые токены» эталона; выделение красится тем же --accent, что и гайд', () => {
      expect(DRAFT_PALETTE_FALLBACK).toEqual({
        canvas: '#FFFFFF',
        wallBody: '#DEDEDE',
        contourLine: '#949494',
        roomFill: '#FCFCFC',
        roomHatch: '#F0F0F0',
        point: '#767676',
        furnitureMuted: '#EDEDED',
        guide: '#D65400',
      });
    });
  });

  describe('DRAFT_METRICS — сверка с нормативной таблицей эталона (planner-canvas-reference.md)', () => {
    it('хендл точки: покой r 4.2 / обводка 1.4', () => {
      expect(DRAFT_METRICS.handle.radius).toBe(4.2);
      expect(DRAFT_METRICS.handle.strokeWidth).toBe(1.4);
    });

    it('хендл точки: наведение — обводка 1.6, ореол r 6.6 при 14%', () => {
      expect(DRAFT_METRICS.handle.hoverStrokeWidth).toBe(1.6);
      expect(DRAFT_METRICS.handle.hoverHaloRadius).toBe(6.6);
      expect(DRAFT_METRICS.handle.hoverHaloAlpha).toBe(0.14);
    });

    it('хендл точки: выделенный r 5.8 с белым ядром r 3', () => {
      expect(DRAFT_METRICS.handle.selectedRadius).toBe(5.8);
      expect(DRAFT_METRICS.handle.selectedCoreRadius).toBe(3);
    });

    it('хендл точки: драг — ореол r 7.2 при 10%', () => {
      expect(DRAFT_METRICS.handle.draggingHaloRadius).toBe(7.2);
      expect(DRAFT_METRICS.handle.draggingHaloAlpha).toBe(0.1);
    });

    it('хендл точки: цель «замкнуть» — кольцо r 7.6 толщиной 1.3', () => {
      expect(DRAFT_METRICS.handle.closeRingRadius).toBe(7.6);
      expect(DRAFT_METRICS.handle.closeRingWidth).toBe(1.3);
    });

    it('хендл точки: цель «завершить» — рамка 14.4 / 1.3 / радиус 2, обводка кружка 1.8', () => {
      expect(DRAFT_METRICS.handle.finishFrameSize).toBe(14.4);
      expect(DRAFT_METRICS.handle.finishFrameWidth).toBe(1.3);
      expect(DRAFT_METRICS.handle.finishFrameRadius).toBe(2);
      expect(DRAFT_METRICS.handle.finishStrokeWidth).toBe(1.8);
    });

    it('сторона контура: 1.4 в покое, 2 под наведением, 2.6 выделенная', () => {
      expect(DRAFT_METRICS.face.width).toBe(1.4);
      expect(DRAFT_METRICS.face.hoverWidth).toBe(2);
      expect(DRAFT_METRICS.face.selectedWidth).toBe(2.6);
    });

    it('гайд снапа: 1px, пунктир 4/3; пунктир второй грани: 1px, 3/3', () => {
      expect(DRAFT_METRICS.snap.guideWidth).toBe(1);
      expect(DRAFT_METRICS.snap.guideDash).toEqual([4, 3]);
      expect(DRAFT_METRICS.snap.faceWidth).toBe(1);
      expect(DRAFT_METRICS.snap.faceDash).toEqual([3, 3]);
    });

    it('крестик курсора: линии 1.2, плечо 6', () => {
      expect(DRAFT_METRICS.snap.crossWidth).toBe(1.2);
      expect(DRAFT_METRICS.snap.crossArm).toBe(6);
    });

    it('превью: лента 12%, вторая грань 1px пунктиром 3/3, живой сегмент 1.4', () => {
      expect(DRAFT_METRICS.preview.bandAlpha).toBe(0.12);
      expect(DRAFT_METRICS.preview.bandFaceWidth).toBe(1);
      expect(DRAFT_METRICS.preview.bandFaceDash).toEqual([3, 3]);
      expect(DRAFT_METRICS.preview.liveWidth).toBe(1.4);
    });

    it('комната: hover 6%, выделение 10%, кольцо выделения 1, линия штриховки 1', () => {
      expect(DRAFT_METRICS.room.hoverAlpha).toBe(0.06);
      expect(DRAFT_METRICS.room.selectedAlpha).toBe(0.1);
      expect(DRAFT_METRICS.room.selectedRingWidth).toBe(1);
      expect(DRAFT_METRICS.room.hatchWidth).toBe(1);
    });

    it('в единицах плана: шаг штриховки 8 (наклон 45° задан направлением линий в drawHatch)', () => {
      expect(DRAFT_METRICS.plan.hatchStep).toBe(8);
    });

    it('таблицы заморожены — правка только в исходнике', () => {
      expect(Object.isFrozen(DRAFT_METRICS)).toBe(true);
      expect(Object.isFrozen(DRAFT_METRICS.handle)).toBe(true);
      expect(Object.isFrozen(DRAFT_PALETTE_FALLBACK)).toBe(true);
    });
  });

  describe('DRAFT_CURSORS — таблица «Курсоры» эталона', () => {
    it('рисование crosshair, наведение grab, драг и пан grabbing, пустой холст default', () => {
      expect(DRAFT_CURSORS).toEqual({
        drawing: 'crosshair',
        hover: 'grab',
        dragging: 'grabbing',
        idle: 'default',
      });
    });
  });
});
