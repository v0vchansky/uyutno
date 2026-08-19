import { expect, test as base, type Page } from '@playwright/test';
import type { PlannerInstance } from '@uyutno/planner';

import { PLANNER_READY_EVENT } from '../src/client/project/lib/plannerReadyEvent';

/**
 * E2E-смоук шага 2 для инструментов «Прямоугольная комната» и «Комната по точкам» (testing-strategy слой 4;
 * ADR 0019 E8, эпик 0050, задача 0058): в реальном браузере через dev-ручку `onReady` — `tools.start('rect' | 'room')`
 * + синтетические команды указателя в координатах плана (DOM-ввод и экран → план — вьювер 0056, здесь его нет) →
 * комната в `getDerived()` → undo → redo. Реестр экземпляров — у теста (`addInitScript`), как в
 * `planner-walls-tool.spec.ts`.
 */

interface E2ERegistry {
  planners: PlannerInstance[];
}

declare global {
  interface Window {
    __uyutnoE2E?: E2ERegistry;
  }
}

const PROJECT_URL = '/project/e2e-rect-and-room-tools';

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

test.describe('планер: «Прямоугольная комната» и «Комната по точкам» через tools (headless-команды в координатах плана)', () => {
  test("start('rect') → два клика по углам → полая комната; undo/redo через tools.key", async ({
    plannerPage: page,
  }) => {
    const result = await page.evaluate(() => {
      const { manager } = window.__uyutnoE2E!.planners[0]!;
      const { tools } = manager;
      const mods = { ctrl: false, meta: false, shift: false, alt: false };
      const click = (x: number, y: number) => {
        tools.pointerMove({ x, y, mods, button: 0 });
        tools.pointerDown({ x, y, mods, button: 0 });
        tools.pointerUp({ x, y, mods, button: 0 });
      };
      const rooms = () => manager.document.getDerived().floors[0]!.rooms.length;
      const walls = () => manager.document.getDerived().floors[0]!.walls.length;
      let documentEvents = 0;
      const off = manager.on('document:changed', () => documentEvents++);

      const started = tools.start('rect');
      const kindAfterStart = tools.get().kind;
      click(0, 0);
      tools.pointerMove({ x: 300, y: 400, mods, button: 0 });
      const drawing = tools.get();
      const previewQuads = drawing.kind === 'making-rect' ? drawing.preview.length : -1;
      const originAfterFirstClick = drawing.kind === 'making-rect' ? drawing.origin : null;
      click(300, 400);
      const kindAfterCommit = tools.get().kind;
      const roomsAfterCommit = rooms();
      const wallsAfterCommit = walls();
      const contours = manager.document.get().floors[0]!.layout.contours.map(c => [c.kind, c.points.length]);
      const canUndo = manager.history.get().canUndo;

      const undoHandled = tools.key({ kind: 'undo' }).handled;
      const roomsAfterUndo = rooms();
      const redoHandled = tools.key({ kind: 'redo' }).handled;
      const roomsAfterRedo = rooms();
      off();
      return {
        started,
        kindAfterStart,
        previewQuads,
        originAfterFirstClick,
        kindAfterCommit,
        roomsAfterCommit,
        wallsAfterCommit,
        contours,
        canUndo,
        undoHandled,
        roomsAfterUndo,
        redoHandled,
        roomsAfterRedo,
        documentEvents,
      };
    });

    expect(result.started).toEqual({ ok: true, value: undefined });
    expect(result.kindAfterStart).toBe('making-rect');
    expect(result.originAfterFirstClick).toEqual({ x: 0, y: 0 });
    // Обе стороны > 2 × толщины — живая полая комната: четыре квада превью.
    expect(result.previewQuads).toBe(4);
    expect(result.kindAfterCommit).toBe('editing');
    expect(result.contours).toEqual([
      ['outer', 4],
      ['inner', 4],
    ]);
    expect(result.roomsAfterCommit).toBe(1);
    expect(result.wallsAfterCommit).toBe(1);
    expect(result.canUndo).toBe(true);
    expect(result.undoHandled).toBe(true);
    expect(result.roomsAfterUndo).toBe(0);
    expect(result.redoHandled).toBe(true);
    expect(result.roomsAfterRedo).toBe(1);
    // Коммит — одна транзакция; undo и redo — по одной замене документа.
    expect(result.documentEvents).toBe(3);
  });

  test("start('room') → четыре вершины → замыкание у первой → комната без толщины; undo/redo", async ({
    plannerPage: page,
  }) => {
    const result = await page.evaluate(() => {
      const { manager } = window.__uyutnoE2E!.planners[0]!;
      const { tools } = manager;
      const mods = { ctrl: false, meta: false, shift: false, alt: false };
      const click = (x: number, y: number) => {
        tools.pointerMove({ x, y, mods, button: 0 });
        tools.pointerDown({ x, y, mods, button: 0 });
        tools.pointerUp({ x, y, mods, button: 0 });
      };
      const rooms = () => manager.document.getDerived().floors[0]!.rooms.length;

      const started = tools.start('room');
      const kindAfterStart = tools.get().kind;
      click(0, 0);
      click(400, 0);
      click(400, 300);
      click(0, 300);
      const drawing = tools.get();
      const pointsBeforeClose = drawing.kind === 'making-room' ? drawing.points.length : -1;
      // Курсор в радиусе снапа от первой вершины притягивается к ней; клик — замыкание по манхэттену.
      click(4, 3);
      const kindAfterClose = tools.get().kind;
      const roomsAfterCommit = rooms();
      const contours = manager.document.get().floors[0]!.layout.contours.map(c => [c.kind, c.points.length]);
      const undoHandled = tools.key({ kind: 'undo' }).handled;
      const roomsAfterUndo = rooms();
      const redoHandled = tools.key({ kind: 'redo' }).handled;
      const roomsAfterRedo = rooms();
      return {
        started,
        kindAfterStart,
        pointsBeforeClose,
        kindAfterClose,
        roomsAfterCommit,
        contours,
        undoHandled,
        roomsAfterUndo,
        redoHandled,
        roomsAfterRedo,
      };
    });

    expect(result.started).toEqual({ ok: true, value: undefined });
    expect(result.kindAfterStart).toBe('making-room');
    expect(result.pointsBeforeClose).toBe(4);
    expect(result.kindAfterClose).toBe('editing');
    expect(result.contours).toEqual([['inner', 4]]);
    expect(result.roomsAfterCommit).toBe(1);
    expect(result.undoHandled).toBe(true);
    expect(result.roomsAfterUndo).toBe(0);
    expect(result.redoHandled).toBe(true);
    expect(result.roomsAfterRedo).toBe(1);
  });

  test('цепочка ADR E8: прямоугольник → комната по точкам рядом → две комнаты; undo снимает только вторую, redo возвращает', async ({
    plannerPage: page,
  }) => {
    const result = await page.evaluate(() => {
      const { manager } = window.__uyutnoE2E!.planners[0]!;
      const { tools } = manager;
      const mods = { ctrl: false, meta: false, shift: false, alt: false };
      const click = (x: number, y: number) => {
        tools.pointerMove({ x, y, mods, button: 0 });
        tools.pointerDown({ x, y, mods, button: 0 });
        tools.pointerUp({ x, y, mods, button: 0 });
      };
      const rooms = () => manager.document.getDerived().floors[0]!.rooms.length;
      let documentEvents = 0;
      const off = manager.on('document:changed', () => documentEvents++);

      tools.start('rect');
      click(0, 0);
      click(300, 400);
      const roomsAfterRect = rooms();
      tools.start('room');
      click(400, 0);
      click(700, 0);
      click(700, 300);
      click(400, 300);
      click(400, 0);
      const kindAfterRoom = tools.get().kind;
      const roomsAfterRoom = rooms();
      tools.key({ kind: 'undo' });
      const roomsAfterUndo = rooms();
      tools.key({ kind: 'redo' });
      const roomsAfterRedo = rooms();
      off();
      return { roomsAfterRect, kindAfterRoom, roomsAfterRoom, roomsAfterUndo, roomsAfterRedo, documentEvents };
    });

    expect(result.roomsAfterRect).toBe(1);
    expect(result.kindAfterRoom).toBe('editing');
    expect(result.roomsAfterRoom).toBe(2);
    expect(result.roomsAfterUndo).toBe(1);
    expect(result.roomsAfterRedo).toBe(2);
    // Два коммита + undo + redo — по одной замене документа на каждый.
    expect(result.documentEvents).toBe(4);
  });
});
