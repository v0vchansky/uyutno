const ALLOWED_CHARS = /^\/[a-zA-Z0-9\-_/?=&.%]*$/;

export const normalizeFromParam = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > 2048) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  if (raw.includes('\\')) return null;
  if (!ALLOWED_CHARS.test(raw)) return null;

  return raw;
};
