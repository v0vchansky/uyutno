import type { Request, Response } from 'express';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';

import { Application, Document } from '../../../client/application';

export const pageMiddleware = (cssHref: string, jsPath: string) => {
  return (request: Request, response: Response): void => {
    const html = renderToString(
      createElement(Document, {
        cssHref,
        jsPath,
        children: createElement(StaticRouter, { location: request.url }, createElement(Application)),
      }),
    );

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.send(`<!doctype html>${html}`);
  };
};
