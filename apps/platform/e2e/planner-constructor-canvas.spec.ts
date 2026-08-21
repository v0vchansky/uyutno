import { expect, test as base, type Page } from '@playwright/test';
import type { HitTarget, Id, PlanPosition, PlannerInstance, Viewport, ViewportInsets } from '@uyutno/planner';

import { PLANNER_READY_EVENT } from '../src/client/project/lib/plannerReadyEvent';
import { ensureProjectUrl } from './support/projects';

/**
 * E2E-смоук вьювера конструктора **реальной мышью** (testing-strategy слой 4; ADR 0020 P1/P3/P4, задача 0056):
 * DOM-ввод канваса, пересчёт экран → план и локальная камера проверяются целиком, от `page.mouse` до документа.
 * Программно зовётся только `tools.start('walls')` — панели инструментов ещё нет (она в 0061), всё остальное
 * делает мышь и клавиатура. Реестр экземпляров — у теста (`addInitScript`), как в `planner-render-guard.spec.ts`.
 *
 * Порог, из-за которого координаты кликов такие крупные: минимальная длина стены — 15 см (спека 01
 * «Ограничения»), а при базовом зуме `scale = 1` это 15 CSS px. Контур 200 × 140 px берётся с запасом.
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
const PROJECT_NAME = 'e2e · вьювер конструктора';
/** Полуоси рисуемого прямоугольника от центра холста, CSS px: контур 200 × 140 px = 200 × 140 см при `scale = 1`. */
const HALF_WIDTH = 100;
const HALF_HEIGHT = 70;
/** Экранный сдвиг угла при драге, CSS px: больше `DRAG_THRESHOLD` (3 px) и дальше `SNAP_DIST` (10 px) от чужих осей. */
const DRAG_DX = 60;
const DRAG_DY = 40;
/** Секунда покоя — тот же бюджет, что в perf-гварде. */
const IDLE_MS = 1000;

/**
 * `planToView`/`viewToPlan` не в публичном API пакета (`document/geometry/viewport.ts` — слой ядра), поэтому
 * пересчёт продублирован здесь арифметикой. Это и есть смысл проверки: тест считает независимо от проекции.
 */
const planToView = (viewport: Viewport, point: PlanPosition): PlanPosition => ({
  x: (point.x - viewport.center.x) * viewport.scale + viewport.width / 2,
  y: viewport.height / 2 - (point.y - viewport.center.y) * viewport.scale,
});

const viewToPlan = (viewport: Viewport, screen: PlanPosition): PlanPosition => ({
  x: (screen.x - viewport.width / 2) / viewport.scale + viewport.center.x,
  y: viewport.center.y - (screen.y - viewport.height / 2) / viewport.scale,
});

/** Ручки к поднятому планеру: всё, что тест читает из движка и проекции. */
const planner = (page: Page) => ({
  /** Единственный программный вызов инструментов — панели ещё нет (0061). */
  startWalls: () => page.evaluate(() => window.__uyutnoE2E!.planners[0]!.manager.tools.start('walls')),
  toolKind: () => page.evaluate(() => window.__uyutnoE2E!.planners[0]!.manager.tools.get().kind),
  hover: (): Promise<HitTarget | null> =>
    page.evaluate(() => {
      const state = window.__uyutnoE2E!.planners[0]!.manager.tools.get();
      return state.kind === 'editing' ? state.hover : null;
    }),
  rooms: () =>
    page.evaluate(() => window.__uyutnoE2E!.planners[0]!.manager.document.getDerived().floors[0]!.rooms.length),
  points: (): Promise<{ id: Id; x: number; y: number }[]> =>
    page.evaluate(() =>
      Object.values(window.__uyutnoE2E!.planners[0]!.manager.document.get().floors[0]!.layout.points).map(point => ({
        id: point.id,
        x: point.x,
        y: point.y,
      })),
    ),
  canUndo: () => page.evaluate(() => window.__uyutnoE2E!.planners[0]!.manager.history.get().canUndo),
  viewport: (): Promise<Viewport> =>
    page.evaluate(() => window.__uyutnoE2E!.planners[0]!.projections.canvas2d.getViewport()),
  /** Полосы холста под непрозрачными панелями скина (0061) — их сообщает скин, тест их не выдумывает. */
  insets: (): Promise<ViewportInsets> =>
    page.evaluate(() => window.__uyutnoE2E!.planners[0]!.projections.canvas2d.getViewportInsets()),
  zoomIndex: () => page.evaluate(() => window.__uyutnoE2E!.planners[0]!.projections.canvas2d.getZoom().index),
  frames: () => page.evaluate(() => window.__uyutnoE2E!.planners[0]!.projections.canvas2d.getStats().frame),
  isRendering: () => page.evaluate(() => window.__uyutnoE2E!.planners[0]!.projections.canvas2d.isRendering),
});

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

