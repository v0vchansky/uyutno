import { expect, test as base, type Page } from '@playwright/test';
import type { PlannerInstance } from '@uyutno/planner';

import { PLANNER_READY_EVENT } from '../src/client/project/lib/plannerReadyEvent';
import { ensureProjectUrl } from './support/projects';

/**
 * E2E-смоук автомата инструментов (testing-strategy слой 4; ADR 0019 E8, задача 0057): в реальном браузере через
 * dev-ручку `onReady` — `tools.start('walls')` + синтетические команды указателя в координатах плана (DOM-ввод и
 * экран → план — вьювер 0056, здесь его нет) → комната в `getDerived()` → undo → redo. Реестр экземпляров — у теста
 * (`addInitScript`), как в `planner-render-guard.spec.ts`.
 */

interface E2ERegistry {
  planners: PlannerInstance[];
}

declare global {
  interface Window {
    __uyutnoE2E?: E2ERegistry;
  }
}

/**
 * Проект спеки заводится через API и переиспользуется прогонами: с задачи 0085 редактор открывает
 * настоящий проект, а выдуманный id даёт 404-страницу (`e2e/support/projects.ts`).
 */
const PROJECT_NAME = 'e2e · инструмент «Стены»';

const test = base.extend<{ plannerPage: Page }>({
  plannerPage: async ({ page, request }, use) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.addInitScript(eventName => {
      const store: E2ERegistry = { planners: [] };
      window.__uyutnoE2E = store;
      window.addEventListener(eventName, event => {
        store.planners.push((event as CustomEvent<PlannerInstance>).detail);
      });
    }, PLANNER_READY_EVENT);
    await page.goto(await ensureProjectUrl(request, PROJECT_NAME));
    await page.waitForFunction(() => (window.__uyutnoE2E?.planners.length ?? 0) >= 1);
    await use(page);
    expect(pageErrors, 'страница без исключений').toEqual([]);
  },
});

test.describe('планер: инструмент «Стены» через tools (headless-команды в координатах плана)', () => {
  test('start → клики по углам → замыкание у первой точки → комната; undo/redo через tools.key', async ({
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
      let toolsEvents = 0;
      const off = manager.on('tools:changed', () => toolsEvents++);

      const started = tools.start('walls');
      const kindAfterStart = tools.get().kind;
      click(0, 0);
      click(400, 0);
      click(400, 300);
      click(0, 300);
      const drawing = tools.get();
      const pointsBeforeClose = drawing.kind === 'making-walls' ? drawing.points.length : -1;
      // Курсор в радиусе снапа от первой точки притягивается к ней; клик — замыкание петли.
      click(4, 3);
      const kindAfterClose = tools.get().kind;
      const roomsAfterCommit = rooms();
      const wallsAfterCommit = walls();
      const canUndo = manager.history.get().canUndo;

      const undoHandled = tools.key({ kind: 'undo' }).handled;
      const roomsAfterUndo = rooms();
      const redoHandled = tools.key({ kind: 'redo' }).handled;
      const roomsAfterRedo = rooms();
      off();
      return {
        started,
        kindAfterStart,
        pointsBeforeClose,
        kindAfterClose,
        roomsAfterCommit,
        wallsAfterCommit,
        canUndo,
        undoHandled,
        roomsAfterUndo,
        redoHandled,
        roomsAfterRedo,
        toolsEvents,
      };
    });

    expect(result.started).toEqual({ ok: true, value: undefined });
    expect(result.kindAfterStart).toBe('making-walls');
    expect(result.pointsBeforeClose).toBe(4);
    expect(result.kindAfterClose).toBe('editing');
    expect(result.roomsAfterCommit).toBe(1);
    // Четыре квада ленты после normalize — одно тело стен (outer) и одна комната.
    expect(result.wallsAfterCommit).toBe(1);
    expect(result.canUndo).toBe(true);
    expect(result.undoHandled).toBe(true);
    expect(result.roomsAfterUndo).toBe(0);
    expect(result.redoHandled).toBe(true);
    expect(result.roomsAfterRedo).toBe(1);
    // start + 5 кликов × (move/down/up) — событий много, но конечное число: каждое изменение состояния — одно событие.
    expect(result.toolsEvents).toBeGreaterThan(5);
  });
});
