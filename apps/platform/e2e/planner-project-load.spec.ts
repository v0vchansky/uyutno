import { expect, test as base, type Page } from '@playwright/test';
import type { PlannerDocument, PlannerInstance, ViewportInsets } from '@uyutno/planner';

import { projectDocumentApiPath, PROJECTS_API_BASE } from '../src/shared/projects';
import { PLANNER_READY_EVENT } from '../src/client/project/lib/plannerReadyEvent';
import { ensureProject, putProjectDocument } from './support/projects';

/**
 * E2E-смоук открытия проекта (testing-strategy слой 4, критический маршрут; задача 0085, спека 10 «Load
 * проекта», ADR 0021): две фазы прогресса, восстановление плана и активного вида, авто-fit «в центр»,
 * пустой проект, обе модалки отказа и 404 на чужой проект.
 *
 * Другого слоя у этих проверок нет: экран открытия — это порядок кадров (планер монтируется только после
 * разбора документа, индикатор снимается только после восстановления сцены), и проверяется он реальным
 * браузером с реальной сетью.
 *
 * Битые документы приезжают **перехватом ответа**, а не записью в базу: `PUT …/document` проверяет конверт
 * схемой формата и битое тело не принимает — то есть иначе как подменой ответа сервера эти ветки в браузер
 * не попадают.
 */

interface E2ERegistry {
  planners: PlannerInstance[];
}

declare global {
  interface Window {
    __uyutnoE2E?: E2ERegistry;
  }
}

const PROJECT_NAME = 'e2e · открытие проекта';
/** Отдельный проект под ветки, которым нужен сохранённый план: остальные спеки ждут пустого документа. */
const SAVED_PROJECT_NAME = 'e2e · открытие проекта · сохранённый';

const DOCUMENT_FORMAT = 'uyutno.planner';
const DOCUMENT_VERSION = 1;

/** Комната 400 × 300 см со смещённым центром: по нему видно, что «в центр» действительно сработало. */
const PLAN_CENTRE = { x: 700, y: -500 };
/** Толщина стены фикстуры, см: комната — это **пара** колец контура, внешнее и внутреннее (ADR 0016). */
const WALL_WIDTH = 10;

const emptyDocument = (): PlannerDocument =>
  ({
    format: DOCUMENT_FORMAT,
    version: DOCUMENT_VERSION,
    settings: { units: 'cm', wallHeight: 280 },
    view: {
      activeView: 'constructor',
      cameras: {
        plan: { x: 0, y: 0, zoom: 0.5 },
        orbit: { x: 0, y: 0, elevation: 110, pan: 45, tilt: 45, zoom: 0.1 },
        walk: { x: 0, y: 0, pan: 0, tilt: 0 },
      },
    },
    floors: [
      {
        id: 'floor-e2e',
        layout: { points: {}, contours: [], covers: [], areas: [], cuts: [], rooms: [] },
        scene: { items: [], rulers: [], hidden: [] },
      },
    ],
  }) as unknown as PlannerDocument;

/**
 * Комната ровно в той форме, в какой её пишет инструмент «Прямоугольная комната»: два кольца контура —
 * внешнее `outer` и внутреннее `inner`, между ними тело стены. Одного кольца мало: комната в производном
 * состоянии выводится из **замкнутой области внутри** ленты стен, а не из самого контура (ADR 0016/0017).
 */
const planDocument = (): PlannerDocument => {
  const document = emptyDocument();
  const floor = document.floors[0]!;
  const ring = (prefix: string, halfWidth: number, halfHeight: number) => [
    { id: `${prefix}-a`, x: PLAN_CENTRE.x - halfWidth, y: PLAN_CENTRE.y - halfHeight },
    { id: `${prefix}-b`, x: PLAN_CENTRE.x + halfWidth, y: PLAN_CENTRE.y - halfHeight },
    { id: `${prefix}-c`, x: PLAN_CENTRE.x + halfWidth, y: PLAN_CENTRE.y + halfHeight },
    { id: `${prefix}-d`, x: PLAN_CENTRE.x - halfWidth, y: PLAN_CENTRE.y + halfHeight },
  ];
  const outer = ring('p-outer', 200, 150);
  const inner = ring('p-inner', 200 - WALL_WIDTH, 150 - WALL_WIDTH);

  floor.layout.points = Object.fromEntries([...outer, ...inner].map(point => [point.id, point]));
  floor.layout.contours = [
    { id: 'contour-outer', kind: 'outer', points: outer.map(point => point.id) },
    { id: 'contour-inner', kind: 'inner', points: inner.map(point => point.id) },
  ];
  return document;
};

