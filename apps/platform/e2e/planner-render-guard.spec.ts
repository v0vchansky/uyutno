import { expect, test as base, type Page } from '@playwright/test';
import type { Canvas2dStats, PlannerInstance, PlannerProjections, ProjectionStats, ViewKind } from '@uyutno/planner';

import { PLANNER_READY_EVENT } from '../src/client/project/lib/plannerReadyEvent';
import { ensureProjectUrl } from './support/projects';

/**
 * Perf/leak-гвард планера (testing-strategy, слой 3; ADR 0015 A7, ADR 0020 P5/P7): обе проекции спят в покое,
 * приостановленная не рисует ни кадра, resize/переключение вида дают конечное число кадров, unmount не течёт.
 * Планер достаётся через dev-only событие `planner:ready` (`ProjectPage` → `<Planner onReady />`): слушатель и
 * реестр экземпляров принадлежат тесту (`addInitScript`), не приложению.
 *
 * Новый документ открывается в конструкторе, поэтому «рабочая» проекция здесь — `canvas2d`, а Three приостановлена
 * (`ProjectionGate`): её счётчик кадров обязан стоять на нуле, пока активен не её вид.
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
 * Проект спеки заводится через API и переиспользуется прогонами: с задачи 0085 редактор открывает настоящий
 * проект, а выдуманный id даёт 404-страницу (`e2e/support/projects.ts`). Адрес нужен и фикстуре, и телу теста
 * (возврат в редактор через `navigateInApp`), поэтому он живёт переменной, которую заполняет фикстура.
 */
