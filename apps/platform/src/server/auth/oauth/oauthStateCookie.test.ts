import type { Request, Response } from 'express';

import {
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_STATE_TTL_MS,
  generateOAuthState,
  readOAuthStateCookie,
  setOAuthStateCookie,
} from './oauthStateCookie';

interface FakeResponse {
  cookies: Record<string, { value: string; options: unknown }>;
}

const buildFakeResponse = (): { fake: FakeResponse; res: Response } => {
  const cookies: FakeResponse['cookies'] = {};
  const res = {
    cookie(name: string, value: string, options: unknown) {
      cookies[name] = { value, options };
      return res;
    },
    clearCookie() {
      return res;
    },
  } as unknown as Response;
  return { fake: { cookies }, res };
};

const buildFakeRequest = (cookieValue: string | undefined): Request =>
  ({
    cookies: cookieValue === undefined ? {} : { [OAUTH_STATE_COOKIE_NAME]: cookieValue },
  }) as unknown as Request;

describe('oauthStateCookie', () => {
  it('encode + decode возвращает payload с state и from', () => {
    const { fake, res } = buildFakeResponse();
    const state = generateOAuthState();
    setOAuthStateCookie(res, { state, from: '/projects/1' });

    const raw = fake.cookies[OAUTH_STATE_COOKIE_NAME]?.value;
    expect(typeof raw).toBe('string');

    const req = buildFakeRequest(raw);
    const parsed = readOAuthStateCookie(req);

    expect(parsed).toEqual({ state, from: '/projects/1' });
  });

  it('поддерживает from = null', () => {
    const { fake, res } = buildFakeResponse();
    setOAuthStateCookie(res, { state: 'abc', from: null });
    const parsed = readOAuthStateCookie(buildFakeRequest(fake.cookies[OAUTH_STATE_COOKIE_NAME]?.value));
    expect(parsed).toEqual({ state: 'abc', from: null });
  });

  it('возвращает null при подделке подписи', () => {
    const { fake, res } = buildFakeResponse();
    setOAuthStateCookie(res, { state: 'abc', from: null });

    const raw = fake.cookies[OAUTH_STATE_COOKIE_NAME]!.value;
    const dot = raw.indexOf('.');
    const tampered = `${raw.slice(0, dot)}.${'A'.repeat(raw.length - dot - 1)}`;

    expect(readOAuthStateCookie(buildFakeRequest(tampered))).toBeNull();
  });

  it('возвращает null при мусоре без точки', () => {
    expect(readOAuthStateCookie(buildFakeRequest('not-a-valid-cookie'))).toBeNull();
  });

  it('устанавливает cookie с корректным TTL и флагами', () => {
    const { fake, res } = buildFakeResponse();
    setOAuthStateCookie(res, { state: 'abc', from: null });
    const options = fake.cookies[OAUTH_STATE_COOKIE_NAME]!.options as Record<string, unknown>;
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.maxAge).toBe(OAUTH_STATE_TTL_MS);
  });
});
