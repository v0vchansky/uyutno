import { expect, test as base, type Page } from '@playwright/test';
import type { PlannerInstance } from '@uyutno/planner';

import { PLANNER_READY_EVENT } from '../src/client/project/lib/plannerReadyEvent';
import { projectDocumentApiPath } from '../src/shared/projects';
import { ensureProject } from './support/projects';

/**
 * Индикатор сохранения в шапке, тихая иконка и модалки отказа (задача 0084; handoff
 * `docs/ui/handoffs/planner/planner-editor-ui.md`, «Индикатор состояния сохранения», кадры `s3`).
 *
 * Слой 4 тестовой стратегии, и другого слоя у этих проверок нет: состояния рождаются реальным ответом
 * сервера — офлайном (запрос не доехал), 404 (проект удалили во второй вкладке) и 500 с текстом. Всё это
 * приезжает **перехватом ответа**, потому что иначе воспроизвести их в браузере нечем.
 */

interface E2ERegistry {
  planners: PlannerInstance[];
}

declare global {
  interface Window {
    __uyutnoE2E?: E2ERegistry;
  }
}

const PROJECT_NAME = 'e2e · индикатор сохранения';

/** `HH:MM` из состояния `persistence` — час и минута клиента, а не пересчёт в компоненте. */
const CLOCK = /^\d{2}:\d{2}$/;

/**
 * Слот статуса в шапке. Ищется ролью, а не тестовым атрибутом: статус обязан быть живой областью
 * `aria-live="polite"` (handoff, «Доступность · оболочка»), а `role="status"` — это она и есть.
 */
const statusOf = (page: Page) => page.locator('header [role="status"]');

