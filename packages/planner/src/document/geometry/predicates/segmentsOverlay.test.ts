import { L_EPS } from './pointsMatch';
import { segmentsOverlay } from './segmentsOverlay';

describe('segmentsOverlay', () => {
  const A = { x: 0, y: 0 };
  const B = { x: 10, y: 0 };

  it('коллинеарный нахлёст — true; порядок концов любой', () => {
    expect(segmentsOverlay(A, B, { x: 5, y: 0 }, { x: 15, y: 0 })).toBe(true);
    expect(segmentsOverlay(A, B, { x: 15, y: 0 }, { x: 5, y: 0 })).toBe(true);
    expect(segmentsOverlay(B, A, { x: 2, y: 0 }, { x: 3, y: 0 })).toBe(true); // ef внутри ab
    expect(segmentsOverlay({ x: 2, y: 0 }, { x: 3, y: 0 }, A, B)).toBe(true); // ab внутри ef
    expect(segmentsOverlay(A, B, A, B)).toBe(true);
  });

  it('касание только общим концом наложением не считается (отрицательный слак)', () => {
    expect(segmentsOverlay(A, B, B, { x: 20, y: 0 })).toBe(false);
    expect(segmentsOverlay(A, B, { x: -20, y: 0 }, A)).toBe(false);
    // Нахлёст чуть больше слака — уже наложение.
    expect(segmentsOverlay(A, B, { x: 10 - L_EPS * 2, y: 0 }, { x: 20, y: 0 })).toBe(true);
    expect(segmentsOverlay(A, B, { x: 10 + L_EPS * 0.5, y: 0 }, { x: 20, y: 0 })).toBe(false);
    // Нахлёст меньше слака (0.5·L_EPS) — ещё не наложение.
    expect(segmentsOverlay(A, B, { x: 10 - L_EPS * 0.5, y: 0 }, { x: 20, y: 0 })).toBe(false);
  });

  it('выбор оси сравнения по |Δy| < B_EPS: почти горизонтальные — по x, чуть круче — по y', () => {
    // Почти горизонтальный ab (Δy = 0.5·B_EPS): сравнение по x — разнесены → false.
    const tilt = 0.5e-4;
    expect(segmentsOverlay(A, { x: 10, y: tilt }, { x: 20, y: 2 * tilt }, { x: 30, y: 3 * tilt }, 1)).toBe(false);
    // Δy = 2·B_EPS: сравнение по y — диапазоны y перекрываются при большом dist → true.
    const steep = 2e-4;
    expect(segmentsOverlay(A, { x: 10, y: steep }, { x: 20, y: 0 }, { x: 30, y: steep }, 1)).toBe(true);
  });

  it('коллинеарные, но разнесённые — false; не коллинеарные — false', () => {
    expect(segmentsOverlay(A, B, { x: 20, y: 0 }, { x: 30, y: 0 })).toBe(false);
    expect(segmentsOverlay(A, B, { x: 0, y: 1 }, { x: 10, y: 1 })).toBe(false); // параллель на 1 см
    expect(segmentsOverlay(A, B, { x: 5, y: -5 }, { x: 5, y: 5 })).toBe(false); // крест
  });

  it('допуск коллинеарности dist: дефолт L_EPS — конец на 1e-6 от прямой уже не коллинеарен; свой dist — да', () => {
    expect(segmentsOverlay(A, B, { x: 5, y: 1e-6 }, { x: 15, y: 0 })).toBe(false);
    expect(segmentsOverlay(A, B, { x: 5, y: 1e-6 }, { x: 15, y: 0 }, 1e-4)).toBe(true);
  });

  it('вертикальные отрезки — сравнение по y; наклонные — по y', () => {
    expect(segmentsOverlay({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 0, y: 5 }, { x: 0, y: 15 })).toBe(true);
    expect(segmentsOverlay({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 15 })).toBe(false);
    expect(segmentsOverlay({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 5 }, { x: 20, y: 20 })).toBe(true);
    expect(segmentsOverlay({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 10 }, { x: 20, y: 20 })).toBe(false);
  });

  it('NaN — false', () => {
    expect(segmentsOverlay(A, B, { x: Number.NaN, y: 0 }, { x: 15, y: 0 })).toBe(false);
  });
});
