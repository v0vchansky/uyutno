import { normalizeFromParam } from './normalizeFromParam';

export type AuthTarget = '/login' | '/register' | '/forgot-password' | '/reset-password';

export const buildAuthUrl = (target: AuthTarget, from: string | null | undefined): string => {
  const normalized = normalizeFromParam(from);
  if (!normalized) return target;
  return `${target}?from=${encodeURIComponent(normalized)}`;
};
