import type React from 'react';
import { Link, useLocation } from 'react-router';

import { useRegistry } from '../../registry/useRegistry';

import { Logo } from './Logo';

const NAV_ITEMS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '#features', label: 'Возможности' },
  { href: '#how', label: 'Как это работает' },
  { href: '#faq', label: 'Вопросы' },
];

const HOME_ONLY_NAV_PATHS = new Set<string>(['/']);

const displayNameOrEmailFallback = (user: { displayName: string | null; email: string }): string => {
  if (user.displayName && user.displayName.length > 0) return user.displayName;
  const at = user.email.indexOf('@');
  return at > 0 ? user.email.slice(0, at) : user.email;
};

export const PublicHeader: React.FC = () => {
  const { pathname } = useLocation();
  const { authManager } = useRegistry();
  const currentUser = authManager.getCurrentUser();
  const isAuthenticated = currentUser !== null;
  const showNav = HOME_ONLY_NAV_PATHS.has(pathname);
  const showLogin = !isAuthenticated && pathname !== '/login';
  const showRegister = !isAuthenticated && pathname !== '/register';

  return (
    <header className='border-b border-[var(--separator)] bg-[var(--surface)]'>
      <div className='mx-auto flex max-w-[1200px] items-center gap-3 px-4 py-3 md:gap-6 md:px-6 lg:px-8'>
        <Link to='/' aria-label='уютно — на главную' className='mr-2 inline-flex items-center no-underline'>
          <Logo variant='header' />
        </Link>

        {showNav ? (
          <nav className='hidden flex-1 items-center gap-1 lg:flex' aria-label='Разделы страницы'>
            {NAV_ITEMS.map(item => (
              <a key={item.href} href={item.href} className='button button--ghost'>
                {item.label}
              </a>
            ))}
          </nav>
        ) : (
          <span className='flex-1' />
        )}

        {showNav ? <span className='flex-1 lg:hidden' /> : null}

        <div className='flex items-center gap-2'>
          {isAuthenticated && currentUser ? (
            <>
              <span
                className='max-w-[120px] truncate text-[14px] text-[color:var(--foreground-secondary)] md:max-w-[200px]'
                title={displayNameOrEmailFallback(currentUser)}
              >
                {displayNameOrEmailFallback(currentUser)}
              </span>
              <Link to='/projects' className='button button--lg button--primary'>
                <span className='md:hidden'>Кабинет</span>
                <span className='hidden md:inline'>В личный кабинет</span>
              </Link>
            </>
          ) : (
            <>
              {showLogin ? (
                <Link to='/login' className='button button--lg button--tertiary hidden md:inline-flex'>
                  Войти
                </Link>
              ) : null}
              {showRegister ? (
                <Link to='/register' className='button button--lg button--primary'>
                  <span className='md:hidden'>Создать</span>
                  <span className='hidden md:inline'>Создать проект</span>
                </Link>
              ) : null}
            </>
          )}
        </div>
      </div>
    </header>
  );
};
