import { expect, test as base, type Page } from '@playwright/test';
import type { PlannerInstance } from '@uyutno/planner';

import { PLANNER_READY_EVENT } from '../src/client/project/lib/plannerReadyEvent';
import { ensureProjectUrl } from './support/projects';

/**
 * E2E-смоук DOM-оверлея полей ввода длины (testing-strategy слой 4; ADR 0020 P2/P6, задача 0060): реальный
 * браузер, реальные DOM-поля поверх канваса конструктора. Геометрия готовится headless через dev-ручку
 * `onReady` (инструмент «Прямоугольная комната» даёт полую комнату — два кольца контура), а сама проверка идёт
 * через видимые пользователю поля: пара полей на сегменте, Tab между ними, Enter применяет, ошибка рисуется
 * горизонтальной плашкой (решение автора 5).
 *
 * Реестр экземпляров — у теста (`addInitScript`), как в `planner-render-guard.spec.ts` и `planner-walls-tool.spec.ts`.
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
const PROJECT_NAME = 'e2e · поля ввода длины';

/** Полая комната 400 × 300 см вокруг центра плана: при базовом зуме (1 CSS px = 1 см) все стороны длиннее порогов. */
const ROOM = { from: { x: -200, y: -150 }, to: { x: 200, y: 150 } };

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

/** Рисует полую комнату инструментом «Прямоугольная комната» и возвращает число комнат в производном. */
const drawRoom = async (page: Page): Promise<number> =>
  page.evaluate(corners => {
    const { manager } = window.__uyutnoE2E!.planners[0]!;
    const { tools } = manager;
    const mods = { ctrl: false, meta: false, shift: false, alt: false };
    const click = (x: number, y: number) => {
      tools.pointerMove({ x, y, mods, button: 0 });
      tools.pointerDown({ x, y, mods, button: 0 });
      tools.pointerUp({ x, y, mods, button: 0 });
    };
    tools.start('rect');
    click(corners.from.x, corners.from.y);
    click(corners.to.x, corners.to.y);
    return manager.document.getDerived().floors[0]!.rooms.length;
  }, ROOM);

test.describe('планер: поля ввода длины над холстом конструктора', () => {
  test('пара полей на сегменте полой комнаты: Tab переключает, Enter применяет одну запись истории', async ({
    plannerPage: page,
  }) => {
    expect(await drawRoom(page)).toBe(1);

    const outer = page.getByLabel('длина внешнего ребра');
    const inner = page.getByLabel('длина внутреннего ребра');
    await expect(outer).toHaveCount(4);
    await expect(inner).toHaveCount(4);

    // Снимок координат: `setEdgeLength` двигает точки, но не добавляет и не удаляет — считать их бессмысленно.
    const positions = () =>
      page.evaluate(() => {
        const { layout } = window.__uyutnoE2E!.planners[0]!.manager.document.get().floors[0]!;
        return Object.values(layout.points)
          .map(point => `${point.x}|${point.y}`)
          .sort()
          .join(';');
      });

    const before = await positions();

    const field = outer.first();
    await field.click();
    await expect(field).toBeFocused();

    // Tab внутри пары переносит фокус на **второе кольцо того же сегмента** (решения 23/24), а не на соседнее ребро.
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', 'длина внутреннего ребра');
    await page.keyboard.press('Shift+Tab');
    await expect(field).toBeFocused();

    // Две правки подряд в одном поле коалесятся в одну запись истории (ADR 0018 D5, ключ `edge-length:<a>|<b>`).
    await field.fill('500');
    await page.keyboard.press('Enter');
    await field.fill('600');
    await page.keyboard.press('Enter');
    await expect(field).not.toHaveAttribute('aria-invalid', 'true');

    const afterEdits = await positions();
    expect(afterEdits, 'геометрия изменилась').not.toBe(before);

    // Один undo возвращает исходную геометрию целиком: обе правки — один шаг, а не два.
    const afterUndo = await page.evaluate(() => {
      const { manager } = window.__uyutnoE2E!.planners[0]!;
      manager.history.undo();
      const { layout } = manager.document.get().floors[0]!;
      return {
        points: Object.values(layout.points)
          .map(point => `${point.x}|${point.y}`)
          .sort()
          .join(';'),
        canUndo: manager.history.get().canUndo,
      };
    });
    expect(afterUndo.points, 'один undo откатил обе правки').toBe(before);
    // Ниже по стеку — только создание комнаты: правка длины добавила ровно одну запись.
    expect(afterUndo.canUndo).toBe(true);
  });

  test('слишком маленькое значение: кольцо danger на поле и горизонтальная плашка рядом', async ({
    plannerPage: page,
  }) => {
    expect(await drawRoom(page)).toBe(1);

    const field = page.getByLabel('длина внешнего ребра').first();
    await field.click();
    await field.fill('5');
    await page.keyboard.press('Enter');

    await expect(field).toHaveAttribute('aria-invalid', 'true');
    const plate = page.getByText('Стена короче 15 см');
    await expect(plate).toBeVisible();

    // Плашка не наследует поворот поля — она всегда горизонтальна (решение автора 5).
    const rotated = await plate.evaluate(node => {
      const { transform } = window.getComputedStyle(node);
      if (transform === 'none') return false;
      const [a, b] = transform
        .replace(/^matrix\(/, '')
        .split(',')
        .map(Number);
      return Math.abs(b ?? 0) > 1e-6 || Math.abs((a ?? 1) - 1) > 1e-6;
    });
    expect(rotated, 'плашка ошибки без поворота').toBe(false);
  });
});
