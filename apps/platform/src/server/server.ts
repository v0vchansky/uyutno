import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pageMiddleware } from '@server/application';

const PORT = 4000;
const STATIC_URL = '/static';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticPath = path.resolve(__dirname, '../../dist/client');
const publicPath = path.resolve(__dirname, '../../public');

const app = express();

app.disable('etag');
app.use(express.json({ limit: '10mb' }));

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use(STATIC_URL, express.static(staticPath));
app.use(express.static(publicPath));

const cssFile = fs.readdirSync(staticPath).find(f => f.endsWith('.css'));
const cssHref = cssFile ? `${STATIC_URL}/${cssFile}` : '';

const jsFile = fs.readdirSync(staticPath).find(f => f.endsWith('.js'));
const jsPath = `${STATIC_URL}/${jsFile}`;

app.get('/{*splat}', pageMiddleware(cssHref, jsPath));

app.listen(PORT, () => {
  console.log(`uyutno platform запущена: http://localhost:${PORT}`);
});
