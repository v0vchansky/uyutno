import { expect, request, test as setup } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { E2E_USER, STORAGE_STATE_PATH } from './support/testUser';

/**
 * Проект `setup` из `playwright.config.ts`: добывает сессию общего e2e-пользователя и сохраняет её в
 * `STORAGE_STATE_PATH`, откуда её берут остальные проекты. Нужен с задачи 0063 — `/project/:id` закрыт
 * авторизацией и на сервере (SSR-редирект), и на клиенте (`RequireAuth`).
 *
 * Порядок: живая сохранённая сессия → регистрация → вход (пользователь уже был заведён прошлым прогоном).
 */
setup('сессия e2e-пользователя', async ({ baseURL }) => {
  const context = await request.newContext({
    baseURL,
    storageState: existsSync(STORAGE_STATE_PATH) ? STORAGE_STATE_PATH : undefined,
  });

  const me = await context.get('/api/v1/auth/me');
  const isSessionAlive = me.ok() && ((await me.json()) as { user: unknown }).user !== null;

  if (!isSessionAlive) {
    const registered = await context.post('/api/v1/auth/register', { data: E2E_USER });
    if (!registered.ok()) {
      // 409 — пользователь уже заведён прошлым прогоном, это штатный путь. Всё остальное (429 от rate-limit,
      // 400 при разъехавшейся схеме) — повод упасть с внятной причиной, а не молча уйти в логин.
      expect(registered.status(), `POST /auth/register вернул ${registered.status()}: ${await registered.text()}`).toBe(
        409,
      );

      const loggedIn = await context.post('/api/v1/auth/login', {
        data: { email: E2E_USER.email, password: E2E_USER.password },
      });
      expect(loggedIn.ok(), `POST /auth/login вернул ${loggedIn.status()}: ${await loggedIn.text()}`).toBe(true);
    }
  }

  await mkdir(path.dirname(STORAGE_STATE_PATH), { recursive: true });
  await context.storageState({ path: STORAGE_STATE_PATH });
  await context.dispose();
});
