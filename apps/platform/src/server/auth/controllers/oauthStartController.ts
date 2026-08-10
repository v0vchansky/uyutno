import type { Request, RequestHandler, Response } from 'express';

import { NotFoundError } from '@server/common';

import { normalizeFromParam } from '../lib/normalizeFromParam';
import type { OAuthProviderRegistry } from '../oauth/providers';
import { buildRedirectUri } from '../oauth/redirectUri';
import { generateOAuthState, setOAuthStateCookie } from '../oauth/oauthStateCookie';

export const createOAuthStartController =
  (providers: OAuthProviderRegistry): RequestHandler =>
  (req: Request, res: Response): void => {
    const providerId = typeof req.params.provider === 'string' ? req.params.provider : '';
    const provider = providers.get(providerId);
    if (!provider) throw new NotFoundError('OAuth-провайдер не найден');

    const from = normalizeFromParam(req.query.from);
    const state = generateOAuthState();
    const redirectUri = buildRedirectUri(provider.id);

    setOAuthStateCookie(res, { state, from });
    res.redirect(provider.getAuthorizeUrl(state, redirectUri));
  };
