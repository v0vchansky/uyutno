import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

const isProd = process.env.NODE_ENV === 'production';
const DEV_FALLBACK_SECRET = 'uyutno-dev-oauth-state-secret';

const readSecret = (): string => {
  const value = process.env.OAUTH_STATE_SECRET?.trim();
  if (value && value.length >= 16) return value;
  if (isProd) {
    throw new Error('OAUTH_STATE_SECRET is required in production (minimum 16 chars)');
  }
  return DEV_FALLBACK_SECRET;
};

export const OAUTH_STATE_COOKIE_NAME = 'oauth_state';
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface OAuthStatePayload {
  state: string;
  from: string | null;
}

export const generateOAuthState = (): string => randomBytes(32).toString('base64url');

const sign = (payload: string): string => {
  const secret = readSecret();
  return createHmac('sha256', secret).update(payload).digest('base64url');
};

const encode = (data: OAuthStatePayload): string => {
  const payload = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
  const signature = sign(payload);
  return `${payload}.${signature}`;
};

const decode = (raw: string): OAuthStatePayload | null => {
  const dot = raw.indexOf('.');
  if (dot <= 0 || dot === raw.length - 1) return null;

  const payload = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  const expected = sign(payload);

  const expectedBuf = Buffer.from(expected, 'base64url');
  const signatureBuf = Buffer.from(signature, 'base64url');
  if (expectedBuf.length !== signatureBuf.length) return null;
  if (!timingSafeEqual(expectedBuf, signatureBuf)) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const state = (parsed as { state?: unknown }).state;
    const from = (parsed as { from?: unknown }).from;
    if (typeof state !== 'string' || state.length === 0) return null;
    if (from !== null && typeof from !== 'string') return null;
    return { state, from };
  } catch {
    return null;
  }
};

export const setOAuthStateCookie = (res: Response, payload: OAuthStatePayload): void => {
  res.cookie(OAUTH_STATE_COOKIE_NAME, encode(payload), {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: OAUTH_STATE_TTL_MS,
  });
};

export const readOAuthStateCookie = (req: Request): OAuthStatePayload | null => {
  const raw = req.cookies?.[OAUTH_STATE_COOKIE_NAME];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return decode(raw);
};

export const clearOAuthStateCookie = (res: Response): void => {
  res.clearCookie(OAUTH_STATE_COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
  });
};
