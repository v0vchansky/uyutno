import '@fontsource-variable/inter';
import '@fontsource/nunito/700.css';
import './global.css';

import { hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { Application, createRegistry } from '@app/application';

const container = document.getElementById('root');

if (container) {
  const registry = createRegistry();

  hydrateRoot(
    container,
    <BrowserRouter>
      <Application registry={registry} />
    </BrowserRouter>,
  );
}
