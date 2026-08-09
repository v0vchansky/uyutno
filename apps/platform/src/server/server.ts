import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

import { pageMiddleware } from '@server/application';

const PORT = 4000;
const STATIC_URL = '/static';

const CLIENT_DIST = path.resolve(process.cwd(), 'apps/platform/dist/client');

const app = express();

app.disable('etag');
app.use(express.json({ limit: '10mb' }));

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use(STATIC_URL, express.static(CLIENT_DIST));

const cssFile = fs.existsSync(CLIENT_DIST) ? fs.readdirSync(CLIENT_DIST).find(f => f.endsWith('.css')) : undefined;
const jsFile = fs.existsSync(CLIENT_DIST) ? fs.readdirSync(CLIENT_DIST).find(f => f.endsWith('.js')) : undefined;

const cssHref = cssFile ? `${STATIC_URL}/${cssFile}` : '';
const jsPath = jsFile ? `${STATIC_URL}/${jsFile}` : `${STATIC_URL}/bundle.js`;

app.get('/{*splat}', pageMiddleware(cssHref, jsPath));

app.listen(PORT, () => {
   
  console.log(`uyutno platform запущена: http://localhost:${PORT}`);
});
