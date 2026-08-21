import { expect, test } from '@playwright/test';

import { GUEST_STORAGE_STATE } from './support/testUser';

/**
 * `/demo` — страница-заглушка до настоящего демо (задача 0092; подменится на редактор задачей 0064). Смысл спеки не
 * в вёрстке, а в том, что **обещание лендинга перестало врать**: четыре точки входа ведут на живую страницу, а не в
 * 404, и ходить туда можно без аккаунта.
 *
 * Точки входа проверяются кликом по настоящей ссылке, а не переходом по `/demo`: сломается именно `to='/demo'` в
 * разметке, а не роут, и переход по адресу такую поломку не поймает.
 */

const HEADING = 'Пример проекта ещё не готов';

test.describe('гость', () => {
  test.use({ storageState: GUEST_STORAGE_STATE });

  test('hard-load /demo — 200 без редиректа на вход, страница рендерится', async ({ page }) => {
    // `maxRedirects: 0`: гард `requireAuth('page')` на этом пути дал бы 302, а не итоговый 200 после перехода.
    const direct = await page.request.get('/demo', { maxRedirects: 0 });
    expect(direct.status()).toBe(200);

    await page.goto('/demo');
    await expect(page).toHaveURL('/demo');
    await expect(page.getByRole('heading', { level: 1, name: HEADING })).toBeVisible();
  });

  test('мета страницы приходят в HTML от сервера и не дублируют главную', async ({ page }) => {
    const html = await (await page.request.get('/demo')).text();
    const home = await (await page.request.get('/')).text();

    expect(html).toContain('<title>Пример проекта — уютно</title>');
    expect(html).toMatch(/<meta name="description" content="[^"]*планировку[^"]*"/);
    expect(html).not.toContain('<title>уютно — планировщик квартиры онлайн</title>');
    expect(home).toContain('<title>уютно — планировщик квартиры онлайн</title>');
  });

  test('кнопка «Посмотреть пример» на главной ведёт на страницу, а не в 404', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Посмотреть пример' }).click();

    await expect(page).toHaveURL('/demo');
    await expect(page.getByRole('heading', { level: 1, name: HEADING })).toBeVisible();
  });

  test('ссылка «Пример проекта» в подвале ведёт на страницу, а не в 404', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Пример проекта' }).click();

    await expect(page).toHaveURL('/demo');
    await expect(page.getByRole('heading', { level: 1, name: HEADING })).toBeVisible();
  });

  test('обещание FAQ выполнимо: пример открывается без аккаунта, действие — регистрация', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Нужен ли аккаунт?' }).click();
    await expect(page.getByText('Посмотреть пример можно без него')).toBeVisible();

    await page.goto('/demo');
    const cta = page.getByRole('link', { name: 'Собрать планировку' });
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page).toHaveURL('/register');
  });
});

/**
 * Четвёртый носитель — кнопка «Посмотреть пример» в пустом состоянии `/projects` — сюда не попадает: пустое
 * состояние видно только у пользователя без проектов, а общий e2e-пользователь их накапливает от планерных спек;
 * заводить нового на каждый прогон нельзя — `/auth/register` ограничен 10 запросами в час на IP. Проверяется
 * визуально (задача 0092, «Заметки»).
 */
test.describe('вошедший пользователь', () => {
  test('страница открывается, а действие ведёт в проекты, а не на регистрацию', async ({ page }) => {
    await page.goto('/demo');

    await expect(page.getByRole('heading', { level: 1, name: HEADING })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Собрать планировку' })).toHaveCount(0);

    await page.getByRole('main').getByRole('link', { name: 'Мои проекты' }).click();
    await expect(page).toHaveURL('/projects');
  });
});
