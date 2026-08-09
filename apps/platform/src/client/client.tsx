import '@fontsource-variable/inter';
import '@fontsource/nunito/700.css';
import './global.css';

import { hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { Application } from '@app/application';

const container = document.getElementById('root');

if (container) {
  hydrateRoot(
    container,
    <BrowserRouter>
      <Application />
    </BrowserRouter>,
  );
}
