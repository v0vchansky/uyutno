import { expect, test as base, type Page } from '@playwright/test';
import type { PlannerInstance } from '@uyutno/planner';

import { PLANNER_READY_EVENT } from '../src/client/project/lib/plannerReadyEvent';

/**
 * E2E-смоук правки точек/сторон в конструкторе (testing-strategy слой 4; ADR 0019 E4/E8, задача 0059): в реальном
 * браузере через dev-ручку `onReady` — нарисовать прямоугольник инструментом «Стены» → нажать на угол и перетащить
 * (live-`pointOverrides`, документ не тронут) → отпустить → комната пересобрана одной записью → undo вернул;
 * нудж выделенной вершины стрелками — одна запись на серию. Реестр экземпляров — у теста (`addInitScript`).
 */

interface E2ERegistry {
  planners: PlannerInstance[];
}

declare global {
  interface Window {
    __uyutnoE2E?: E2ERegistry;
  }
}

const PROJECT_URL = '/project/e2e-edit-points';

const test = base.extend<{ plannerPage: Page }>({
  plannerPage: async ({ page }, use) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.addInitScript(eventName => {
      const store: E2ERegistry = { planners: [] };
      window.__uyutnoE2E = store;
      window.addEventListener(eventName, event => {
        store.planners.push((event as CustomEvent<PlannerInstance>).detail);
      });
    }, PLANNER_READY_EVENT);
    await page.goto(PROJECT_URL);
    await page.waitForFunction(() => (window.__uyutnoE2E?.planners.length ?? 0) >= 1);
    await use(page);
    expect(pageErrors, 'страница без исключений').toEqual([]);
  },
});

