import { expect, test as base, type Page } from '@playwright/test';
import type { PlannerInstance, ProjectionStats } from '@uyutno/planner';

import { PLANNER_READY_EVENT } from '../src/client/project/lib/plannerReadyEvent';

/**
 * Perf/leak-гвард планера (testing-strategy, слой 3; ADR 0015 A7): render-on-demand спит в покое,
 * resize и unmount не текут. Планер достаётся через dev-only событие `planner:ready` (`ProjectPage` →
 * `<Planner onReady />`): слушатель и реестр экземпляров принадлежат тесту (`addInitScript`), не приложению.
 */

interface E2ERegistry {
  planners: PlannerInstance[];
}

declare global {
  interface Window {
    __uyutnoE2E?: E2ERegistry;
  }
}

const PROJECT_URL = '/project/e2e-render-guard';
/** Бюджет кадров 5 при ~60 fps — ≈100 мс; запас, чтобы луп гарантированно уснул. */
const SETTLE_MS = 400;
const IDLE_MS = 1000;
const GL_DRIVER_PERFORMANCE_HINT = /GL Driver Message \(OpenGL, Performance,/;

const registry = (page: Page) => ({
  count: () => page.evaluate(() => window.__uyutnoE2E?.planners.length ?? 0),
  waitFor: (count: number) =>
    page.waitForFunction(expected => (window.__uyutnoE2E?.planners.length ?? 0) >= expected, count),
  stats: (index: number): Promise<ProjectionStats> =>
    page.evaluate(i => window.__uyutnoE2E!.planners[i]!.projection.getStats(), index),
  isRendering: (index: number) => page.evaluate(i => window.__uyutnoE2E!.planners[i]!.projection.isRendering, index),
  isDisposed: (index: number) => page.evaluate(i => window.__uyutnoE2E!.planners[i]!.projection.isDisposed, index),
  canvasSize: (index: number) =>
    page.evaluate(i => {
      const { canvas } = window.__uyutnoE2E!.planners[i]!.projection;
      const rect = canvas.getBoundingClientRect();
      const parent = canvas.parentElement!.getBoundingClientRect();
      return {
        cssWidth: rect.width,
        cssHeight: rect.height,
        parentWidth: parent.width,
        parentHeight: parent.height,
        bufferWidth: canvas.width,
        bufferHeight: canvas.height,
        dpr: window.devicePixelRatio,
      };
    }, index),
});

/** SPA-навигация без перезагрузки документа (react-router слушает `popstate`) — контекст и ссылки теста живут. */
const navigateInApp = (page: Page, path: string) =>
  page.evaluate(target => {
    window.history.pushState(null, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);

/**
 * Фикстура: страница проекта с поднятым планером и реестром экземпляров; после теста — консоль без ошибок и
 * WebGL-предупреждений. Performance-подсказки GL-драйвера headless Chromium («GPU stall due to ReadPixels» от
 * снятия скриншотов трассы) — шум окружения, не диагностика нашего кода; всё остальное про WebGL/three — ошибка.
 */
const test = base.extend<{ plannerPage: Page }>({
  plannerPage: async ({ page }, use) => {
    const consoleIssues: string[] = [];
    page.on('console', message => {
      const text = message.text();
      if (GL_DRIVER_PERFORMANCE_HINT.test(text)) return;
      if (message.type() === 'error' || message.type() === 'warning' || /WebGL|THREE\./.test(text)) {
        consoleIssues.push(`[${message.type()}] ${text}`);
      }
    });
    page.on('pageerror', error => consoleIssues.push(`[pageerror] ${error.message}`));

    await page.addInitScript(eventName => {
      const store: E2ERegistry = { planners: [] };
      window.__uyutnoE2E = store;
      window.addEventListener(eventName, event => {
        store.planners.push((event as CustomEvent<PlannerInstance>).detail);
      });
    }, PLANNER_READY_EVENT);

    await page.goto(PROJECT_URL);
    await registry(page).waitFor(1);
    await page.waitForTimeout(SETTLE_MS);

    await use(page);

    expect(consoleIssues, 'консоль без ошибок и WebGL-предупреждений').toEqual([]);
  },
});

test.describe('планер: render-on-demand и утечки', () => {
  test('канвас занимает контейнер целиком, буфер — под devicePixelRatio', async ({ plannerPage: page }) => {
    const size = await registry(page).canvasSize(0);
    expect(size.cssWidth).toBeCloseTo(size.parentWidth, 0);
    expect(size.cssHeight).toBeCloseTo(size.parentHeight, 0);
    // Буфер = CSS-размер × DPR (three: `floor`); ±1 px — субпиксельные округления rect vs contentRect.
    expect(Math.abs(size.bufferWidth - size.cssWidth * size.dpr)).toBeLessThanOrEqual(1);
    expect(Math.abs(size.bufferHeight - size.cssHeight * size.dpr)).toBeLessThanOrEqual(1);
  });

  test('idle FPS ≈ 0: после подъёма кадры отрисованы, за секунду покоя счётчик кадров не растёт', async ({
    plannerPage: page,
  }) => {
    const r = registry(page);
    const before = await r.stats(0);
    expect(before.frame, 'первые кадры после монтирования отрисованы').toBeGreaterThan(0);
    expect(await r.isRendering(0), 'луп уснул').toBe(false);

    await page.waitForTimeout(IDLE_MS);
    const after = await r.stats(0);
    expect(after.frame, 'в покое ни одного кадра').toBe(before.frame);
    expect(after).toMatchObject({ geometries: 0, textures: 0 });
  });

  test('resize перерисовывает и снова засыпает; память рендерера не растёт', async ({ plannerPage: page }) => {
    const r = registry(page);
    const before = await r.stats(0);

    await page.setViewportSize({ width: 768, height: 900 });
    await page.waitForTimeout(SETTLE_MS);
    const afterFirst = await r.stats(0);
    expect(afterFirst.frame, 'resize даёт кадры').toBeGreaterThan(before.frame);
    const firstSize = await r.canvasSize(0);
    expect(Math.abs(firstSize.bufferWidth - 768 * firstSize.dpr)).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 390, height: 700 });
    await page.waitForTimeout(SETTLE_MS);
    const afterSecond = await r.stats(0);
    expect(afterSecond.frame).toBeGreaterThan(afterFirst.frame);
    expect(await r.isRendering(0)).toBe(false);

    await page.waitForTimeout(IDLE_MS);
    const idle = await r.stats(0);
    expect(idle.frame, 'после resize луп снова спит').toBe(afterSecond.frame);
    expect(idle.geometries).toBe(before.geometries);
    expect(idle.textures).toBe(before.textures);
  });

  test('уход со страницы освобождает планер; повторный вход поднимает новый без утечек', async ({
    plannerPage: page,
  }) => {
    const r = registry(page);
    const before = await r.stats(0);

    await navigateInApp(page, '/');
    await expect.poll(() => r.isDisposed(0), { message: 'projection.dispose() после unmount' }).toBe(true);
    await expect(page.locator('canvas')).toHaveCount(0);

    await page.waitForTimeout(SETTLE_MS);
    const disposed = await r.stats(0);
    expect(disposed.frame, 'после dispose кадров нет').toBe(before.frame);
    expect(disposed).toMatchObject({ geometries: 0, textures: 0 });
    expect(await r.isRendering(0)).toBe(false);

    await navigateInApp(page, PROJECT_URL);
    await r.waitFor(2);
    await page.waitForTimeout(SETTLE_MS);
    expect(await r.count()).toBe(2);
    expect(await r.isDisposed(1)).toBe(false);
    const fresh = await r.stats(1);
    expect(fresh.frame).toBeGreaterThan(0);
    expect(fresh).toMatchObject({ geometries: 0, textures: 0 });

    await page.waitForTimeout(IDLE_MS);
    expect((await r.stats(1)).frame).toBe(fresh.frame);
    expect((await r.stats(0)).frame, 'старый планер после dispose не рендерит').toBe(before.frame);
  });
});
