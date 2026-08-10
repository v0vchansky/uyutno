import axios from 'axios';
import { buildAuthUrl } from '@app/auth';

const AUTH_PATHS: readonly string[] = ['/login', '/register', '/forgot-password', '/reset-password'];

export const UNAUTHORIZED_EVENT = 'auth:unauthorized';

export interface UnauthorizedEventDetail {
  target: string;
}

export const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  response => response,
  (error: unknown) => {
    if (typeof window === 'undefined') return Promise.reject(error);
    if (!axios.isAxiosError(error) || error.response?.status !== 401) return Promise.reject(error);
    if (AUTH_PATHS.includes(window.location.pathname)) return Promise.reject(error);

    const from = window.location.pathname + window.location.search;
    const target = buildAuthUrl('/login', from);
    window.dispatchEvent(new CustomEvent<UnauthorizedEventDetail>(UNAUTHORIZED_EVENT, { detail: { target } }));

    return Promise.reject(error);
  },
);
