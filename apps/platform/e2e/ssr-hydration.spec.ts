import { expect, request as apiRequest, test as base, type APIRequestContext, type Page } from '@playwright/test';

import { ensureProjectUrl, ensureProjectUrlAsUser } from './support/projects';
import { GUEST_STORAGE_STATE } from './support/testUser';

/**
 * Гвард шва SSR ↔ гидрация (задача 0091).
 *
 * React считает автоидентификаторы (`useId`) от **корня рендера**, поэтому пока сервер рендерил целый документ,
 * а клиент гидрировал поддерево внутри `#root`, идентификаторы у одного и того же компонента расходились и
 * гидрация писала об этом в консоль. Ловится это только в настоящем браузере: жалоба приходит из React в
 * консоль страницы, а не из кода приложения.
 *
 * Спека намеренно ходит по **разным** страницам с разными компонентами: расхождение корней — свойство самого
 * приложения, а не одного компонента, и привязываться к конкретному полю/меню/спиннеру тут нельзя. Проверяется
 * не «нет ошибки на экране X», а «браузер не жалуется на гидрацию ни на одной из живых страниц».
 *
 * Вторая половина — про ловушку той же задачи: свести корни можно, отрендерив на сервере одно поддерево вместо
 * документа, но тогда `<title>` и `<meta name="description">` React уже не поднимает в `<head>` — они остаются
 * внутри `#root`. Правило «Мета для страниц» (доска, `client/CLAUDE.md`) этого не допускает, поэтому мета
 * проверяется в **отданном сервером HTML**, до всякого JS.
 */

const PROJECT_NAME = 'e2e · ssr-hydration';

/** Все жалобы React на гидрацию содержат корень «hydrat» — и текст ошибки, и ссылка на react.dev/link/hydration. */
const HYDRATION_COMPLAINT = /hydrat/i;

/** Гидрация идёт сразу после загрузки бандла; запас — чтобы жалоба точно успела дойти до слушателя. */
const SETTLE_MS = 1000;

interface HydrationReport {
  complaints: string[];
}

/** Страница со слушателем консоли: собираем всё, что React говорит про гидрацию, плюс упавшие исключения. */
const test = base.extend<{ watchedPage: [Page, HydrationReport] }>({
  watchedPage: async ({ page }, use) => {
    const report: HydrationReport = { complaints: [] };
    page.on('console', message => {
      if (HYDRATION_COMPLAINT.test(message.text())) report.complaints.push(`[${message.type()}] ${message.text()}`);
    });
    page.on('pageerror', error => report.complaints.push(`[pageerror] ${error.message}`));

    await use([page, report]);
  },
});

/** Открывает адрес, даёт гидрации пройти и возвращает жалобы. */
const openAndHydrate = async (page: Page, report: HydrationReport, url: string): Promise<string[]> => {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(SETTLE_MS);
  return report.complaints;
};

test.describe('гидрация: корень клиента совпадает с корнем SSR', () => {
  test.describe('гость', () => {
    test.use({ storageState: GUEST_STORAGE_STATE });

    test('/login — консоль без жалоб на гидрацию', async ({ watchedPage: [page, report] }) => {
      expect(await openAndHydrate(page, report, '/login'), 'жалобы React на гидрацию /login').toEqual([]);
    });
  });

  test('/projects — консоль без жалоб на гидрацию', async ({ watchedPage: [page, report] }) => {
    expect(await openAndHydrate(page, report, '/projects'), 'жалобы React на гидрацию /projects').toEqual([]);
  });

  test('страница проекта — консоль без жалоб на гидрацию', async ({ watchedPage: [page, report], request }) => {
    const projectUrl = await ensureProjectUrl(request, PROJECT_NAME);

    expect(await openAndHydrate(page, report, projectUrl), 'жалобы React на гидрацию страницы проекта').toEqual([]);
  });
});

/** Разметка `<head>` до `<body>`: `<title>`/`<meta>` страниц React поднимает именно туда. */
const fetchHead = async (request: APIRequestContext, url: string): Promise<string> => {
  // Без редиректов: `/login` под сессией уводит на `/projects`, и «мета страницы входа» молча стала бы
  // метой кабинета — ровно тот дубль, который эта проверка и ищет.
  const response = await request.get(url, { maxRedirects: 0 });
  expect(response.status(), `GET ${url}`).toBe(200);
  const html = await response.text();
  const [head = '', body = ''] = html.split('<body>');
  expect(body, `${url}: мета не должна оставаться внутри <body>`).not.toContain('<title>');
  expect(body, `${url}: мета не должна оставаться внутри <body>`).not.toContain('<meta name="description"');
  return head;
};

const titleOf = (head: string): string => head.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
const descriptionOf = (head: string): string => head.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';

test.describe('мета-теги в отданном сервером HTML', () => {
  test('у /login, /projects и страницы проекта свои <title> и <meta name="description"> в <head>', async ({
    request,
    baseURL,
  }) => {
    const projectUrl = await ensureProjectUrlAsUser(baseURL!, PROJECT_NAME);
    // `/login` — гостем (вошедшего с него уводит серверный гард), остальные две — под сессией.
    const guest = await apiRequest.newContext({ baseURL, storageState: GUEST_STORAGE_STATE });
    const urls = ['/login', '/projects', projectUrl];
    const heads = await Promise.all([fetchHead(guest, '/login'), ...urls.slice(1).map(url => fetchHead(request, url))]);
    await guest.dispose();

    const titles = heads.map(titleOf);
    const descriptions = heads.map(descriptionOf);

    for (const [index, url] of urls.entries()) {
      expect(titles[index], `${url}: непустой <title>`).not.toBe('');
      expect(descriptions[index], `${url}: непустой <meta name="description">`).not.toBe('');
      expect(heads[index]!.match(/<title>/g), `${url}: ровно один <title>`).toHaveLength(1);
      expect(heads[index]!.match(/<meta name="description"/g), `${url}: ровно один description`).toHaveLength(1);
    }

    expect(new Set(titles).size, 'заголовки страниц не дублируют друг друга').toBe(titles.length);
    expect(new Set(descriptions).size, 'описания страниц не дублируют друг друга').toBe(descriptions.length);
  });
});
