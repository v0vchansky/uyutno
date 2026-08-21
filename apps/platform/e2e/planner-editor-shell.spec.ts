import { expect, test } from '@playwright/test';

import { EDITOR_MIN_WIDTH } from '../src/client/project/hooks/useEditorViewportFit';
import { ensureProjectUrl } from './support/projects';

/**
 * Каркас оболочки редактора (задача 0088, handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, раздел
 * «Оболочка редактора (P1)»): шапка 48px, рамка холста и порог 1024px.
 *
 * Слой 4 тестовой стратегии, и другого слоя у этой проверки нет: порог живёт в медиазапросе, а рамка — в
 * раскладке, так что «выше порога планер смонтирован, ниже — заглушка и ни одного канваса» проверяется только
 * реальным окном. Числа шапки берутся из норматива, а не подгоняются под реализацию.
 */

/**
 * Проект спеки заводится через API и переиспользуется прогонами: с задачи 0085 редактор открывает настоящий
 * проект, а выдуманный id даёт 404-страницу (`e2e/support/projects.ts`).
 */
const PROJECT_NAME = 'e2e · оболочка редактора';
let PROJECT_URL = '';

test.beforeEach(async ({ request }) => {
  PROJECT_URL = await ensureProjectUrl(request, PROJECT_NAME);
});

/** Внешний габарит шапки, CSS px (handoff, «Шапка»: «ровно 48px по внешнему габариту»). */
const HEADER_HEIGHT = 48;
/** Внешний отступ рамки холста и её радиус (handoff, «Каркас»). */
const CANVAS_FRAME_GAP = 8;
const CANVAS_FRAME_RADIUS = 12;
/** Ширина рейла (handoff, «Рейл»): он стоит слева **снаружи** рамки холста. */
const RAIL_WIDTH = 60;
/** Отступ оверлеев от краёв холста (handoff, «Каркас»). */
const OVERLAY_GAP = 12;
/** Комфортная ширина редактора (handoff, «Адаптив»): с неё шапка перестаёт быть плотной. */
const COMFORT_WIDTH = 1280;

const gapOf = (page: import('@playwright/test').Page) =>
  page.locator('header > div').evaluate(el => getComputedStyle(el).columnGap);

/** Рамка холста — прямой родитель канвасов: её рисует пакет, а не платформа (задача 0089). */
const frameOf = (page: import('@playwright/test').Page) => page.locator('main div:has(> canvas[role="img"])');

