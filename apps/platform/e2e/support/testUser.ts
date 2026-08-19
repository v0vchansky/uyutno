import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Общий e2e-пользователь и файл его сессии. `/project/:id` закрыт авторизацией (задача 0063), поэтому все
 * планерные спеки ходят в редактор под сессией: её один раз добывает `auth.setup.ts` (проект `setup` в
 * `playwright.config.ts`) и кладёт сюда, дальше Playwright подставляет cookie каждому контексту через `storageState`.
 *
 * Пользователь фиксированный, а не уникальный на прогон: `auth.setup.ts` переиспользует уже сохранённую сессию и
 * заводит/логинит пользователя только когда её нет. Иначе локальные прогоны быстро упирались бы в rate-limit
 * `/auth/register` (10/час на IP) и `/auth/login` (5/15 мин).
 */
export const E2E_USER = {
  email: 'e2e@uyutno.test',
  password: 'e2e-passw0rd',
  displayName: 'E2E-пользователь',
} as const;

/** Файл сессии (gitignore): переживает прогоны, пока жива сессия на сервере. */
export const STORAGE_STATE_PATH = path.resolve(fileURLToPath(import.meta.url), '../../.auth/user.json');

/** Пустое состояние для спек, которым нужен именно гость. */
export const GUEST_STORAGE_STATE = { cookies: [], origins: [] };