/** Сколько точек в такой комнате — два кольца по четыре угла. */
const PLAN_POINTS = 8;

const planner = (page: Page) => ({
  waitFor: () => page.waitForFunction(() => (window.__uyutnoE2E?.planners.length ?? 0) >= 1),
  points: () =>
    page.evaluate(() =>
      Object.values(window.__uyutnoE2E!.planners[0]!.manager.document.get().floors[0]!.layout.points).map(point => ({
        x: point.x,
        y: point.y,
      })),
    ),
  rooms: () =>
    page.evaluate(() => window.__uyutnoE2E!.planners[0]!.manager.document.getDerived().floors[0]!.rooms.length),
  activeView: () => page.evaluate(() => window.__uyutnoE2E!.planners[0]!.manager.view.get().activeView),
  planCamera: () => page.evaluate(() => ({ ...window.__uyutnoE2E!.planners[0]!.manager.view.get().cameras.plan })),
  viewport: () => page.evaluate(() => window.__uyutnoE2E!.planners[0]!.projections.canvas2d.getViewport()),
  insets: (): Promise<ViewportInsets> =>
    page.evaluate(() => window.__uyutnoE2E!.planners[0]!.projections.canvas2d.getViewportInsets()),
  toolKind: () => page.evaluate(() => window.__uyutnoE2E!.planners[0]!.manager.tools.get().kind),
  isDirty: () => page.evaluate(() => window.__uyutnoE2E!.planners[0]!.manager.document.isDirty()),
  save: () => page.evaluate(() => window.__uyutnoE2E!.planners[0]!.manager.persistence.save('manual')),
});

const test = base.extend<{ editorPage: Page }>({
  editorPage: async ({ page }, use) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.addInitScript(eventName => {
      const store: E2ERegistry = { planners: [] };
      window.__uyutnoE2E = store;
      window.addEventListener(eventName, event => {
        store.planners.push((event as CustomEvent<PlannerInstance>).detail);
      });
    }, PLANNER_READY_EVENT);
    await use(page);
    expect(pageErrors, 'страница без исключений').toEqual([]);
  },
});

test.use({ viewport: { width: 1440, height: 900 } });