test.describe('оболочка редактора', () => {
  test('выше порога: шапка 48px, рамка холста 8/12px, планер смонтирован', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PROJECT_URL);

    const header = page.locator('header');
    await expect(header).toHaveCount(1);
    expect((await header.boundingBox())!.height).toBe(HEADER_HEIGHT);

    const canvas = page.locator('canvas[role="img"]');
    await expect(canvas).toBeVisible();

    const frame = frameOf(page);
    const box = (await frame.boundingBox())!;
    expect(box.x).toBe(RAIL_WIDTH + CANVAS_FRAME_GAP);
    expect(box.y).toBe(HEADER_HEIGHT + CANVAS_FRAME_GAP);
    expect(box.width).toBe(1440 - RAIL_WIDTH - 2 * CANVAS_FRAME_GAP);
    await expect(frame).toHaveCSS('border-radius', `${CANVAS_FRAME_RADIUS}px`);
    await expect(frame).toHaveCSS('border-top-width', '1px');

    // Возврат — ссылка с текстом; кнопка сохранения на месте, но в покое неактивна: сохранять нечего (0090).
    const back = page.getByRole('link', { name: 'Проекты' });
    await expect(back).toHaveAttribute('href', '/projects');
    await expect(back.getByText('Проекты')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    expect(await gapOf(page)).toBe('16px');
  });

  /*
   * Задача 0089: рамку рисует пакет, а не платформа, поэтому рейл — флекс-сосед холста слева, а не оверлей
   * внутри рамки. Проверяется взаимное положение (ни один пиксель рейла не внутри рамки) и то, ради чего вся
   * правка затевалась не была сломана: оверлеи скина по-прежнему отбивают 12px от краёв **холста**.
   */
  test('рейл 60px стоит слева снаружи рамки; оверлеи скина держат 12px от краёв холста', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PROJECT_URL);
    await expect(page.locator('canvas[role="img"]')).toBeVisible();

    const rail = page.getByRole('group', { name: 'Виды и снап' });
    const railBox = (await rail.boundingBox())!;
    const frameBox = (await frameOf(page).boundingBox())!;
    expect(railBox.x).toBe(0);
    expect(railBox.width).toBe(RAIL_WIDTH);
    expect(railBox.y).toBe(HEADER_HEIGHT);
    expect(railBox.height).toBe(900 - HEADER_HEIGHT);
    // Правый край рейла — левый край внешнего отступа рамки: между ними ровно 8px фона страницы.
    expect(frameBox.x - (railBox.x + railBox.width)).toBe(CANVAS_FRAME_GAP);

    const canvasBox = (await page.locator('canvas[role="img"]').boundingBox())!;
    const toolPanel = (await page.getByRole('group', { name: 'Инструменты конструктора' }).boundingBox())!;
    const controls = (await page.getByRole('group', { name: 'Контролы холста' }).boundingBox())!;

    // Панель инструментов — 12px от левого верхнего угла холста.
    expect(toolPanel.x - canvasBox.x).toBe(OVERLAY_GAP);
    expect(toolPanel.y - canvasBox.y).toBe(OVERLAY_GAP);
    // Полоска контролов холста — 12px от правого нижнего угла холста.
    expect(canvasBox.x + canvasBox.width - (controls.x + controls.width)).toBe(OVERLAY_GAP);
    expect(canvasBox.y + canvasBox.height - (controls.y + controls.height)).toBe(OVERLAY_GAP);
    // Холст целиком внутри рамки: рейл его больше не накрывает.
    expect(canvasBox.x).toBe(frameBox.x + 1);
    expect(canvasBox.width).toBe(frameBox.width - 2);
  });

  test(`на пороге ${EDITOR_MIN_WIDTH}px: слово «Проекты» схлопнуто, имя ссылки осталось`, async ({ page }) => {
    await page.setViewportSize({ width: EDITOR_MIN_WIDTH, height: 800 });
    await page.goto(PROJECT_URL);

    await expect(page.locator('canvas[role="img"]')).toBeVisible();

    const back = page.getByRole('link', { name: 'Проекты' });
    await expect(back.getByText('Проекты')).toBeHidden();
    await expect(back).toHaveAttribute('aria-label', 'Проекты');
    expect(await gapOf(page)).toBe('8px');

    // Кнопка сохранения и аватар не сжимаются — плотная раскладка снимает только слово возврата.
    expect((await page.getByRole('button', { name: 'Сохранить' }).boundingBox())!.height).toBe(32);
  });

  test(`на комфортной ширине ${COMFORT_WIDTH}px шапка снова полная`, async ({ page }) => {
    await page.setViewportSize({ width: COMFORT_WIDTH, height: 800 });
    await page.goto(PROJECT_URL);

    await expect(page.getByRole('link', { name: 'Проекты' }).getByText('Проекты')).toBeVisible();
    expect(await gapOf(page)).toBe('16px');
  });

  test(`ниже порога: заглушка вместо редактора, планер не монтируется`, async ({ page }) => {
    await page.setViewportSize({ width: EDITOR_MIN_WIDTH - 1, height: 800 });
    await page.goto(PROJECT_URL);

    await expect(page.getByRole('heading', { name: 'Редактор работает на компьютере' })).toBeVisible();
    // Ни канваса, ни шапки редактора: планер в дерево не попадает вовсе, а не прячется стилями.
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Сохранить' })).toHaveCount(0);

    // Вошедшему — одна кнопка-ссылка «Мои проекты»; она же обещает, что галерея с телефона открывается.
    const cta = page.getByRole('link', { name: 'Мои проекты' });
    await expect(cta).toHaveAttribute('href', '/projects');
    await cta.click();
    await expect(page).toHaveURL('/projects');
    await expect(page.getByRole('heading', { name: 'Проекты' })).toBeVisible();
  });
});