test.describe('планер: правка точек через tools (headless-команды в координатах плана)', () => {
  test('прямоугольник → драг угла (override без записи) → отпускание → комната пересобрана → undo вернул; нудж — одна запись', async ({
    plannerPage: page,
  }) => {
    const result = await page.evaluate(() => {
      const { manager } = window.__uyutnoE2E!.planners[0]!;
      const { tools } = manager;
      const mods = { ctrl: false, meta: false, shift: false, alt: false };
      const at = (x: number, y: number) => ({ x, y, mods, button: 0 });
      const click = (x: number, y: number) => {
        tools.pointerMove(at(x, y));
        tools.pointerDown(at(x, y));
        tools.pointerUp(at(x, y));
      };
      const layout = () => manager.document.get().floors[0]!.layout;
      const derived = () => manager.document.getDerived().floors[0]!;
      const roomArea = () => derived().rooms[0]?.area ?? 0;
      let documentEvents = 0;
      manager.on('document:changed', () => documentEvents++);

      // Фиксированный viewport: пороги (3 px драг, 10 px снап, 6 px хит-тест) в плане не зависят от fit вьювера.
      tools.setViewport({ scale: 1, center: { x: 0, y: 0 }, width: 1024, height: 768 });
      tools.start('walls');
      click(0, 0);
      click(400, 0);
      click(400, 300);
      click(0, 300);
      click(4, 3);
      const areaAfterDraw = roomArea();
      const eventsAfterDraw = documentEvents;
      // Внутренний угол комнаты (10,10): его сдвиг внутрь меняет площадь комнаты.
      const cornerId = Object.values(layout().points).find(p => p.x === 10 && p.y === 10)?.id ?? null;

      // Наведение и нажатие на угол (10,10), сдвиг за порог, live-override без записи в документ.
      tools.pointerMove(at(11, 11));
      const hover = tools.get().kind === 'editing' ? (tools.get() as { hover: unknown }).hover : null;
      tools.pointerDown(at(11, 11));
      tools.pointerMove(at(25, 25));
      tools.pointerMove(at(40, 40));
      const dragging = tools.get();
      const overrides = dragging.kind === 'dragging-point' ? dragging.pointOverrides : null;
      const eventsDuringDrag = documentEvents;
      const areaDuringDrag = roomArea();

      tools.pointerUp(at(40, 40));
      const kindAfterDrop = tools.get().kind;
      const cornerAfterDrop = cornerId ? layout().points[cornerId] : null;
      const areaAfterDrop = roomArea();
      const eventsAfterDrop = documentEvents;
      const selectionAfterDrop =
        tools.get().kind === 'editing' ? (tools.get() as { selection: unknown }).selection : null;

      tools.key({ kind: 'undo' });
      const cornerAfterUndo = cornerId ? layout().points[cornerId] : null;
      const areaAfterUndo = roomArea();

      // Нудж: выделить угол кликом, три нажатия стрелки → одна запись.
      click(11, 11);
      tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 });
      tools.key({ kind: 'nudge', dx: 1, dy: 0, factor: 1 });
      const nudged = tools.key({ kind: 'nudge', dx: 0, dy: 1, factor: 10 });
      const cornerAfterNudge = cornerId ? layout().points[cornerId] : null;
      tools.key({ kind: 'undo' });
      const cornerAfterNudgeUndo = cornerId ? layout().points[cornerId] : null;
      const canUndoAfter = manager.history.get().canUndo;

      return {
        areaAfterDraw,
        eventsAfterDraw,
        cornerId,
        hover,
        overrides,
        eventsDuringDrag,
        areaDuringDrag,
        kindAfterDrop,
        cornerAfterDrop: cornerAfterDrop ? { x: cornerAfterDrop.x, y: cornerAfterDrop.y } : null,
        areaAfterDrop,
        eventsAfterDrop,
        selectionAfterDrop,
        cornerAfterUndo: cornerAfterUndo ? { x: cornerAfterUndo.x, y: cornerAfterUndo.y } : null,
        areaAfterUndo,
        nudged,
        cornerAfterNudge: cornerAfterNudge ? { x: cornerAfterNudge.x, y: cornerAfterNudge.y } : null,
        cornerAfterNudgeUndo: cornerAfterNudgeUndo ? { x: cornerAfterNudgeUndo.x, y: cornerAfterNudgeUndo.y } : null,
        canUndoAfter,
      };
    });

    expect(result.areaAfterDraw).toBeGreaterThan(0);
    expect(result.eventsAfterDraw).toBe(1);
    expect(result.cornerId).not.toBeNull();
    expect(result.hover).toEqual({ kind: 'point', id: result.cornerId });
    // Live-драг: override перетаскиваемой вершины, документ и производное не тронуты.
    expect(result.overrides).toEqual({ [result.cornerId!]: { x: 40, y: 40 } });
    expect(result.eventsDuringDrag).toBe(result.eventsAfterDraw);
    expect(result.areaDuringDrag).toBe(result.areaAfterDraw);
    // Отпускание — одна транзакция movePoints, комната пересобрана (площадь уменьшилась), выделена вершина.
    expect(result.kindAfterDrop).toBe('editing');
    expect(result.cornerAfterDrop).toEqual({ x: 40, y: 40 });
    expect(result.eventsAfterDrop).toBe(result.eventsAfterDraw + 1);
    expect(result.areaAfterDrop).toBeLessThan(result.areaAfterDraw);
    expect(result.selectionAfterDrop).toEqual({ kind: 'point', id: result.cornerId });
    // Undo — один шаг возвращает угол и площадь.
    expect(result.cornerAfterUndo).toEqual({ x: 10, y: 10 });
    expect(result.areaAfterUndo).toBe(result.areaAfterDraw);
    // Нудж: серия из трёх нажатий — одна запись; undo откатывает всю серию до рисования.
    expect(result.nudged).toEqual({ handled: true });
    expect(result.cornerAfterNudge).toEqual({ x: 12, y: 20 });
    expect(result.cornerAfterNudgeUndo).toEqual({ x: 10, y: 10 });
    expect(result.canUndoAfter).toBe(true);
  });
});
