import type React from 'react';

import { useRegistry } from '../../registry/useRegistry';

import { PublicFooter } from './PublicFooter';
import { PublicHeader } from './PublicHeader';

/**
 * Внешний режим страницы. Автоматика:
 * `landing` — выбирает `guest-landing` / `auth-landing` по состоянию сессии.
 * `app` — для /projects, /settings и других экранов приложения.
 * `auth` — для /login, /register, /forgot-password, /reset-password.
 */
export type PublicLayoutMode = 'landing' | 'app' | 'auth';

interface Props {
  children: React.ReactNode;
  mode?: PublicLayoutMode;
}

export const PublicLayout: React.FC<Props> = ({ children, mode = 'landing' }) => {
  const { authManager } = useRegistry();
  const currentUser = authManager.getCurrentUser();

  const resolvedMode = mode === 'landing' ? (currentUser ? 'auth-landing' : 'guest-landing') : mode;

  // На страницах приложения (`/projects`, `/settings`) — серый фон под шапкой.
  const bgClass = resolvedMode === 'app' ? 'bg-[var(--background)]' : 'bg-[var(--surface)]';

  return (
    <div className={`flex min-h-screen flex-col ${bgClass} text-[color:var(--foreground)]`}>
      <PublicHeader mode={resolvedMode} user={currentUser} />
      <main className='flex-1'>{children}</main>
      <PublicFooter mode={resolvedMode} />
    </div>
  );
};
