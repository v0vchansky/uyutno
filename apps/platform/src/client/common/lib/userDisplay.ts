import type { User } from '@app/auth';

/**
 * Имя для отображения в UI. Если у пользователя задано displayName — берём его,
 * иначе — часть до @ из email (fallback на весь email, если @ нет).
 */
export const displayNameOrEmailFallback = (user: Pick<User, 'displayName' | 'email'>): string => {
  if (user.displayName && user.displayName.length > 0) return user.displayName;
  const at = user.email.indexOf('@');
  return at > 0 ? user.email.slice(0, at) : user.email;
};

/**
 * Инициалы для аватара: до двух заглавных букв из displayName / email.
 * «Анна Коваль» → «АК», «vova» → «V», «test@uyutno.dev» → «T».
 */
export const initialsFromName = (name: string): string => {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]!.charAt(0) + parts[1]!.charAt(0)).toUpperCase();
  }
  return parts[0]!.charAt(0).toUpperCase();
};
