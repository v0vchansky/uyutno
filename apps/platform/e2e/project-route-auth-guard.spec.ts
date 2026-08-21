import { expect, test } from '@playwright/test';

import { ensureProjectUrlAsUser } from './support/projects';
import { E2E_USER, GUEST_STORAGE_STATE } from './support/testUser';

/**
 * Гард `/project/:id` (задача 0063): редактор проекта закрыт авторизацией на обоих слоях — серверный
 * `requireAuth('page')` для hard-load (чтобы не мигать пустым содержимым до гидрации) и клиентский `RequireAuth`
 * для SPA-навигации. После входа пользователь возвращается на запрошенный проект — через `?from=`.
 */

/**
 * Проект заводится через API и переиспользуется прогонами: с задачи 0085 редактор открывает настоящий проект,
 * а выдуманный id даёт 404-страницу. Гостевые тесты ходят под пустой сессией, поэтому проект добывается
 * отдельным контекстом под сессией e2e-пользователя (`e2e/support/projects.ts`).
 */
const PROJECT_NAME = 'e2e · гард авторизации';
let PROJECT_URL = '';
let LOGIN_URL_WITH_FROM = '';

test.beforeEach(async ({ baseURL }) => {
  PROJECT_URL = await ensureProjectUrlAsUser(baseURL!, PROJECT_NAME);
  LOGIN_URL_WITH_FROM = `/login?from=${encodeURIComponent(PROJECT_URL)}`;
});
/**
 * Канвасов у планера два — Three и Canvas2D конструктора (ADR 0020 P6), неактивный скрыт. «Редактор открылся» —
 * это видимый холст активного вида; по умолчанию активен конструктор, его канвас — единственный с `role="img"`.
 * Проверки «канвасов нет» остаются на общем `canvas`: не должно быть ни одного.
 */
const VISIBLE_CANVAS = 'canvas[role="img"]';

test.describe('гость на /project/:id', () => {
  test.use({ storageState: GUEST_STORAGE_STATE });

  test('hard-load — сервер отвечает 302 на /login с from, SSR-шелл редактора не отдаётся', async ({ page }) => {
    // Именно `maxRedirects: 0`: если проверять только конечный URL, тест останется зелёным и без серверного гарда —
    // клиентский `RequireAuth` после гидрации приводит ровно к тому же адресу.
    const direct = await page.request.get(PROJECT_URL, { maxRedirects: 0 });

    expect(direct.status()).toBe(302);
    expect(direct.headers()['location']).toBe(LOGIN_URL_WITH_FROM);

    await page.goto(PROJECT_URL);
    await expect(page).toHaveURL(LOGIN_URL_WITH_FROM);
    await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('SPA-переход — клиентский RequireAuth уводит на /login с from', async ({ page }) => {
    await page.goto('/');
    // `history.state.idx` проставляет history react-router при монтировании — значит гидрация прошла и слушатель
    // `popstate` на месте. Без этого ожидания тест проверял бы начальный монтаж, а не SPA-переход.
    await page.waitForFunction(() => (window.history.state as { idx?: number } | null)?.idx !== undefined);
    await page.evaluate(target => {
      window.history.pushState(null, '', target);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, PROJECT_URL);

    await expect(page).toHaveURL(LOGIN_URL_WITH_FROM);
    await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('после входа возвращается на запрошенный проект, редактор открывается', async ({ page }) => {
    await page.goto(PROJECT_URL);
    await expect(page).toHaveURL(LOGIN_URL_WITH_FROM);

    await page.getByLabel('Почта').fill(E2E_USER.email);
    await page.getByLabel('Пароль').fill(E2E_USER.password);
    await page.getByRole('button', { name: 'Войти' }).click();

    await expect(page).toHaveURL(PROJECT_URL);
    await expect(page.locator(VISIBLE_CANVAS)).toBeVisible();
  });
});

test.describe('вошедший пользователь', () => {
  test('открывает /project/:id напрямую — редиректа нет, редактор монтируется', async ({ page }) => {
    await page.goto(PROJECT_URL);

    await expect(page).toHaveURL(PROJECT_URL);
    await expect(page.locator(VISIBLE_CANVAS)).toBeVisible();
  });
});