const PROJECT_NAME = 'e2e · render-guard';
let PROJECT_URL = '';
/** Бюджет кадров 5 при ~60 fps — ≈100 мс; запас, чтобы луп гарантированно уснул. */
const SETTLE_MS = 400;
const IDLE_MS = 1000;
/** `FRAME_BUDGET` из `RenderLoop`: один `invalidate()` — не больше стольких подряд идущих кадров. */
const FRAME_BUDGET = 5;
const GL_DRIVER_PERFORMANCE_HINT = /GL Driver Message \(OpenGL, Performance,/;

/** Метрики канваса: CSS-размер, размер контейнера, буфер отрисовки и DPR. */
interface CanvasMetrics {
  cssWidth: number;
  cssHeight: number;
  parentWidth: number;
  parentHeight: number;
  bufferWidth: number;
  bufferHeight: number;
  dpr: number;
}

const registry = (page: Page) => ({
  count: () => page.evaluate(() => window.__uyutnoE2E?.planners.length ?? 0),
  waitFor: (count: number) =>
    page.waitForFunction(expected => (window.__uyutnoE2E?.planners.length ?? 0) >= expected, count),
  three: (index: number): Promise<ProjectionStats> =>
    page.evaluate(i => window.__uyutnoE2E!.planners[i]!.projections.three.getStats(), index),
  canvas2d: (index: number): Promise<Canvas2dStats> =>
    page.evaluate(i => window.__uyutnoE2E!.planners[i]!.projections.canvas2d.getStats(), index),
  isRendering: (index: number, which: keyof PlannerProjections) =>
    page.evaluate(({ index: i, which: key }) => window.__uyutnoE2E!.planners[i]!.projections[key].isRendering, {
      index,
      which,
    }),
  isDisposed: (index: number, which: keyof PlannerProjections) =>
    page.evaluate(({ index: i, which: key }) => window.__uyutnoE2E!.planners[i]!.projections[key].isDisposed, {
      index,
      which,
    }),
  isActive: (index: number, which: keyof PlannerProjections) =>
    page.evaluate(({ index: i, which: key }) => window.__uyutnoE2E!.planners[i]!.projections[key].isActive, {
      index,
      which,
    }),
  metrics: (index: number, which: keyof PlannerProjections): Promise<CanvasMetrics> =>
    page.evaluate(
      ({ index: i, which: key }) => {
        const { canvas } = window.__uyutnoE2E!.planners[i]!.projections[key];
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
      },
      { index, which },
    ),
  /** Панели видов ещё нет (она в 0061) — вид переключается командой фасада через dev-ручку. */
  setView: (index: number, view: ViewKind) =>
    page.evaluate(({ index: i, view: kind }) => window.__uyutnoE2E!.planners[i]!.manager.view.setActive(kind), {
      index,
      view,
    }),
  /** Панели инструментов тоже нет (0061) — инструмент включается той же ручкой. */
  startWalls: (index: number) =>
    page.evaluate(i => window.__uyutnoE2E!.planners[i]!.manager.tools.start('walls'), index),
});

/** SPA-навигация без перезагрузки документа (react-router слушает `popstate`) — контекст и ссылки теста живут. */
const navigateInApp = (page: Page, path: string) =>
  page.evaluate(target => {
    window.history.pushState(null, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);

/** Буфер = CSS-размер × DPR (three: `floor`, canvas2d: `round`); ±1 px — субпиксельные округления rect vs contentRect. */
const expectBufferMatchesCss = (metrics: CanvasMetrics, name: string): void => {
  expect(
    Math.abs(metrics.bufferWidth - metrics.cssWidth * metrics.dpr),
    `${name}: буфер по ширине × DPR`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(metrics.bufferHeight - metrics.cssHeight * metrics.dpr),
    `${name}: буфер по высоте × DPR`,
  ).toBeLessThanOrEqual(1);
};

/**
 * Обе ширины resize'а — **выше порога входа в редактор** (1024px, задача 0088): ниже него оболочка отдаёт
 * заглушку «Редактор работает на компьютере» и планер не монтируется вовсе, так что мерить на 768 и 390 стало
 * нечего. Порог проверяется своей вёрсткой, а этот гвард — про кадры и память.
 */
const FIRST_RESIZE_WIDTH = 1200;
const SECOND_RESIZE_WIDTH = 1100;

/**
 * Ширина холста при ширине окна `viewportWidth`: рамка холста (задача 0088) забирает по 8px внешнего отступа и
 * по 1px рамки с каждой стороны. Канвасы занимают эту рамку целиком (ADR 0020 P6).
 */
const CANVAS_FRAME_INSET = 2 * (8 + 1);
const canvasWidthAt = (viewportWidth: number): number => viewportWidth - CANVAS_FRAME_INSET;

/** Активный (видимый) канвас: CSS-размер равен контейнеру, буфер — под DPR. */
const expectFillsContainer = (metrics: CanvasMetrics, name: string): void => {
  expect(metrics.cssWidth, `${name}: ширина по контейнеру`).toBeCloseTo(metrics.parentWidth, 0);
  expect(metrics.cssHeight, `${name}: высота по контейнеру`).toBeCloseTo(metrics.parentHeight, 0);
  expectBufferMatchesCss(metrics, name);
};

/**
 * Фикстура: страница проекта с поднятым планером и реестром экземпляров; после теста — консоль без ошибок и
 * WebGL-предупреждений. Performance-подсказки GL-драйвера headless Chromium («GPU stall due to ReadPixels» от
 * снятия скриншотов трассы) — шум окружения, не диагностика нашего кода; всё остальное про WebGL/three — ошибка.
 */
const test = base.extend<{ plannerPage: Page }>({
  plannerPage: async ({ page, request }, use) => {
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

    PROJECT_URL = await ensureProjectUrl(request, PROJECT_NAME);
    await page.goto(PROJECT_URL);
    await registry(page).waitFor(1);
    await page.waitForTimeout(SETTLE_MS);

    await use(page);

    expect(consoleIssues, 'консоль без ошибок и WebGL-предупреждений').toEqual([]);
  },
});

test.describe('планер: render-on-demand и утечки', () => {
  test('оба канваса занимают контейнер целиком, буферы — под devicePixelRatio', async ({ plannerPage: page }) => {
    const r = registry(page);

    // Новый документ открыт в конструкторе: видим канвас Canvas2D, канвас Three скрыт (`hidden` + `display: none`).
    expect(await r.isActive(0, 'canvas2d')).toBe(true);
    expect(await r.isActive(0, 'three')).toBe(false);
    expectFillsContainer(await r.metrics(0, 'canvas2d'), 'canvas2d');

    // У скрытого канваса собственный rect нулевой — `ResizeObserver` обеих проекций смотрит на контейнер,
    // поэтому его буфер всё равно равен размеру контейнера × DPR (ADR 0020 «Что важно знать»).
    const hiddenThree = await r.metrics(0, 'three');
    expect(hiddenThree.cssWidth, 'скрытый канвас Three не занимает места').toBe(0);
    expect(Math.abs(hiddenThree.bufferWidth - hiddenThree.parentWidth * hiddenThree.dpr)).toBeLessThanOrEqual(1);
    expect(Math.abs(hiddenThree.bufferHeight - hiddenThree.parentHeight * hiddenThree.dpr)).toBeLessThanOrEqual(1);

    // Показанный канвас Three занимает контейнер ровно так же.
    await r.setView(0, 'plan');
    await expect.poll(() => r.isActive(0, 'three')).toBe(true);
    await page.waitForTimeout(SETTLE_MS);
    expectFillsContainer(await r.metrics(0, 'three'), 'three');

    const hiddenCanvas2d = await r.metrics(0, 'canvas2d');
    expect(hiddenCanvas2d.cssWidth, 'скрытый канвас конструктора не занимает места').toBe(0);
    expect(Math.abs(hiddenCanvas2d.bufferWidth - hiddenCanvas2d.parentWidth * hiddenCanvas2d.dpr)).toBeLessThanOrEqual(
      1,
    );
  });

  test('idle FPS ≈ 0: конструктор отрисовал кадры и уснул, приостановленная Three не рисует вовсе', async ({
    plannerPage: page,
  }) => {
    const r = registry(page);
    const before = await r.canvas2d(0);
    expect(before.frame, 'первые кадры конструктора после монтирования отрисованы').toBeGreaterThan(0);
    expect(await r.isRendering(0, 'canvas2d'), 'луп конструктора уснул').toBe(false);

    const threeBefore = await r.three(0);
    expect(threeBefore.frame, 'на чужом виде Three не рисует ни кадра (ADR 0020 P5)').toBe(0);
    expect(await r.isRendering(0, 'three'), 'луп Three не запускался').toBe(false);
    expect(threeBefore).toMatchObject({ geometries: 0, textures: 0 });

    await page.waitForTimeout(IDLE_MS);
    expect((await r.canvas2d(0)).frame, 'в покое ни одного кадра конструктора').toBe(before.frame);
    expect(await r.three(0)).toMatchObject({ frame: 0, geometries: 0, textures: 0 });
  });

  test('движение мыши по холсту конструктора не будит Three: кадры только у Canvas2D, потом снова покой', async ({
    plannerPage: page,
  }) => {
    const r = registry(page);
    const box = await page.locator('canvas[role="img"]').boundingBox();
    expect(box, 'холст конструктора виден и измерим').not.toBeNull();

    // Инструмент рисования — именно тот режим, ради которого Three приостановлена: живой курсор ленты меняется
    // на каждом `pointerMove`, то есть `tools:changed` идёт на каждое движение мыши (ADR 0020 P5). В `editing`
    // над пустым холстом движение — no-op автомата (та же ссылка состояния), и события бы не было вовсе.
    expect(await r.startWalls(0)).toEqual({ ok: true, value: undefined });
    await page.waitForTimeout(SETTLE_MS);
    const before = await r.canvas2d(0);

    // Если бы Three не была приостановлена, скрытый WebGL-канвас рисовал бы кадр на каждое движение мыши.
    for (let i = 0; i < 10; i++) {
      await page.mouse.move(box!.x + 200 + i * 20, box!.y + 200 + i * 10);
    }

    await expect
      .poll(async () => (await r.canvas2d(0)).frame, { message: 'конструктор перерисовался на движение мыши' })
      .toBeGreaterThan(before.frame);
    expect(await r.three(0), 'Three спит: ни кадра, ни памяти').toMatchObject({
      frame: 0,
      geometries: 0,
      textures: 0,
    });

    await page.waitForTimeout(SETTLE_MS);
    const settled = await r.canvas2d(0);
    expect(await r.isRendering(0, 'canvas2d'), 'после движения мыши луп конструктора уснул').toBe(false);
    await page.waitForTimeout(IDLE_MS);
    expect((await r.canvas2d(0)).frame, 'в покое после движения мыши кадров нет').toBe(settled.frame);
    expect((await r.three(0)).frame, 'Three так и не проснулась').toBe(0);
  });

  test('переключение вида туда-обратно: конечное число кадров у входящей проекции и снова покой', async ({
    plannerPage: page,
  }) => {
    const r = registry(page);
    const canvas2dBefore = await r.canvas2d(0);

    await r.setView(0, 'plan');
    await expect.poll(() => r.isActive(0, 'three')).toBe(true);
    await page.waitForTimeout(SETTLE_MS);

    const threeOnPlan = await r.three(0);
    expect(threeOnPlan.frame, 'вход в свой вид сбрасывает накопленную грязь одним кадром').toBeGreaterThan(0);
    expect(threeOnPlan.frame, 'кадров конечное число — не больше бюджета одного invalidate').toBeLessThanOrEqual(
      FRAME_BUDGET,
    );
    expect(await r.isRendering(0, 'three'), 'Three снова спит').toBe(false);
    expect(await r.isActive(0, 'canvas2d')).toBe(false);
    const canvas2dOnPlan = await r.canvas2d(0);
    expect(canvas2dOnPlan.frame, 'приостановленный конструктор кадров не добавил').toBe(canvas2dBefore.frame);

    await page.waitForTimeout(IDLE_MS);
    expect((await r.three(0)).frame, 'в покое на виде plan кадров нет').toBe(threeOnPlan.frame);

    await r.setView(0, 'constructor');
    await expect.poll(() => r.isActive(0, 'canvas2d')).toBe(true);
    await page.waitForTimeout(SETTLE_MS);

    const canvas2dBack = await r.canvas2d(0);
    expect(canvas2dBack.frame, 'возврат в конструктор — кадр по накопленной грязи').toBeGreaterThan(
      canvas2dOnPlan.frame,
    );
    expect(canvas2dBack.frame - canvas2dOnPlan.frame, 'кадров конечное число').toBeLessThanOrEqual(FRAME_BUDGET);
    expect(await r.isRendering(0, 'canvas2d')).toBe(false);
    expect((await r.three(0)).frame, 'ушедшая Three кадров не добавила').toBe(threeOnPlan.frame);

    await page.waitForTimeout(IDLE_MS);
    expect((await r.canvas2d(0)).frame, 'после возврата в конструктор снова покой').toBe(canvas2dBack.frame);
    expect(await r.three(0)).toMatchObject({ frame: threeOnPlan.frame, geometries: 0, textures: 0 });
  });

  test('resize перерисовывает активную проекцию и снова засыпает; память Three не растёт', async ({
    plannerPage: page,
  }) => {
    const r = registry(page);
    const before = await r.canvas2d(0);
    const threeBefore = await r.three(0);

    await page.setViewportSize({ width: FIRST_RESIZE_WIDTH, height: 900 });
    await page.waitForTimeout(SETTLE_MS);
    const afterFirst = await r.canvas2d(0);
    expect(afterFirst.frame, 'resize даёт кадры активной проекции').toBeGreaterThan(before.frame);
    const firstSize = await r.metrics(0, 'canvas2d');
    expectFillsContainer(firstSize, 'canvas2d после первого resize');
    expect(Math.abs(firstSize.bufferWidth - canvasWidthAt(FIRST_RESIZE_WIDTH) * firstSize.dpr)).toBeLessThanOrEqual(1);
    // Буфер приостановленной Three тоже подстроился: `ResizeObserver` смотрит на контейнер, а не на канвас.
    const hiddenThree = await r.metrics(0, 'three');
    expect(Math.abs(hiddenThree.bufferWidth - canvasWidthAt(FIRST_RESIZE_WIDTH) * hiddenThree.dpr)).toBeLessThanOrEqual(
      1,
    );

    await page.setViewportSize({ width: SECOND_RESIZE_WIDTH, height: 700 });
    await page.waitForTimeout(SETTLE_MS);
    const afterSecond = await r.canvas2d(0);
    expect(afterSecond.frame).toBeGreaterThan(afterFirst.frame);
    expect(await r.isRendering(0, 'canvas2d')).toBe(false);

    await page.waitForTimeout(IDLE_MS);
    expect((await r.canvas2d(0)).frame, 'после resize луп снова спит').toBe(afterSecond.frame);
    expect(await r.three(0), 'resize не будит приостановленную Three и не растит её память').toEqual(threeBefore);
  });

  test('уход со страницы освобождает обе проекции; повторный вход поднимает новый планер без утечек', async ({
    plannerPage: page,
  }) => {
    const r = registry(page);
    const before = await r.canvas2d(0);

    await navigateInApp(page, '/');
    await expect.poll(() => r.isDisposed(0, 'canvas2d'), { message: 'canvas2d.dispose() после unmount' }).toBe(true);
    await expect.poll(() => r.isDisposed(0, 'three'), { message: 'three.dispose() после unmount' }).toBe(true);
    // Канвасов на странице не осталось — сняты оба, и видимый, и скрытый.
    await expect(page.locator('canvas')).toHaveCount(0);

    await page.waitForTimeout(SETTLE_MS);
    expect((await r.canvas2d(0)).frame, 'после dispose кадров конструктора нет').toBe(before.frame);
    expect(await r.three(0)).toMatchObject({ frame: 0, geometries: 0, textures: 0 });
    expect(await r.isRendering(0, 'canvas2d')).toBe(false);
    expect(await r.isRendering(0, 'three')).toBe(false);

    await navigateInApp(page, PROJECT_URL);
    await r.waitFor(2);
    await page.waitForTimeout(SETTLE_MS);
    expect(await r.count()).toBe(2);
    expect(await r.isDisposed(1, 'canvas2d')).toBe(false);
    expect(await r.isDisposed(1, 'three')).toBe(false);
    await expect(page.locator('canvas')).toHaveCount(2);
    const fresh = await r.canvas2d(1);
    expect(fresh.frame, 'новый планер отрисовал конструктор').toBeGreaterThan(0);
    expect(await r.three(1)).toMatchObject({ frame: 0, geometries: 0, textures: 0 });

    await page.waitForTimeout(IDLE_MS);
    expect((await r.canvas2d(1)).frame).toBe(fresh.frame);
    expect((await r.canvas2d(0)).frame, 'старый планер после dispose не рендерит').toBe(before.frame);
  });
});
