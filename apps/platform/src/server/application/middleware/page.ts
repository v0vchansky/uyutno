import type { Request, Response } from 'express';
import { createElement } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';

import { Application } from '../../../client/application';

const TITLE_FALLBACK = 'uyutno';

export const pageMiddleware = (cssHref: string, jsPath: string) => {
  return (request: Request, response: Response): void => {
    const appHtml = renderToString(createElement(StaticRouter, { location: request.url }, createElement(Application)));

    const markup = renderToStaticMarkup(
      createElement(
        'html',
        { lang: 'ru' },
        createElement(
          'head',
          null,
          createElement('meta', { charSet: 'utf-8' }),
          createElement('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
          createElement('title', null, TITLE_FALLBACK),
          cssHref ? createElement('link', { rel: 'stylesheet', href: cssHref }) : null,
        ),
        createElement(
          'body',
          null,
          createElement('div', { id: 'root', dangerouslySetInnerHTML: { __html: appHtml } }),
          createElement('script', { src: jsPath, defer: true }),
        ),
      ),
    );

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.send(`<!doctype html>${markup}`);
  };
};
