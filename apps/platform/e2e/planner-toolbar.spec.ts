import { expect, test as base, type Page } from '@playwright/test';
import type { PlannerInstance, Viewport, ViewportInsets } from '@uyutno/planner';

import { PLANNER_READY_EVENT } from '../src/client/project/lib/plannerReadyEvent';
import { ensureProjectUrl } from './support/projects';

/**
 * E2E-смоук шага 2 **через UI** (testing-strategy слой 4; задача 0061): весь путь идёт кнопками скина и реальной
 * мышью — инструмент выбирается кнопкой панели, контур рисуется по холсту, отмена и повтор нажимаются кнопками
 * (маршрут `tools.key`, тот же, что у клавиш), вид переключается кнопкой рейла. Движок читается только на
 * ассертах, через dev-ручку `onReady`; программных вызовов команд в сценарии нет — в этом и смысл спеки.
 *
 * Координаты кликов крупные по той же причине, что в `planner-constructor-canvas.spec.ts`: минимальная длина
 * стены 15 см = 15 CSS px при базовом зуме `scale = 1`.
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
const PROJECT_NAME = 'e2e · панель инструментов';
/** Полуоси рисуемого прямоугольника от центра холста, CSS px: контур 200 × 140 px = 200 × 140 см при `scale = 1`. */
const HALF_WIDTH = 100;
const HALF_HEIGHT = 70;

const planner = (page: Page) => ({
  toolKind: () => page.evaluate(() => window.__uyutnoE2E!.planners[0]!.manager.tools.get().kind),
  activeView: () => page.evaluate(() => window.__uyutnoE2E!.planners[0]!.manager.view.get().activeView),
  rooms: () =>
    page.evaluate(() => window.__uyutnoE2E!.planners[0]!.manager.document.getDerived().floors[0]!.rooms.length),
  snapFlags: () => page.evaluate(() => ({ ...window.__uyutnoE2E!.planners[0]!.manager.tools.get().snapFlags })),
  units: () => page.evaluate(() => window.__uyutnoE2E!.planners[0]!.manager.document.get().settings.units),
  zoomIndex: () => page.evaluate(() => window.__uyutnoE2E!.planners[0]!.projections.canvas2d.getZoom().index),
  insets: (): Promise<ViewportInsets> =>
    page.evaluate(() => window.__uyutnoE2E!.planners[0]!.projections.canvas2d.getViewportInsets()),
  viewport: (): Promise<Viewport> =>
    page.evaluate(() => window.__uyutnoE2E!.planners[0]!.projections.canvas2d.getViewport()),
  points: (): Promise<{ x: number; y: number }[]> =>
    page.evaluate(() =>
      Object.values(window.__uyutnoE2E!.planners[0]!.manager.document.get().floors[0]!.layout.points).map(point => ({
        x: point.x,
        y: point.y,
      })),
    ),
});

/** Экранный прямоугольник всей геометрии этажа в CSS px холста — арифметика `planToView`, как в 0056. */
const planOnScreen = (
  viewport: Viewport,
  points: { x: number; y: number }[],
): { left: number; top: number; right: number; bottom: number } => {
  const xs = points.map(point => (point.x - viewport.center.x) * viewport.scale + viewport.width / 2);
  const ys = points.map(point => viewport.height / 2 - (point.y - viewport.center.y) * viewport.scale);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
};

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
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(await ensureProjectUrl(request, PROJECT_NAME));
    await page.waitForFunction(() => (window.__uyutnoE2E?.planners.length ?? 0) >= 1);
    await use(page);
    expect(pageErrors, 'страница без исключений').toEqual([]);
  },
});

/**
 * Центр **свободной** части холста в координатах страницы: панели скина — непрозрачные оверлеи поверх канваса
 * во всю его ширину, и в закрытых полосах клик уходит в кнопку панели, а не в холст. Границы спрашиваются у
 * самого скина (`getViewportInsets`) — теми же числами он вписывает план камерой, — а не подбираются на глаз.
 */
const freeCanvasCentre = async (page: Page): Promise<{ x: number; y: number }> => {
  const box = await page.locator('canvas[role="img"]').boundingBox();
  expect(box, 'канвас конструктора на странице').not.toBeNull();
  const insets = await planner(page).insets();
  expect(insets.left, 'скин сообщил проекции свою левую полосу').toBeGreaterThan(0);
  const free = {
    left: insets.left,
    top: insets.top,
    right: box!.width - insets.right,
    bottom: box!.height - insets.bottom,
  };
  expect(
    Math.min(free.right - free.left, free.bottom - free.top),
    'свободной части хватает на контур с запасом',
  ).toBeGreaterThan(2 * Math.max(HALF_WIDTH, HALF_HEIGHT));
  return { x: box!.x + (free.left + free.right) / 2, y: box!.y + (free.top + free.bottom) / 2 };
};

