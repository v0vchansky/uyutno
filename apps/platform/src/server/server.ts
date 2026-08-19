import cookieParser from 'cookie-parser';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAuthRouter, createLogoutRouter, createOAuthCallbackRouter, createSessionMiddleware } from '@server/auth';
import {
  createClientAssetsResolver,
  createServerRegistry,
  errorMiddleware,
  pageMiddleware,
  registerPageRoutes,
} from '@server/application';
import { createProjectsRouter } from '@server/projects';

const PORT = 4000;
const STATIC_URL = '/static';

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

// NODE_ENV инлайнится webpack'ом (DefinePlugin) при сборке сервера: `pnpm dev` → development, `pnpm build` → production.
const resolveClientAssets = createClientAssetsResolver({
  staticDir: staticPath,
  staticUrl: STATIC_URL,
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
});

const page = pageMiddleware(resolveClientAssets, registry.oauthProviders);

registerPageRoutes(app, page);

app.use(errorMiddleware);

app.listen(PORT, () => {
  console.log(`uyutno platform запущена: http://localhost:${PORT}`);
});