test.describe('открытие проекта: фазы, восстановление, ошибки', () => {
  test('две фазы прогресса, планер в дереве только после документа', async ({ editorPage: page, request }) => {
    const projectId = await ensureProject(request, PROJECT_NAME);
    await putProjectDocument(request, projectId, emptyDocument());

    // Обе фазы придерживаются вручную: без задержки они проходят быстрее, чем успевает моргнуть индикатор.
    let releaseCard = (): void => undefined;
    const cardHeld = new Promise<void>(resolve => {
      releaseCard = resolve;
    });
    let releaseDocument = (): void => undefined;
    const documentHeld = new Promise<void>(resolve => {
      releaseDocument = resolve;
    });

    await page.route(PROJECTS_API_BASE, async route => {
      await cardHeld;
      await route.continue();
    });
    await page.route(projectDocumentApiPath(projectId), async route => {
      await documentHeld;
      await route.continue();
    });

    const opened = page.goto(`/project/${projectId}`);

    await expect(page.getByText('Загружаем проект')).toBeVisible();
    await expect(page.getByText('Шаг 1 из 2')).toBeVisible();
    // Пока сцены нет, канвасов нет вовсе: ввод физически некуда доставить (спека 10).
    await expect(page.locator('canvas')).toHaveCount(0);
    // Рабочей в шапке остаётся только ссылка «Проекты» (handoff, «Что перекрывает затемнение»).
    await expect(page.getByRole('link', { name: 'Проекты' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить' })).toBeDisabled();

    releaseCard();
    await expect(page.getByText('Подгружаем модели и материалы')).toBeVisible();
    await expect(page.getByText('Шаг 2 из 2')).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);

    releaseDocument();
    await opened;
    await expect(page.locator('canvas[role="img"]')).toBeVisible();
    await expect(page.getByText('Шаг 2 из 2')).toHaveCount(0);
    // Рамка холста появляется вместе с планером: во время загрузки её нет (handoff).
    await expect(page.locator('main > div')).toHaveCSS('border-top-width', '1px');
  });

  test('сохранённый план восстанавливается и получает авто-fit «в центр»', async ({ editorPage: page, request }) => {
    const projectId = await ensureProject(request, SAVED_PROJECT_NAME);
    await putProjectDocument(request, projectId, planDocument());

    await page.goto(`/project/${projectId}`);
    await planner(page).waitFor();

    const api = planner(page);
    expect(await api.points()).toHaveLength(PLAN_POINTS);
    expect(await api.rooms()).toBe(1);

    /*
     * Камера конструктора в документ не пишется (ADR 0020) — её ставит авто-fit, причём **по видимой части
     * холста**: центр комнаты обязан встать в середину свободной области, а не кадра целиком, иначе план
     * уезжает под рейл и панель инструментов. Проверка идёт в экранных координатах — там разница видна.
     */
    const viewport = await api.viewport();
    const insets = await api.insets();
    expect(insets.left, 'скин сообщил проекции свою левую полосу').toBeGreaterThan(0);

    const screen = {
      x: (PLAN_CENTRE.x - viewport.center.x) * viewport.scale + viewport.width / 2,
      y: viewport.height / 2 - (PLAN_CENTRE.y - viewport.center.y) * viewport.scale,
    };
    const safeCentre = {
      x: insets.left + (viewport.width - insets.left - insets.right) / 2,
      y: insets.top + (viewport.height - insets.top - insets.bottom) / 2,
    };
    expect(Math.abs(screen.x - safeCentre.x)).toBeLessThan(1);
    expect(Math.abs(screen.y - safeCentre.y)).toBeLessThan(1);
    // И это не то же самое, что центр кадра: без учёта полос план стоял бы в другом месте.
    expect(Math.abs(safeCentre.x - viewport.width / 2)).toBeGreaterThan(1);

    // История после открытия пуста, dirty снят: стек не сохраняется (спека 10).
    await expect(page.getByRole('button', { name: 'Отменить' })).toBeDisabled();
    expect(await api.isDirty()).toBe(false);

    // Редактор интерактивен: инструмент берётся кнопкой панели и доходит до автомата.
    await page.getByRole('button', { name: 'Прямоугольная комната' }).click();
    expect(await api.toolKind()).toBe('making-rect');
  });

  test('активный вид и камеры поднимаются из документа, а не сбрасываются в конструктор', async ({
    editorPage: page,
    request,
  }) => {
    const projectId = await ensureProject(request, SAVED_PROJECT_NAME);
    const document = planDocument();
    document.view.activeView = 'plan';
    document.view.cameras.plan = { x: 123, y: -45, zoom: 0.75 };
    await putProjectDocument(request, projectId, document);

    await page.goto(`/project/${projectId}`);
    await planner(page).waitFor();

    expect(await planner(page).activeView()).toBe('plan');
    expect(await planner(page).planCamera()).toEqual({ x: 123, y: -45, zoom: 0.75 });
    await expect(page.getByRole('button', { name: '2D-план' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('нарисованное сохраняется транспортом и возвращается после перезагрузки', async ({
    editorPage: page,
    request,
  }) => {
    const projectId = await ensureProject(request, SAVED_PROJECT_NAME);
    await putProjectDocument(request, projectId, emptyDocument());

    await page.goto(`/project/${projectId}`);
    await planner(page).waitFor();

    const box = (await page.locator('canvas[role="img"]').boundingBox())!;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.getByRole('button', { name: 'Прямоугольная комната' }).click();
    await page.mouse.click(centre.x - 100, centre.y - 70);
    await page.mouse.move(centre.x + 100, centre.y + 70);
    await page.mouse.click(centre.x + 100, centre.y + 70);
    expect(await planner(page).rooms()).toBe(1);

    // Кнопка «Сохранить» подключается задачей 0082 — здесь дёргается сама точка входа `persistence`.
    const saved = await planner(page).save();
    expect(saved).toMatchObject({ ok: true, value: { kind: 'saved' } });

    await page.reload();
    await planner(page).waitFor();
    expect(await planner(page).rooms()).toBe(1);
    expect(await planner(page).points()).toHaveLength(PLAN_POINTS);
  });

  test('пустая колонка документа открывает пустой холст без единой ошибки', async ({ editorPage: page, request }) => {
    const projectId = await ensureProject(request, PROJECT_NAME);
    await page.route(projectDocumentApiPath(projectId), route =>
      route.fulfill({ json: { document: null, updatedAt: new Date().toISOString() } }),
    );

    await page.goto(`/project/${projectId}`);
    await planner(page).waitFor();

    await expect(page.locator('canvas[role="img"]')).toBeVisible();
    expect(await planner(page).points()).toHaveLength(0);
    expect(await planner(page).activeView()).toBe('constructor');
    /*
     * Пустому плану fit не положен: камера остаётся дефолтной — начало координат в центре кадра и базовый
     * шаг шкалы, на котором 1 CSS px = 1 см (тот же зум, из которого исходят остальные планерные спеки).
     */
    const viewport = await planner(page).viewport();
    expect(viewport.center).toEqual({ x: 0, y: 0 });
    expect(viewport.scale).toBe(1);
    await expect(page.getByText('Выберите инструмент и поставьте первую точку')).toBeVisible();
  });

  test('битый документ — модалка «Не удалось открыть проект»; повтор открывает проект', async ({
    editorPage: page,
    request,
  }) => {
    const projectId = await ensureProject(request, PROJECT_NAME);
    await putProjectDocument(request, projectId, emptyDocument());

    let broken = true;
    await page.route(projectDocumentApiPath(projectId), async route => {
      if (!broken) return route.continue();
      broken = false;
      // Нет обязательной секции `floors` — ровно то, что спека 10 называет битым проектом.
      const { floors: _floors, ...rest } = emptyDocument() as unknown as Record<string, unknown>;
      return route.fulfill({ json: { document: rest, updatedAt: new Date().toISOString() } });
    });

    await page.goto(`/project/${projectId}`);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Не удалось открыть проект')).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Вернуться в галерею' })).toHaveAttribute('href', '/projects');
    // Редактор не остаётся полузагруженным: канвасов под модалкой нет.
    await expect(page.locator('canvas')).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Попробовать ещё раз' }).click();
    await planner(page).waitFor();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('canvas[role="img"]')).toBeVisible();
  });

  test('версия формата новее поддерживаемой — своя модалка с перезагрузкой страницы', async ({
    editorPage: page,
    request,
  }) => {
    const projectId = await ensureProject(request, PROJECT_NAME);
    await page.route(projectDocumentApiPath(projectId), route =>
      route.fulfill({
        json: {
          document: { ...emptyDocument(), version: DOCUMENT_VERSION + 1 },
          updatedAt: new Date().toISOString(),
        },
      }),
    );

    await page.goto(`/project/${projectId}`);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Обновите редактор')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Обновить страницу' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Попробовать ещё раз' })).toHaveCount(0);
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('битые ссылки внутри документа модалку не поднимают: план грузится без дефектной записи', async ({
    editorPage: page,
    request,
  }) => {
    const projectId = await ensureProject(request, PROJECT_NAME);
    const document = planDocument();
    document.floors[0]!.layout.contours.push({
      id: 'contour-broken',
      kind: 'outer',
      points: ['p-outer-a', 'нет-такой'],
    });
    await page.route(projectDocumentApiPath(projectId), route =>
      route.fulfill({ json: { document, updatedAt: new Date().toISOString() } }),
    );

    await page.goto(`/project/${projectId}`);
    await planner(page).waitFor();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await planner(page).rooms()).toBe(1);
  });

  test('несуществующий проект даёт 404-страницу, а не модалку редактора', async ({ editorPage: page }) => {
    await page.goto('/project/00000000-0000-0000-0000-000000000000');

    await expect(page.getByRole('heading', { name: 'Такой страницы нет' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('canvas')).toHaveCount(0);
  });
});