test.describe('планер: панель инструментов конструктора через UI', () => {
  test('инструмент кнопкой → комната мышью → отмена и повтор кнопками', async ({ plannerPage: page }) => {
    const api = planner(page);
    const centre = await freeCanvasCentre(page);

    const undo = page.getByRole('button', { name: 'Отменить' });
    const redo = page.getByRole('button', { name: 'Повторить' });
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    await page.getByRole('button', { name: 'Прямоугольная комната' }).click();
    expect(await api.toolKind()).toBe('making-rect');

    await page.mouse.click(centre.x - HALF_WIDTH, centre.y - HALF_HEIGHT);
    await page.mouse.move(centre.x + HALF_WIDTH, centre.y + HALF_HEIGHT);
    await page.mouse.click(centre.x + HALF_WIDTH, centre.y + HALF_HEIGHT);

    expect(await api.toolKind()).toBe('editing');
    expect(await api.rooms()).toBe(1);
    await expect(undo).toBeEnabled();

    await undo.click();
    expect(await api.rooms()).toBe(0);
    await expect(redo).toBeEnabled();

    await redo.click();
    expect(await api.rooms()).toBe(1);
  });

  test('рейл: переключение конструктор ↔ 2D-план, оверлеи конструктора уходят вместе с видом', async ({
    plannerPage: page,
  }) => {
    const api = planner(page);
    const toolPanel = page.getByRole('button', { name: 'Прямоугольная комната' });
    await expect(toolPanel).toBeVisible();
    expect(await api.activeView()).toBe('constructor');

    await page.getByRole('button', { name: '2D-план' }).click();
    expect(await api.activeView()).toBe('plan');
    await expect(toolPanel).toBeHidden();

    await page.getByRole('button', { name: 'Конструктор стен' }).click();
    expect(await api.activeView()).toBe('constructor');
    await expect(toolPanel).toBeVisible();
  });

  test('тумблеры снапа, зум и единицы — кнопками скина', async ({ plannerPage: page }) => {
    const api = planner(page);
    expect(await api.snapFlags()).toEqual({
      pointsSnap: true,
      pointsAlign: true,
      orthoAlign: false,
      bisectorAlign: true,
    });

    await page.getByRole('switch', { name: 'Ровно по горизонтали и вертикали' }).click();
    expect((await api.snapFlags()).orthoAlign).toBe(true);

    await page.getByRole('switch', { name: 'Липнуть к углам' }).click();
    expect((await api.snapFlags()).pointsSnap).toBe(false);

    const before = await api.zoomIndex();
    await page.getByRole('button', { name: 'Приблизить' }).click();
    expect(await api.zoomIndex()).toBe(before + 1);
    await page.getByRole('button', { name: 'Отдалить' }).click();
    expect(await api.zoomIndex()).toBe(before);

    expect(await api.units()).toBe('cm');
    // Сегменты единиц — обычные кнопки с `aria-pressed`, а не `radiogroup`: паттерн radiogroup обещает навигацию
    // стрелками, а слушателей клавиатуры в скине быть не может (ADR 0019 E5).
    // `exact: true` обязателен: по умолчанию имя ищется подстрокой, и «Метры» совпало бы ещё и с «Миллиметры».
    await page.getByRole('button', { name: 'Метры', exact: true }).click();
    expect(await api.units()).toBe('m');
  });

  /*
   * Стык 0060/0061: панели — оверлеи поверх холста во всю его ширину, поэтому «в центр» обязан вписывать план в
   * видимую часть. Без insets камеры план центруется по всему кадру, и его левый край уезжает под панель
   * инструментов — оттуда геометрию не достать ни кликом, ни взглядом.
   */
  test('«в центр» вписывает план в свободную часть холста, а не под панели', async ({ plannerPage: page }) => {
    const api = planner(page);
    const centre = await freeCanvasCentre(page);
    const box = (await page.locator('canvas[role="img"]').boundingBox())!;

    await page.getByRole('button', { name: 'Прямоугольная комната' }).click();
    await page.mouse.click(centre.x - HALF_WIDTH, centre.y - HALF_HEIGHT);
    await page.mouse.move(centre.x + HALF_WIDTH, centre.y + HALF_HEIGHT);
    await page.mouse.click(centre.x + HALF_WIDTH, centre.y + HALF_HEIGHT);
    expect(await api.rooms()).toBe(1);

    await page.getByRole('button', { name: 'Показать весь план' }).click();

    const insets = await api.insets();
    const plan = planOnScreen(await api.viewport(), await api.points());
    expect(plan.left, 'левый край плана не под рейлом и панелью').toBeGreaterThanOrEqual(insets.left);
    expect(plan.top, 'верхний край плана в видимой части').toBeGreaterThanOrEqual(insets.top);
    expect(plan.right, 'правый край плана в видимой части').toBeLessThanOrEqual(box.width - insets.right);
    expect(plan.bottom, 'нижний край плана не под полосой подсказок').toBeLessThanOrEqual(box.height - insets.bottom);
  });
});
