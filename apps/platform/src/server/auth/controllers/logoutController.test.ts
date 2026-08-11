import type { Request, Response } from 'express';

import { SESSION_COOKIE_NAME } from '../lib/cookies';
import type { SessionManager } from '../managers/SessionManager';

import { createLogoutController } from './logoutController';

interface FakeResponseState {
  clearedCookies: Array<{ name: string; options: unknown }>;
  redirects: Array<{ status: number; target: string }>;
}

const buildFakeResponse = (): { state: FakeResponseState; res: Response } => {
  const state: FakeResponseState = { clearedCookies: [], redirects: [] };
  const res = {
    clearCookie(name: string, options: unknown) {
      state.clearedCookies.push({ name, options });
      return res;
    },
    redirect(status: number, target: string) {
      state.redirects.push({ status, target });
      return res;
    },
  } as unknown as Response;
  return { state, res };
};

const buildFakeRequest = (cookieValue: string | undefined): Request =>
  ({
    cookies: cookieValue === undefined ? {} : { [SESSION_COOKIE_NAME]: cookieValue },
  }) as unknown as Request;

interface FakeSessionManager extends Pick<SessionManager, 'revokeSession'> {
  revoked: string[];
}

const buildFakeSessionManager = (): FakeSessionManager => {
  const revoked: string[] = [];
  return {
    revoked,
    async revokeSession(sessionId: string) {
      revoked.push(sessionId);
    },
  };
};

describe('logoutController', () => {
  it('c валидной cookie — отзывает сессию, чистит cookie, редиректит 302 на /', async () => {
    const sessionManager = buildFakeSessionManager();
    const { state, res } = buildFakeResponse();
    const req = buildFakeRequest('session-abc');

    const handler = createLogoutController(sessionManager as unknown as SessionManager);
    await handler(req, res, () => {});

    expect(sessionManager.revoked).toEqual(['session-abc']);
    expect(state.clearedCookies).toHaveLength(1);
    expect(state.clearedCookies[0]?.name).toBe(SESSION_COOKIE_NAME);
    expect(state.redirects).toEqual([{ status: 302, target: '/' }]);
  });

  it('без cookie — не зовёт revokeSession, но всё равно чистит cookie и редиректит 302 на /', async () => {
    const sessionManager = buildFakeSessionManager();
    const { state, res } = buildFakeResponse();
    const req = buildFakeRequest(undefined);

    const handler = createLogoutController(sessionManager as unknown as SessionManager);
    await handler(req, res, () => {});

    expect(sessionManager.revoked).toEqual([]);
    expect(state.clearedCookies).toHaveLength(1);
    expect(state.clearedCookies[0]?.name).toBe(SESSION_COOKIE_NAME);
    expect(state.redirects).toEqual([{ status: 302, target: '/' }]);
  });
});
