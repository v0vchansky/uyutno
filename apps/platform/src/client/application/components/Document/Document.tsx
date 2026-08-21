import type React from 'react';

import { BOOTSTRAP_SCRIPT_ID, type ClientAssets } from '../../initialState';

interface Props {
  assets: ClientAssets;
  /** Готовое тело инлайнового скрипта-бутстрапа: сервер его собирает, клиент читает из DOM (`initialState.ts`). */
  bootstrapScript: string;
  children: React.ReactNode;
}

/**
 * Целый документ страницы. Рендерится **обеими** сторонами: сервером — в HTML, клиентом — в гидрацию от
 * `document` (`roots.tsx`). Поэтому здесь не должно появляться ничего, что считается по-разному на сервере и в
 * браузере (`Date.now()`, `window`, случайные значения): расхождение тут — расхождение всей страницы.
 *
 * `<title>` и `<meta name="description">` сюда не пишутся намеренно: их рендерит каждая страница, а React 19
 * поднимает их в этот `<head>` (правило «Мета для страниц», `client/CLAUDE.md`).
 */
export const Document: React.FC<Props> = ({ assets, bootstrapScript, children }) => {
  return (
    <html lang='ru'>
      <head>
        <meta charSet='utf-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
        <meta name='theme-color' content='#D65400' />
        <link rel='icon' type='image/svg+xml' sizes='32x32' href='/favicon.svg' />
        <link rel='icon' type='image/svg+xml' sizes='16x16' href='/favicon-16.svg' />
        <link rel='apple-touch-icon' sizes='180x180' href='/apple-touch-icon.svg' />
        {assets.cssHref ? <link rel='stylesheet' href={assets.cssHref} /> : null}
        <script id={BOOTSTRAP_SCRIPT_ID} dangerouslySetInnerHTML={{ __html: bootstrapScript }} />
        <script src={assets.jsPath} defer />
      </head>
      <body>
        <div id='root'>{children}</div>
      </body>
    </html>
  );
};
