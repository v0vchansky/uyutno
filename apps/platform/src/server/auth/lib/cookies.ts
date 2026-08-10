import type { Response } from 'express';

export const SESSION_COOKIE_NAME = 'session_id';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const isProd = process.env.NODE_ENV === 'production';

export const setSessionCookie = (res: Response, sessionId: string): void => {
  res.cookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
};

export const clearSessionCookie = (res: Response): void => {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
  });
};
