import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { NotFoundError } from '../../common';

import { errorMiddleware } from './error';

/**
 * Регрессия на доставку кода ошибки клиенту. Половина смысла — в ошибках, которые порождает не наш код,
 * а сам Express (`express.json` → `entity.too.large`, `entity.parse.failed`), поэтому приложение поднимается
 * настоящее: только так эти ошибки вообще возникают.
 */

const BODY_LIMIT = '1kb';
const SECRET = 'postgres://uyutno:hunter2@localhost:5432/uyutno';

interface TestServer {
  url: string;
  close: () => Promise<void>;
}

const startApp = async (): Promise<TestServer> => {
  const app = express();
  app.use(express.json({ limit: BODY_LIMIT }));

  app.post('/echo', (req, res) => {
    res.json(req.body);
  });
  app.get('/app-error', () => {
    throw new NotFoundError('Project not found');
  });
  app.get('/boom', () => {
    throw new Error(`connect ECONNREFUSED ${SECRET}`);
  });
  app.get('/upstream', () => {
    throw Object.assign(new Error(`upstream ${SECRET} refused`), { status: 503 });
  });

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

interface TestResponse {
  status: number;
  text: string;
  body: { error?: unknown; code?: unknown };
}

const request = async (server: TestServer, path: string, init?: RequestInit): Promise<TestResponse> => {
  const response = await fetch(`${server.url}${path}`, init);
  const text = await response.text();

  return { status: response.status, text, body: JSON.parse(text) as TestResponse['body'] };
};

const postJson = (server: TestServer, payload: string): Promise<TestResponse> =>
  request(server, '/echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });

describe('errorMiddleware', () => {
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

  it('тело сверх лимита — 413, а не 500', async () => {
    const response = await postJson(server, JSON.stringify({ note: 'x'.repeat(2048) }));

    expect(response.status).toBe(413);
    expect(typeof response.body.error).toBe('string');
    expect(response.body.error).not.toBe('');
  });

  it('битый JSON — 400, а не 500', async () => {
    const response = await postJson(server, '{"note": ');

    expect(response.status).toBe(400);
    expect(typeof response.body.error).toBe('string');
    expect(response.body.error).not.toBe('');
  });

  it('ошибка Express не логируется как 5xx', async () => {
    await postJson(server, JSON.stringify({ note: 'x'.repeat(2048) }));

    expect(console.error).not.toHaveBeenCalled();
  });

  it('наш AppError по-прежнему отдаёт свой статус и сообщение', async () => {
    const response = await request(server, '/app-error');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Project not found');
  });

  it('ошибка со статусом 5xx не выносит своё сообщение наружу', async () => {
    const response = await request(server, '/upstream');

    expect(response.status).toBe(503);
    expect(response.text).not.toContain(SECRET);
    expect(console.error).toHaveBeenCalled();
  });

  it('неопознанная ошибка — 500, детали наружу не утекают', async () => {
    const response = await request(server, '/boom');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
    expect(response.text).not.toContain(SECRET);
    expect(console.error).toHaveBeenCalled();
  });
});
