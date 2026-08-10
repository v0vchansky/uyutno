import '@fontsource-variable/inter';
import '@fontsource/nunito/700.css';
import './global.css';

import { hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { Application, createRegistry, type InitialState } from '@app/application';

declare global {
  interface Window {
    __INITIAL_STATE__?: InitialState;
  }
}

const container = document.getElementById('root');

if (container) {
  const initialState = window.__INITIAL_STATE__ ?? { user: null };
  const registry = createRegistry(initialState);

  hydrateRoot(
    container,
    <BrowserRouter>
      <Application registry={registry} />
    </BrowserRouter>,
  );
}
