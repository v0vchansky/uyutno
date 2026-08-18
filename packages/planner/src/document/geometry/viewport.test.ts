import * as fc from 'fast-check';

import type { PlanPosition } from '../PlannerDocument';
import { arbPoint, fcParams } from './testing/arbitraries';
import { type Viewport, boundsContain, pixelsToPlan, planToView, viewToPlan, viewportBounds } from './viewport';

const vp = (scale: number, center: PlanPosition, width: number, height: number): Viewport => ({
  scale,
  center,
  width,
  height,
});

const arbViewport: fc.Arbitrary<Viewport> = fc.record({
  scale: fc.double({ min: 0.05, max: 10.11, noNaN: true }),
  center: arbPoint,
  width: fc.integer({ min: 1, max: 4000 }),
  height: fc.integer({ min: 1, max: 4000 }),
});

describe('viewport', () => {
  describe('planToView / viewToPlan', () => {
    it('центр плана → центр канваса', () => {
      const viewport = vp(1.5, { x: 120, y: -40 }, 800, 600);
      expect(planToView(viewport, { x: 120, y: -40 })).toEqual({ x: 400, y: 300 });
      expect(viewToPlan(viewport, { x: 400, y: 300 })).toEqual({ x: 120, y: -40 });
    });

    it('обычный случай: числа при scale 2', () => {
      const viewport = vp(2, { x: 0, y: 0 }, 800, 600);
      expect(planToView(viewport, { x: 10, y: 20 })).toEqual({ x: 420, y: 260 });
      expect(viewToPlan(viewport, { x: 420, y: 260 })).toEqual({ x: 10, y: 20 });
    });

    it('знак y: точка выше центра плана — меньший экранный y; экранное «вверх» = +y плана', () => {
      const viewport = vp(1, { x: 0, y: 0 }, 800, 600);
      const above = planToView(viewport, { x: 0, y: 100 });
      const center = planToView(viewport, { x: 0, y: 0 });
      expect(above.y).toBeLessThan(center.y);
      expect(viewToPlan(viewport, { x: 400, y: 0 }).y).toBeGreaterThan(viewToPlan(viewport, { x: 400, y: 300 }).y);
    });

    it('x монотонен: правее по плану — правее по экрану', () => {
      const viewport = vp(1, { x: 0, y: 0 }, 800, 600);
      expect(planToView(viewport, { x: 100, y: 0 }).x).toBeGreaterThan(planToView(viewport, { x: 0, y: 0 }).x);
    });

    it('property: round-trip план → экран → план', () => {
      fc.assert(
        fc.property(arbViewport, arbPoint, (viewport, point) => {
          const back = viewToPlan(viewport, planToView(viewport, point));
          expect(back.x).toBeCloseTo(point.x, 6);
          expect(back.y).toBeCloseTo(point.y, 6);
        }),
        fcParams,
      );
    });

    it('property: round-trip экран → план → экран', () => {
      fc.assert(
        fc.property(
          arbViewport,
          fc.record({
            x: fc.double({ min: -5000, max: 5000, noNaN: true }),
            y: fc.double({ min: -5000, max: 5000, noNaN: true }),
          }),
          (viewport, screen) => {
            const back = planToView(viewport, viewToPlan(viewport, screen));
            expect(back.x).toBeCloseTo(screen.x, 3);
            expect(back.y).toBeCloseTo(screen.y, 3);
          },
        ),
        fcParams,
      );
    });
  });

  describe('pixelsToPlan', () => {
    it('10 px при scale 2 → 5 см; при scale 1 — 10 см; при scale 0.5 — 20 см', () => {
      expect(pixelsToPlan(vp(2, { x: 0, y: 0 }, 800, 600), 10)).toBe(5);
      expect(pixelsToPlan(vp(1, { x: 0, y: 0 }, 800, 600), 10)).toBe(10);
      expect(pixelsToPlan(vp(0.5, { x: 0, y: 0 }, 800, 600), 10)).toBe(20);
    });

    it('0 px → 0 см', () => {
      expect(pixelsToPlan(vp(2, { x: 0, y: 0 }, 800, 600), 0)).toBe(0);
    });
  });

  describe('viewportBounds', () => {
    it('scale 1: bbox = центр ± половина размеров', () => {
      expect(viewportBounds(vp(1, { x: 100, y: 50 }, 800, 600))).toEqual({
        minX: -300,
        maxX: 500,
        minY: -250,
        maxY: 350,
      });
    });

    it('scale 2: bbox вдвое меньше', () => {
      expect(viewportBounds(vp(2, { x: 0, y: 0 }, 800, 600))).toEqual({ minX: -200, maxX: 200, minY: -150, maxY: 150 });
    });

    it('property: ширина bbox = width/scale, высота = height/scale, центр — центр вьюпорта', () => {
      fc.assert(
        fc.property(arbViewport, viewport => {
          const bounds = viewportBounds(viewport);
          expect(bounds.maxX - bounds.minX).toBeCloseTo(viewport.width / viewport.scale, 6);
          expect(bounds.maxY - bounds.minY).toBeCloseTo(viewport.height / viewport.scale, 6);
          expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(viewport.center.x, 6);
          expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(viewport.center.y, 6);
        }),
        fcParams,
      );
    });

    it('углы bbox совпадают с обратной проекцией углов канваса', () => {
      const viewport = vp(1.25, { x: 30, y: -70 }, 640, 480);
      const bounds = viewportBounds(viewport);
      const topLeft = viewToPlan(viewport, { x: 0, y: 0 });
      const bottomRight = viewToPlan(viewport, { x: 640, y: 480 });
      expect(topLeft.x).toBeCloseTo(bounds.minX, 9);
      expect(topLeft.y).toBeCloseTo(bounds.maxY, 9);
      expect(bottomRight.x).toBeCloseTo(bounds.maxX, 9);
      expect(bottomRight.y).toBeCloseTo(bounds.minY, 9);
    });
  });

  describe('boundsContain', () => {
    const bounds = { minX: -100, maxX: 100, minY: -50, maxY: 50 };

    it('внутри — true', () => {
      expect(boundsContain(bounds, { x: 0, y: 0 })).toBe(true);
    });

    it('включительно на всех четырёх границах и в углах', () => {
      expect(boundsContain(bounds, { x: -100, y: 0 })).toBe(true);
      expect(boundsContain(bounds, { x: 100, y: 0 })).toBe(true);
      expect(boundsContain(bounds, { x: 0, y: -50 })).toBe(true);
      expect(boundsContain(bounds, { x: 0, y: 50 })).toBe(true);
      expect(boundsContain(bounds, { x: -100, y: -50 })).toBe(true);
      expect(boundsContain(bounds, { x: 100, y: 50 })).toBe(true);
    });

    it('чуть снаружи по каждой границе — false', () => {
      expect(boundsContain(bounds, { x: -100.001, y: 0 })).toBe(false);
      expect(boundsContain(bounds, { x: 100.001, y: 0 })).toBe(false);
      expect(boundsContain(bounds, { x: 0, y: -50.001 })).toBe(false);
      expect(boundsContain(bounds, { x: 0, y: 50.001 })).toBe(false);
    });

    it('NaN в любой координате → false', () => {
      expect(boundsContain(bounds, { x: Number.NaN, y: 0 })).toBe(false);
      expect(boundsContain(bounds, { x: 0, y: Number.NaN })).toBe(false);
      expect(boundsContain({ ...bounds, minX: Number.NaN }, { x: 0, y: 0 })).toBe(false);
    });

    it('property: любая точка внутри bbox своего же вьюпорта после round-trip через экран', () => {
      fc.assert(
        fc.property(
          arbViewport,
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          (viewport, u, v) => {
            const screen = { x: u * viewport.width, y: v * viewport.height };
            const plan = viewToPlan(viewport, screen);
            const bounds = viewportBounds(viewport);
            const slack = 1e-6 * (1 + Math.abs(viewport.center.x) + Math.abs(viewport.center.y));
            const loose = {
              minX: bounds.minX - slack,
              maxX: bounds.maxX + slack,
              minY: bounds.minY - slack,
              maxY: bounds.maxY + slack,
            };
            expect(boundsContain(loose, plan)).toBe(true);
          },
        ),
        fcParams,
      );
    });
  });
});