test.describe('планер: конструктор реальной мышью по холсту', () => {
  test('«Стены» → контур кликами → комната; hover, драг угла, зум колесом, пан ПКМ; в покое кадров нет', async ({
    plannerPage: page,
  }) => {
    const app = planner(page);
    // Холст конструктора — единственная графика с текстовым описанием плана (решение 22): `role="img"` + `aria-label`.
    const canvas = page.getByRole('img');
    await expect(canvas).toHaveAttribute('aria-label', /^план: 0 комнат,/);

    const box = (await canvas.boundingBox())!;
    expect(box, 'холст конструктора виден и измерим').not.toBeNull();
    /** Локальные координаты холста → координаты страницы для `page.mouse`. */
    const at = (local: PlanPosition) => ({ x: box.x + local.x, y: box.y + local.y });

    /*
     * Мышью тест работает только по **свободной** части холста: панели скина (0061) — непрозрачные оверлеи
     * поверх канваса во всю его ширину, и в закрытых полосах `pointermove`/`click` уходят в кнопку панели,
     * а не в канвас. Границы берутся у самого скина (`getViewportInsets`), а не подбираются на глаз.
     */
    const insets = await app.insets();
    expect(insets.left, 'скин сообщил проекции свою левую полосу').toBeGreaterThan(0);
    const free = {
      left: insets.left,
      top: insets.top,
      right: box.width - insets.right,
      bottom: box.height - insets.bottom,
    };
    const center = { x: (free.left + free.right) / 2, y: (free.top + free.bottom) / 2 };
    expect(
      Math.min(free.right - free.left, free.bottom - free.top),
      'свободной части хватает на контур с запасом',
    ).toBeGreaterThan(2 * Math.max(HALF_WIDTH, HALF_HEIGHT));
    // Обход против часовой в осях плана (`y` вверх): снизу-слева → вправо → вверх → влево.
    const corners: PlanPosition[] = [
      { x: center.x - HALF_WIDTH, y: center.y + HALF_HEIGHT },
      { x: center.x + HALF_WIDTH, y: center.y + HALF_HEIGHT },
      { x: center.x + HALF_WIDTH, y: center.y - HALF_HEIGHT },
      { x: center.x - HALF_WIDTH, y: center.y - HALF_HEIGHT },
    ];

    let cornerId: Id = '';
    let cornerBefore: PlanPosition = { x: 0, y: 0 };

    await test.step('включить «Стены» и нарисовать контур реальными кликами', async () => {
      expect(await app.startWalls()).toEqual({ ok: true, value: undefined });
      expect(await app.toolKind()).toBe('making-walls');

      for (const corner of corners) {
        const point = at(corner);
        await page.mouse.click(point.x, point.y);
      }
      // Замыкание петли — клик в первую точку: курсор в радиусе снапа притягивается к ней ровно.
      const first = at(corners[0]!);
      await page.mouse.click(first.x, first.y);

      await expect
        .poll(() => app.toolKind(), { message: 'после замыкания автомат вернулся в editing' })
        .toBe('editing');
      await expect.poll(() => app.rooms(), { message: 'комната собрана из ленты стен' }).toBe(1);
      await expect(canvas, 'описание плана обновилось').toHaveAttribute('aria-label', /^план: 1 комната, /);
    });

    await test.step('навести мышь на угловую точку — hover и курсор grab', async () => {
      // Сначала увести курсор в пустоту: после замыкания он стоит ровно на первой точке. Пустота берётся в
      // свободной части холста — в левом верхнем углу канваса лежат рейл и панель инструментов, и указатель
      // до канваса там не доходит вовсе.
      const empty = at({ x: free.right - 40, y: free.top + 40 });
      await page.mouse.move(empty.x, empty.y);
      await expect.poll(() => app.hover(), { message: 'над пустым холстом наведения нет' }).toBeNull();
      await expect.poll(() => canvas.evaluate(element => element.style.cursor)).toBe('default');

      // Угол, который кликали первым, обязан быть вершиной документа: экран → план → документ сошлись.
      const viewport = await app.viewport();
      const expected = viewToPlan(viewport, corners[0]!);
      const nearest = (await app.points()).reduce((best, point) =>
        Math.hypot(point.x - expected.x, point.y - expected.y) < Math.hypot(best.x - expected.x, best.y - expected.y)
          ? point
          : best,
      );
      expect(
        Math.hypot(nearest.x - expected.x, nearest.y - expected.y),
        'кликнутый угол попал в документ',
      ).toBeLessThan(1);
      cornerId = nearest.id;
      cornerBefore = { x: nearest.x, y: nearest.y };

      const screen = at(planToView(viewport, cornerBefore));
      await page.mouse.move(screen.x, screen.y);
      await expect
        .poll(() => app.hover(), { message: 'вершина под курсором' })
        .toEqual({ kind: 'point', id: cornerId });
      await expect.poll(() => canvas.evaluate(element => element.style.cursor)).toBe('grab');
    });

    await test.step('перетащить угол мышью — координата в документе изменилась, undo возвращает', async () => {
      const viewport = await app.viewport();
      const from = at(planToView(viewport, cornerBefore));
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (const step of [1 / 3, 2 / 3, 1]) {
        await page.mouse.move(from.x + DRAG_DX * step, from.y + DRAG_DY * step);
      }
      await expect.poll(() => app.toolKind(), { message: 'порог драга пройден' }).toBe('dragging-point');
      await page.mouse.up();

      await expect.poll(() => app.toolKind()).toBe('editing');
      const dropped = viewToPlan(viewport, { x: from.x - box.x + DRAG_DX, y: from.y - box.y + DRAG_DY });
      const moved = (await app.points()).find(point => point.id === cornerId)!;
      expect(moved, 'перетащенная вершина жива').toBeDefined();
      expect(moved.x, 'вершина уехала по x').not.toBeCloseTo(cornerBefore.x, 1);
      expect(moved.y, 'вершина уехала по y').not.toBeCloseTo(cornerBefore.y, 1);
      // Вершина легла туда, где отпустили мышь (допуск — снап и квантование документа).
      expect(Math.hypot(moved.x - dropped.x, moved.y - dropped.y), 'вершина легла под курсором').toBeLessThan(2);

      expect(await app.canUndo(), 'драг записан в историю одной записью').toBe(true);
      await page.keyboard.press('Control+z');
      await expect
        .poll(async () => (await app.points()).find(point => point.id === cornerId)?.x, { message: 'undo вернул угол' })
        .toBeCloseTo(cornerBefore.x, 1);
    });

    await test.step('зум колесом: шаг шкалы +1, точка плана под курсором осталась под курсором', async () => {
      const anchorLocal: PlanPosition = { x: center.x + 150, y: center.y - 40 };
      const anchorPage = at(anchorLocal);
      await page.mouse.move(anchorPage.x, anchorPage.y);

      const before = await app.viewport();
      const indexBefore = await app.zoomIndex();
      const anchorPlan = viewToPlan(before, anchorLocal);

      await page.mouse.wheel(0, -100);
      await expect.poll(() => app.zoomIndex(), { message: 'колесо вперёд — один шаг шкалы' }).toBe(indexBefore + 1);

      const after = await app.viewport();
      expect(after.scale, 'масштаб вырос').toBeGreaterThan(before.scale);
      const anchorAfter = planToView(after, anchorPlan);
      expect(anchorAfter.x, 'точка плана под курсором по x').toBeCloseTo(anchorLocal.x, 1);
      expect(anchorAfter.y, 'точка плана под курсором по y').toBeCloseTo(anchorLocal.y, 1);
    });

    await test.step('пан правой кнопкой сдвигает центр viewport', async () => {
      const before = await app.viewport();
      const from = at({ x: center.x, y: center.y });
      const shift = { x: -90, y: 55 };

      await page.mouse.move(from.x, from.y);
      await page.mouse.down({ button: 'right' });
      for (const step of [0.5, 1]) {
        await page.mouse.move(from.x + shift.x * step, from.y + shift.y * step);
      }
      await page.mouse.up({ button: 'right' });

      await expect
        .poll(async () => (await app.viewport()).center.x, { message: 'центр уехал по x' })
        .toBeCloseTo(before.center.x - shift.x / before.scale, 1);
      const after = await app.viewport();
      expect(after.center.y, 'центр уехал по y').toBeCloseTo(before.center.y + shift.y / before.scale, 1);
      expect(after.scale, 'пан не трогает масштаб').toBe(before.scale);
    });

    await test.step('после всех жестов холст засыпает', async () => {
      await expect.poll(() => app.isRendering(), { message: 'луп конструктора уснул' }).toBe(false);
      const frames = await app.frames();
      await page.waitForTimeout(IDLE_MS);
      expect(await app.frames(), 'в покое ни одного кадра').toBe(frames);
    });
  });
});
