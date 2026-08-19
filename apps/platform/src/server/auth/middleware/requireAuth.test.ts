import type { Request, Response } from 'express';

import { UnauthorizedError } from '@server/common';

import { requireAuth } from './requireAuth';

/**
 * Сам гард path-agnostic: какие пути им закрыты — регрессия в `application/pageRoutes.test.ts`, здесь — поведение
 * middleware: редирект страницы на вход с исходным адресом в `?from=` против 401 для API.
 */

interface FakeResponseState {
  redirects: string[];
}

const buildFakeResponse = (): { state: FakeResponseState; res: Response } => {
  const state: FakeResponseState = { redirects: [] };
  const res = {
    redirect(target: string) {
      state.redirects.push(target);
      return res;
    },
  } as unknown as Response;
  return { state, res };
};

/** `sessionMiddleware` кладёт в `req.user` либо пользователя, либо `null` — гость приходит именно с `null`. */
const buildFakeRequest = (originalUrl: string, user: { id: string } | null = null): Request =>
  ({ originalUrl, user }) as unknown as Request;

describe('requireAuth', () => {
  describe("kind = 'page'", () => {
    it('гость на /project/:id — редирект на /login с исходным путём в from', () => {
      const { state, res } = buildFakeResponse();
      const next = jest.fn();

      requireAuth('page')(buildFakeRequest('/project/01890abc'), res, next);

      expect(state.redirects).toEqual(['/login?from=%2Fproject%2F01890abc']);
      expect(next).not.toHaveBeenCalled();
    });

    it('гость на /project/:id с query — query сохраняется в from', () => {
      const { state, res } = buildFakeResponse();

      requireAuth('page')(buildFakeRequest('/project/01890abc?tab=3d'), res, jest.fn());

      expect(state.redirects).toEqual(['/login?from=%2Fproject%2F01890abc%3Ftab%3D3d']);
    });

    it('originalUrl не прошёл normalizeFromParam — падаем на голый /login, from не подставляем', () => {
      const { state, res } = buildFakeResponse();

      requireAuth('page')(buildFakeRequest('//evil.example/project/1'), res, jest.fn());

      expect(state.redirects).toEqual(['/login']);
    });

    it('вошедший пользователь — пропускаем дальше, без редиректа', () => {
      const { state, res } = buildFakeResponse();
      const next = jest.fn();

      requireAuth('page')(buildFakeRequest('/project/01890abc', { id: 'user-1' }), res, next);

      expect(state.redirects).toEqual([]);
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe("kind = 'api'", () => {
    it('гость — UnauthorizedError в next, без редиректа', () => {
      const { state, res } = buildFakeResponse();
      const next = jest.fn();

      requireAuth('api')(buildFakeRequest('/api/v1/projects'), res, next);

      expect(state.redirects).toEqual([]);
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0]?.[0]).toBeInstanceOf(UnauthorizedError);
    });

    it('вошедший пользователь — пропускаем дальше', () => {
      const { res } = buildFakeResponse();
      const next = jest.fn();

      requireAuth('api')(buildFakeRequest('/api/v1/projects', { id: 'user-1' }), res, next);

      expect(next).toHaveBeenCalledWith();
    });
  });
});
