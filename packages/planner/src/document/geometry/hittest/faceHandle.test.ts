import type { Viewport } from '../viewport';
import { CLEAR_CONTOUR_MIN_LEN } from '../contours/clearContour';
import { FACE_HANDLE_SIZE, faceHandleAvailable, faceMidpoint, onFaceHandle, splitPositionOn } from './faceHandle';

const viewport = (scale: number): Viewport => ({ scale, center: { x: 0, y: 0 }, width: 800, height: 600 });

const a = { x: 0, y: 0 };
const b = { x: 100, y: 0 };

describe('faceMidpoint', () => {
  it('середина отрезка, независимо от порядка концов', () => {
    expect(faceMidpoint(a, b)).toEqual({ x: 50, y: 0 });
    expect(faceMidpoint(b, a)).toEqual({ x: 50, y: 0 });
  });
});

describe('faceHandleAvailable', () => {
  it('грань длиннее двух порогов чистки — ручка есть; ровно два порога — тоже (вершина встанет в середину)', () => {
    expect(faceHandleAvailable(a, b)).toBe(true);
    expect(faceHandleAvailable(a, { x: 2 * CLEAR_CONTOUR_MIN_LEN, y: 0 })).toBe(true);
  });

  it('грань короче двух порогов — ручки нет: любую вершину схлопнет `clearContour`', () => {
    expect(faceHandleAvailable(a, { x: 2 * CLEAR_CONTOUR_MIN_LEN - 0.001, y: 0 })).toBe(false);
    expect(faceHandleAvailable(a, a)).toBe(false);
  });
});

describe('onFaceHandle', () => {
  it('обе стороны порога 4 px при масштабе 1: внутри диска — да, снаружи — нет', () => {
    expect(onFaceHandle({ x: 50 + FACE_HANDLE_SIZE - 0.001, y: 0 }, a, b, viewport(1))).toBe(true);
    expect(onFaceHandle({ x: 50 + FACE_HANDLE_SIZE + 0.001, y: 0 }, a, b, viewport(1))).toBe(false);
  });

  it('метрика евклидова, а не манхэттен: смещение 3+2 внутри круга радиуса 4, хотя манхэттен уже 5', () => {
    expect(onFaceHandle({ x: 53, y: 2 }, a, b, viewport(1))).toBe(true);
    // Тот же манхэттен 5, но по одной оси — и внутри круга, и внутри ромба: порог различают только диагонали.
    expect(onFaceHandle({ x: 55, y: 0 }, a, b, viewport(1))).toBe(false);
  });

  it('порог фиксирован в экранных px: при масштабе 2 радиус в плане вдвое меньше', () => {
    expect(onFaceHandle({ x: 51.9, y: 0 }, a, b, viewport(2))).toBe(true);
    expect(onFaceHandle({ x: 52.1, y: 0 }, a, b, viewport(2))).toBe(false);
  });

  it('на грани короче двух порогов ручки нет ни в одной точке', () => {
    const short = { x: 8, y: 0 };
    expect(onFaceHandle({ x: 4, y: 0 }, a, short, viewport(1))).toBe(false);
  });
});

describe('splitPositionOn', () => {
  it('проекция курсора на саму грань: поперечный промах снимается', () => {
    expect(splitPositionOn({ x: 52, y: 3 }, a, b)).toEqual({ x: 52, y: 0 });
  });

  it('позиция поджата к отрезку [5 см, длина − 5 см] — ближе вершину съест чистка контура', () => {
    const short = { x: 12, y: 0 };
    expect(splitPositionOn({ x: 1, y: 0 }, a, short)).toEqual({ x: CLEAR_CONTOUR_MIN_LEN, y: 0 });
    expect(splitPositionOn({ x: 11, y: 0 }, a, short)).toEqual({ x: 12 - CLEAR_CONTOUR_MIN_LEN, y: 0 });
  });

  it('грань ровно в два порога — единственная законная позиция посередине', () => {
    const ten = { x: 2 * CLEAR_CONTOUR_MIN_LEN, y: 0 };
    expect(splitPositionOn({ x: 1, y: 0 }, a, ten)).toEqual({ x: CLEAR_CONTOUR_MIN_LEN, y: 0 });
  });

  it('вырожденная грань — `null`', () => {
    expect(splitPositionOn({ x: 0, y: 0 }, a, a)).toBeNull();
  });
});
