import type React from 'react';

import { INITIAL_STATE_GLOBAL } from '../../initialState';

interface Props {
  cssHref: string;
  jsPath: string;
  initialStateJson: string;
  children: React.ReactNode;
}

export const Document: React.FC<Props> = ({ cssHref, jsPath, initialStateJson, children }) => {
  return (
    <html lang='ru'>
      <head>
        <meta charSet='utf-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
        <meta name='theme-color' content='#D65400' />
        <link rel='icon' type='image/svg+xml' sizes='32x32' href='/favicon.svg' />
        <link rel='icon' type='image/svg+xml' sizes='16x16' href='/favicon-16.svg' />
        <link rel='apple-touch-icon' sizes='180x180' href='/apple-touch-icon.svg' />
        {cssHref ? <link rel='stylesheet' href={cssHref} /> : null}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.${INITIAL_STATE_GLOBAL}=${initialStateJson};`,
          }}
        />
        <script src={jsPath} defer />
      </head>
      <body>
        <div id='root'>{children}</div>
      </body>
    </html>
  );
};
