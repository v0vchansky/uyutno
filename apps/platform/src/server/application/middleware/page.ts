import type { Request, Response } from 'express';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import type { OAuthProviderRegistry } from '@server/auth';

import { type InitialState, ServerRoot, serializeBootstrap } from '../../../client/application';
import type { ClientAssets, ClientAssetsResolver } from '../clientAssets';

interface RenderPageOptions {
  /** Адрес запроса — его получает `StaticRouter`. */
  url: string;
  initialState: InitialState;
  assets: ClientAssets;
}

/**
 * Готовый HTML страницы.
 *
 * Рендерится **целый документ** (`ServerRoot` → `Document`) — от него же идёт гидрация на клиенте. Двух разных
 * корней тут быть не должно: `useId` считается от корня рендера, и поддерево вместо документа развело бы
 * идентификаторы (задача 0091, разбор — в `client/application/roots.tsx`). Рендерить одно поддерево нельзя и по
 * второй причине: `<title>` и `<meta name="description">` страниц React поднимает в `<head>` только когда сам
 * рендерит `<html>`, иначе они остаются внутри `#root`.
 */
export const renderPageHtml = ({ url, initialState, assets }: RenderPageOptions): string =>
  `<!doctype html>${renderToString(
    createElement(ServerRoot, {
      location: url,
      initialState,
      assets,
      bootstrapScript: serializeBootstrap(initialState, assets),
    }),
  )}`;

export const pageMiddleware = (resolveClientAssets: ClientAssetsResolver, oauthProviders: OAuthProviderRegistry) => {
  return async (request: Request, response: Response): Promise<void> => {
    // Пути бандлов — на каждый запрос: в dev это ожидание клиентского watch (гонка при старте), в prod — кэш.
    const assets = await resolveClientAssets();
    const initialState: InitialState = {
      user: request.user,
      oauthEnabledProviders: oauthProviders.getEnabledIds(),
    };

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.send(renderPageHtml({ url: request.url, initialState, assets }));
  };
};
