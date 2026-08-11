import cookieParser from 'cookie-parser';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAuthRouter,
  createLogoutRouter,
  createOAuthCallbackRouter,
  createSessionMiddleware,
  redirectIfAuthenticated,
  requireAuth,
} from '@server/auth';
import { createServerRegistry, errorMiddleware, pageMiddleware } from '@server/application';
import { createProjectsRouter } from '@server/projects';

const PORT = 4000;
const STATIC_URL = '/static';

const AUTH_PAGE_PATHS = ['/login', '/register', '/forgot-password', '/reset-password'];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticPath = path.resolve(__dirname, '../../dist/client');
const publicPath = path.resolve(__dirname, '../../public');

const app = express();
const registry = createServerRegistry();

app.disable('etag');
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(createSessionMiddleware(registry.authManager));

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use(
  '/api/v1/auth',
  createAuthRouter({
    authManager: registry.authManager,
    sessionManager: registry.sessionManager,
    oauthProviders: registry.oauthProviders,
  }),
);
app.use(
  '/auth/callback',
  createOAuthCallbackRouter({
    oauthProviders: registry.oauthProviders,
    oauthManager: registry.oauthManager,
  }),
);
app.use('/auth', createLogoutRouter({ sessionManager: registry.sessionManager }));

app.use('/api/v1/projects', createProjectsRouter({ projectsManager: registry.projectsManager }));

app.use(STATIC_URL, express.static(staticPath));
app.use(express.static(publicPath));

const cssFile = fs.readdirSync(staticPath).find(f => f.endsWith('.css'));
const cssHref = cssFile ? `${STATIC_URL}/${cssFile}` : '';

const jsFile = fs.readdirSync(staticPath).find(f => f.endsWith('.js'));
const jsPath = `${STATIC_URL}/${jsFile}`;

const page = pageMiddleware(cssHref, jsPath, registry.oauthProviders);

for (const authPath of AUTH_PAGE_PATHS) {
  app.get(authPath, redirectIfAuthenticated, page);
}
app.get('/_page-check', requireAuth('page'), page);
app.get('/{*splat}', page);

app.use(errorMiddleware);

app.listen(PORT, () => {
  console.log(`uyutno platform запущена: http://localhost:${PORT}`);
});
