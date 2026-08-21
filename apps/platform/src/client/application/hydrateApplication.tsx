import { hydrateRoot } from 'react-dom/client';

import type { InitialState } from './createRegistry';
import { BOOTSTRAP_SCRIPT_ID, type ClientAssets } from './initialState';
import { ClientRoot } from './roots';

declare global {
  interface Window {
    __INITIAL_STATE__?: InitialState;
    __CLIENT_ASSETS__?: ClientAssets;
  }
}

const FALLBACK_STATE: InitialState = { user: null, oauthEnabledProviders: [] };
const FALLBACK_ASSETS: ClientAssets = { cssHref: '', jsPath: '' };

/**
 * Клиентский бутстрап: гидрация тем же корнем, каким сервер отрендерил страницу (`roots.tsx`).
 *
 * Вынесен из `client.tsx` в модуль, чтобы точка входа осталась ровно тем, чем она является, — списком
 * импортов стилей и одним вызовом, а сам корень лежал рядом со своим серверным близнецом.
 */
export const hydrateApplication = (): void => {
  hydrateRoot(
    // Контейнер — **документ целиком**, а не `#root`: сервер рендерит от `<html>`, и корни обязаны совпадать
    // (`roots.tsx`). Пути бандлов и текст скрипта-бутстрапа клиент берёт из того, что отдал сервер, чтобы
    // `<head>` совпал посимвольно.
    document,
    <ClientRoot
      initialState={window.__INITIAL_STATE__ ?? FALLBACK_STATE}
      assets={window.__CLIENT_ASSETS__ ?? FALLBACK_ASSETS}
      bootstrapScript={document.getElementById(BOOTSTRAP_SCRIPT_ID)?.textContent ?? ''}
    />,
  );
};
