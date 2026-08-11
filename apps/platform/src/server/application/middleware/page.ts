import type { Request, Response } from 'express';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';

import type { OAuthProviderRegistry } from '@server/auth';

import { Application, createRegistry, Document, serializeInitialState } from '../../../client/application';

export const pageMiddleware = (cssHref: string, jsPath: string, oauthProviders: OAuthProviderRegistry) => {
  return (request: Request, response: Response): void => {
    const initialState = {
      user: request.user,
      oauthEnabledProviders: oauthProviders.getEnabledIds(),
    };
    const registry = createRegistry(initialState);

    const html = renderToString(
      createElement(Document, {
        cssHref,
        jsPath,
        initialStateJson: serializeInitialState(initialState),
        children: createElement(StaticRouter, { location: request.url }, createElement(Application, { registry })),
      }),
    );

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.send(`<!doctype html>${html}`);
  };
};
