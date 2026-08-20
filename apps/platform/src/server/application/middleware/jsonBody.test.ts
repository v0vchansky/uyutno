import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { errorMiddleware } from './error';
import { createGlobalJsonParser } from './jsonBody';

/**
 * Отбор тел глобальным парсером. Здесь он написан руками (предикат `type`), поэтому дефолтное поведение
 * body-parser — «разбираю ровно `application/json`» — обязано быть воспроизведено, а не приблизительно
 * повторено: расширив отбор, парсер начал бы разбирать чужие тела, сузив — молча ломать существующие
 * маршруты.
 */

const EXCEPT = /^\/own-limit(?:[/?#]|$)/;

interface TestServer {
  url: string;
  close: () => Promise<void>;
}

const startApp = async (): Promise<TestServer> => {
  const app = express();
  app.use(createGlobalJsonParser({ except: [EXCEPT] }));

  const echo = (req: express.Request, res: express.Response): void => {
    res.json({ parsed: req.body === undefined ? null : req.body });
  };

  app.post('/plain', echo);
  // Свой лимит: сработает только если глобальный парсер этот путь не тронул.
  app.post('/own-limit', express.json({ limit: '1kb' }), echo);

  app.use(errorMiddleware);

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

const post = async (
  server: TestServer,
  path: string,
  contentType: string,
  body: string,
): Promise<{ status: number; body: { parsed?: unknown; error?: unknown } }> => {
  const response = await fetch(`${server.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
  return { status: response.status, body: (await response.json()) as { parsed?: unknown } };
};

describe('createGlobalJsonParser', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startApp();
  });
  afterAll(async () => {
    await server.close();
  });
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['application/json', true],
    ['application/json; charset=utf-8', true],
    ['APPLICATION/JSON', true],
    ['text/plain', false],
    ['application/x-www-form-urlencoded', false],
  ])('content-type %s разбирается: %s', async (contentType, parsed) => {
    const response = await post(server, '/plain', contentType, JSON.stringify({ note: 'ok' }));

    expect(response.body.parsed).toEqual(parsed ? { note: 'ok' } : null);
  });

  it('исключённый путь глобальный парсер не трогает — работает роут-локальный лимит', async () => {
    const response = await post(server, '/own-limit', 'application/json', JSON.stringify({ note: 'x'.repeat(2048) }));

    expect(response.status).toBe(413);
  });

  it('на исключённом пути роут-локальный парсер всё же разбирает тело в пределах своего лимита', async () => {
    const response = await post(server, '/own-limit', 'application/json', JSON.stringify({ note: 'ok' }));

    expect(response.status).toBe(200);
    expect(response.body.parsed).toEqual({ note: 'ok' });
  });
});
