import type { Express, Request, Response } from 'express';

import { redirectIfAuthenticated, requireAuth } from '@server/auth';

import { Route, isKnownPagePath } from '../../shared/router/routes';

/** SSR-рендер страницы: `pageMiddleware` возвращает именно такой обработчик. */
type PageHandler = (request: Request, response: Response) => Promise<void>;

/** Страницы входа: вошедшего с них уводит `redirectIfAuthenticated` — на `?from=`, иначе в кабинет. */
const AUTH_PAGE_PATHS = [Route.Login, Route.Register, Route.ForgotPassword, Route.ResetPassword];

/**
 * Страницы, закрытые авторизацией. Список — зеркало ветки `RequireAuth` в клиентском `Router.tsx`: без серверного
 * гарда hard-load отдал бы SSR-шелл, а на `/login` увело бы только после гидрации — мигание пустым содержимым.
 * Пути берём из общего enum `Route`; значения обязаны оставаться валидными паттернами для обоих матчеров —
 * Express 5 (path-to-regexp v8) и react-router. `/project/:id` понимают оба, react-router-овские `*`/`?` — нет.
 */
const AUTH_REQUIRED_PAGE_PATHS = [Route.Projects, Route.Project];

/**
 * Страничные (не API) роуты SSR: гарды авторизации и 404 для неизвестных путей. Регистрируются после статики и
 * API-роутеров — сплат в конце перехватывает всё оставшееся.
 */
export const registerPageRoutes = (app: Express, page: PageHandler): void => {
  for (const authPath of AUTH_PAGE_PATHS) {
    app.get(authPath, redirectIfAuthenticated, page);
  }
  for (const requireAuthPath of AUTH_REQUIRED_PAGE_PATHS) {
    app.get(requireAuthPath, requireAuth('page'), page);
  }
  app.get('/_page-check', requireAuth('page'), page);
  app.get('/{*splat}', (req, res) => {
    if (!isKnownPagePath(req.path)) {
      res.status(404);
    }
    return page(req, res);
  });
};
