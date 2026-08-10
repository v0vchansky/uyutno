import type { Request, RequestHandler, Response } from 'express';

import { NotFoundError, ValidationError } from '@server/common';

import { setSessionCookie } from '../lib/cookies';
import { normalizeFromParam } from '../lib/normalizeFromParam';
import type { OAuthManager } from '../managers/OAuthManager';
import type { OAuthProviderRegistry } from '../oauth/providers';
import { buildRedirectUri } from '../oauth/redirectUri';
import { clearOAuthStateCookie, readOAuthStateCookie } from '../oauth/oauthStateCookie';

const DEFAULT_TARGET = '/projects';

const buildErrorRedirect = (code: 'oauth_email_taken' | 'oauth_no_email', from: string | null): string => {
  const params = new URLSearchParams({ error: code });
  const normalizedFrom = normalizeFromParam(from);
  if (normalizedFrom) params.set('from', normalizedFrom);
  return `/login?${params.toString()}`;
};

export const createOAuthCallbackController =
  (providers: OAuthProviderRegistry, oauthManager: OAuthManager): RequestHandler =>
  async (req: Request, res: Response): Promise<void> => {
    const providerId = typeof req.params.provider === 'string' ? req.params.provider : '';
    const provider = providers.get(providerId);
    if (!provider) throw new NotFoundError('OAuth-провайдер не найден');

    const statePayload = readOAuthStateCookie(req);
    clearOAuthStateCookie(res);

    const queryState = typeof req.query.state === 'string' ? req.query.state : '';
    if (!statePayload || statePayload.state !== queryState) {
      throw new ValidationError('Некорректный OAuth state');
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (code.length === 0) {
      throw new ValidationError('OAuth: отсутствует код авторизации');
    }

    const redirectUri = buildRedirectUri(provider.id);
    const profile = await provider.exchangeCode(code, redirectUri);

    const result = await oauthManager.signInOrRegister({
      provider: provider.id,
      providerUserId: profile.providerUserId,
      email: profile.email,
    });

    if (result.kind === 'session') {
      setSessionCookie(res, result.sessionId);
      res.redirect(normalizeFromParam(statePayload.from) ?? DEFAULT_TARGET);
      return;
    }

    if (result.kind === 'email-taken') {
      res.redirect(buildErrorRedirect('oauth_email_taken', statePayload.from));
      return;
    }

    res.redirect(buildErrorRedirect('oauth_no_email', statePayload.from));
  };