const planner = (page: Page) => ({
  waitFor: () => page.waitForFunction(() => (window.__uyutnoE2E?.planners.length ?? 0) >= 1),
  /** Правка документа — самый дешёвый способ поднять dirty: без него сохранение гасится гейтом (спека 10). */
  touch: (wallHeight: number) =>
    page.evaluate(
      height => window.__uyutnoE2E!.planners[0]!.manager.document.setSettings({ wallHeight: height }),
      wallHeight,
    ),
  /** Тик автосейва вручную: ждать реальные 60 секунд спека не требует — важна причина сохранения, а не таймер. */
  autosave: () => page.evaluate(() => window.__uyutnoE2E!.planners[0]!.manager.persistence.save('autosave')),
  status: () => page.evaluate(() => window.__uyutnoE2E!.planners[0]!.manager.persistence.getState().status),
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

test.describe('индикатор сохранения в шапке', () => {
  test('покой: статуса нет вовсе, кнопка «Сохранить» неактивна — сохранять нечего', async ({
    editorPage: page,
    request,
  }) => {
    const projectId = await ensureProject(request, PROJECT_NAME);
    await page.goto(`/project/${projectId}`);
    await planner(page).waitFor();

    /*
     * Задача 0090 отменила строку макета «покой — кнопка активна»: раньше нажатие в покое молча отбрасывал
     * dirty-гейт внутри `persistence.save()`, и это читалось как сломанная кнопка. Первая же правка
     * документа её включает.
     */
    const save = page.getByRole('button', { name: 'Сохранить' });
    await expect(save).toBeDisabled();
    await expect(statusOf(page)).toHaveCount(0);

    await planner(page).touch(290);
    await expect(save).toBeEnabled();
  });

  test('нажатие видно: спиннер, потом галочка на погашенной кнопке, потом обычный вид', async ({
    editorPage: page,
    request,
  }) => {
    const projectId = await ensureProject(request, PROJECT_NAME);
    await page.goto(`/project/${projectId}`);
    await planner(page).waitFor();
    await planner(page).touch(298);

    /*
     * Сценарий жалобы автора целиком, и **без перехвата запроса**: локальный `PUT …/document` отвечает за
     * ~11 мс, то есть быстрее кадра экрана. Раз кадры всё равно видны — их держит минимальный срок показа
     * (задача 0090), а не удача планировщика.
     */
    await page.getByRole('button', { name: 'Сохранить' }).click();

    const saving = page.getByRole('button', { name: 'Сохраняем…' });
    await expect(saving).toBeVisible();
    /*
     * «Идёт запись» — занятость, а не недоступность (задача 0097): у `Button` HeroUI это `isPending`, и
     * атрибута `disabled` в этом кадре нет. Скринридеру занятость объявляется `aria-disabled`, а проверку
     * «нажатие не проходит» несёт сценарий ниже, где запрос удерживается и считается.
     */
    await expect(saving).toHaveAttribute('aria-disabled', 'true');
    await expect(saving).not.toHaveAttribute('disabled', /.*/);

    // Подтверждение доживает своё на погашенной кнопке: dirty снят успехом, сохранять уже нечего.
    const saved = page.getByRole('button', { name: 'Сохранено' });
    await expect(saved).toBeVisible();
    await expect(saved).toBeDisabled();
    // Пока галочка на кнопке, слот молчит — двух подтверждений рядом не бывает.
    await expect(statusOf(page)).toHaveCount(0);

    // Галочка уходит сама, текстовый статус встаёт на её место, кнопка остаётся неактивной.
    await expect(saved).toHaveCount(0);
    await expect(statusOf(page)).toHaveText(/^Сохранено, \d{2}:\d{2}$/);
    await expect(page.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  test('ручной Save: кнопка держит «Сохраняем…», потом статус «Сохранено, ЧЧ:ММ»', async ({
    editorPage: page,
    request,
  }) => {
    const projectId = await ensureProject(request, PROJECT_NAME);
    await page.goto(`/project/${projectId}`);
    await planner(page).waitFor();
    await planner(page).touch(291);

    let release = (): void => undefined;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    let writes = 0;
    await page.route(projectDocumentApiPath(projectId), async route => {
      if (route.request().method() !== 'PUT') return route.continue();
      writes += 1;
      await held;
      return route.continue();
    });

    await page.getByRole('button', { name: 'Сохранить' }).click();

    // Пока запрос в полёте — «идёт запись»: кнопка занята, второй запрос из неё не запустить.
    const saving = page.getByRole('button', { name: 'Сохраняем…' });
    await expect(saving).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить' })).toHaveCount(0);

    /*
     * Проверка по существу, а не по атрибуту (задача 0097). Раньше «второй запрос не запустить» держал
     * `disabled`, и тест смотрел ровно на него. У `isPending` атрибута `disabled` нет: кнопка остаётся
     * фокусируемой (иначе фокус улетал бы с неё на время записи, и объявить занятость было бы некому), а
     * нажатие гасят React Aria и `pointer-events: none`. Значит и проверять надо нажатие: жмём занятую
     * кнопку и мышью, и с клавиатуры — и считаем ушедшие запросы.
     */
    await saving.click({ force: true });
    await saving.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await expect(saving).toBeVisible();
    expect(writes, 'из занятой кнопки второй запрос не уходит').toBe(1);

    release();
    const status = statusOf(page);
    await expect(status).toHaveText(/^Сохранено, \d{2}:\d{2}$/);
    // Сохранено — значит сохранять больше нечего: кнопка гаснет по dirty, а не залипает в «идёт запись» (0090).
    await expect(page.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('автосейв и ручной Save — один индикатор, разные слова', async ({ editorPage: page, request }) => {
    const projectId = await ensureProject(request, PROJECT_NAME);
    await page.goto(`/project/${projectId}`);
    await planner(page).waitFor();

    await planner(page).touch(292);
    await planner(page).autosave();
    const status = statusOf(page);
    await expect(status).toHaveText(/^Автосохранено, \d{2}:\d{2}$/);
    // Тихий фоновый успех модалок не поднимает.
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await planner(page).touch(293);
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(status).toHaveText(/^Сохранено, \d{2}:\d{2}$/);
    // Статус ровно один — второго индикатора рядом не появляется.
    await expect(statusOf(page)).toHaveCount(1);

    const time = (await status.textContent())!.split(', ')[1]!;
    expect(time).toMatch(CLOCK);
  });

  test('ошибка фонового сохранения — тихая иконка с тултипом, ни одной модалки', async ({
    editorPage: page,
    request,
  }) => {
    const projectId = await ensureProject(request, PROJECT_NAME);
    await page.goto(`/project/${projectId}`);
    await planner(page).waitFor();
    await planner(page).touch(294);

    await page.route(projectDocumentApiPath(projectId), route =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status: 500, json: { error: 'Внутренняя ошибка' } })
        : route.continue(),
    );
    await planner(page).autosave();

    const icon = page.getByRole('img', { name: 'Не удалось сохранить на сервер' });
    await expect(icon).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    /*
     * Подсказка — библиотечный `Tooltip`, а не нативный `title` (задача 0097). Проверяются оба входа:
     * наведение мышью, которое умел и `title`, и **фокус с клавиатуры**, которого у `title` не было, — ради
     * него компонент и взят. Обход, вписанный тогда в компонент (`role="img"` + `aria-label` вместо
     * подсказки), с этого момента лишний.
     */
    const tooltip = page.getByRole('tooltip');

    /*
     * Указатель сначала ставится в стороне, а потом наводится: у свежей страницы позиция мыши ещё не
     * определена, и первый же `hover()` в некоторых прогонах не рождает `pointerenter` — компонент такого
     * события просто не видит. Это про инструмент, а не про подсказку.
     */
    await page.mouse.move(400, 500);
    await icon.hover();
    await expect(tooltip).toHaveText(/^Не удалось сохранить на сервер, \d{2}:\d{2}$/);
    // Обещания локальной копии нет: у обычного проекта её не существует (ADR 0021).
    await expect(tooltip).not.toContainText(/локальн/i);

    // Увели указатель — подсказка ушла.
    await page.mouse.move(0, 400);
    await expect(tooltip).toHaveCount(0);

    // Тот же текст достаётся с клавиатуры: иконка в таб-обходе, подсказка открывается по фокусу.
    await icon.focus();
    await expect(tooltip).toHaveText(/^Не удалось сохранить на сервер, \d{2}:\d{2}$/);

    // Первый успешный save иконку снимает.
    await page.unroute(projectDocumentApiPath(projectId));
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(statusOf(page)).toHaveText(/^Сохранено, \d{2}:\d{2}$/);
    await expect(icon).toHaveCount(0);
  });

  test('офлайн: постоянный статус в шапке и модалка на каждое ручное сохранение', async ({
    editorPage: page,
    request,
  }) => {
    const projectId = await ensureProject(request, PROJECT_NAME);
    await page.goto(`/project/${projectId}`);
    await planner(page).waitFor();
    await planner(page).touch(295);

    await page.route(projectDocumentApiPath(projectId), route =>
      route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue(),
    );

    await page.getByRole('button', { name: 'Сохранить' }).click();

    const status = statusOf(page);
    await expect(status).toHaveText('Нет сети, изменения не сохранены');

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Нет сети', { exact: true })).toBeVisible();
    await expect(dialog).toContainText('сохранение продолжится само');
    await expect(dialog).not.toContainText(/локальн/i);

    // Модалка снимается кнопкой, статус — нет: сети всё ещё нет.
    await dialog.getByRole('button', { name: 'Понятно' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(status).toHaveText('Нет сети, изменения не сохранены');

    // Второе ручное сохранение поднимает модалку снова — она отвечает на действие, а не на состояние.
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByRole('dialog').getByText('Нет сети', { exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Понятно' }).click();

    // Сеть вернулась — статус снимается сам, ближайшим успешным сохранением.
    await page.unroute(projectDocumentApiPath(projectId));
    await planner(page).autosave();
    await expect(status).toHaveText(/^Автосохранено, \d{2}:\d{2}$/);
    expect(await planner(page).status()).toBe('saved');
  });

  test('ошибка ручного Save — модалка с текстом сервера; «Повторить» сохраняет', async ({
    editorPage: page,
    request,
  }) => {
    const projectId = await ensureProject(request, PROJECT_NAME);
    await page.goto(`/project/${projectId}`);
    await planner(page).waitFor();
    await planner(page).touch(296);

    let broken = true;
    await page.route(projectDocumentApiPath(projectId), route => {
      if (route.request().method() !== 'PUT' || !broken) return route.continue();
      broken = false;
      return route.fulfill({ status: 500, json: { error: 'Проект слишком большой' } });
    });

    await page.getByRole('button', { name: 'Сохранить' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Не удалось сохранить')).toBeVisible();
    await expect(dialog).toContainText('Проект слишком большой');
    await expect(dialog.getByRole('button', { name: 'Отмена' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(statusOf(page)).toHaveText(/^Сохранено, \d{2}:\d{2}$/);
  });

  test('«Проект удалён»: 404 даёт модалку с единственной кнопкой «В галерею»', async ({
    editorPage: page,
    request,
  }) => {
    const projectId = await ensureProject(request, PROJECT_NAME);
    await page.goto(`/project/${projectId}`);
    await planner(page).waitFor();
    await planner(page).touch(297);

    await page.route(projectDocumentApiPath(projectId), route =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status: 404, json: { error: 'проект не найден' } })
        : route.continue(),
    );

    await page.getByRole('button', { name: 'Сохранить' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Проект удалён')).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'В галерею' })).toHaveAttribute('href', '/projects');
    await expect(dialog.getByRole('button', { name: 'Повторить' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Отмена' })).toHaveCount(0);
  });
});
