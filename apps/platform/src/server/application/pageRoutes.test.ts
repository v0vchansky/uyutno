import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { CurrentUser } from '@server/auth';

import { registerPageRoutes } from './pageRoutes';

/**
 * Регрессия на список страничных гардов: какие пути закрыты авторизацией на сервере, какие — наоборот, закрыты
 * для вошедшего. Проверяем через настоящий express-инстанс, потому что половина смысла — в матчинге путей
 * (`/project/:id` как паттерн Express 5), а не только в содержимом массивов.
 */

const PAGE_BODY = 'PAGE';

interface TestServer {
  url: string;
  close: () => Promise<void>;
}

/** Поднимает приложение с теми же страничными роутами, что в `server.ts`, но с заглушкой вместо SSR-рендера. */
const startApp = async (user: CurrentUser | null): Promise<TestServer> => {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  registerPageRoutes(app, async (_req, res) => {
    res.send(PAGE_BODY);
  });

  const server: Server = await new Promise(resolve => {
    const created = app.listen(0, () => resolve(created));
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      }),
  };
};

const TEST_USER: CurrentUser = { id: 'user-1', email: 'user@uyutno.test', displayName: 'Тест' };

interface PageResponse {
  status: number;
  location: string | null;
  body: string;
}

const get = async (server: TestServer, path: string): Promise<PageResponse> => {
  const response = await fetch(`${server.url}${path}`, { redirect: 'manual' });
  return {
    status: response.status,
    location: response.headers.get('location'),
    body: await response.text(),
  };
};

describe('registerPageRoutes', () => {
  describe('гость', () => {
    let server: TestServer;

    beforeAll(async () => {
      server = await startApp(null);
    });
    afterAll(async () => {
      await server.close();
    });

    it.each([
      ['/project/01890abc', '/login?from=%2Fproject%2F01890abc'],
      ['/project/01890abc?tab=3d', '/login?from=%2Fproject%2F01890abc%3Ftab%3D3d'],
      ['/projects', '/login?from=%2Fprojects'],
    ])('%s закрыт авторизацией — редирект на %s, страница не рендерится', async (path, target) => {
      const response = await get(server, path);

      expect(response.status).toBe(302);
      expect(response.location).toBe(target);
      expect(response.body).not.toContain(PAGE_BODY);
    });

    it.each(['/', '/login', '/register', '/unknown-path'])('%s гостю доступен', async path => {
      const response = await get(server, path);

      expect(response.body).toBe(PAGE_BODY);
    });

    it('неизвестный путь отдаёт 404 с той же страницей (её отрисует NotFoundPage)', async () => {
      const response = await get(server, '/project/01890abc/unknown-segment');

      expect(response.status).toBe(404);
      expect(response.body).toBe(PAGE_BODY);
    });
  });

  describe('вошедший пользователь', () => {
    let server: TestServer;

    beforeAll(async () => {
      server = await startApp(TEST_USER);
    });
    afterAll(async () => {
      await server.close();
    });

    it.each(['/project/01890abc', '/projects'])('%s открывается без редиректа', async path => {
      const response = await get(server, path);

      expect(response.status).toBe(200);
      expect(response.body).toBe(PAGE_BODY);
    });

    it('со страницы входа уводит на исходный from', async () => {
      const response = await get(server, '/login?from=%2Fproject%2F01890abc');

      expect(response.status).toBe(302);
      expect(response.location).toBe('/project/01890abc');
    });
  });
});
