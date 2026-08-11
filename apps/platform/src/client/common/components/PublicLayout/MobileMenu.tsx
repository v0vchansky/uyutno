import { LogOut, Menu, Settings, X } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import type { User } from '@app/auth';

import { useRegistry } from '../../registry/useRegistry';

import { LANDING_NAV_ITEMS } from './landingNav';
import { displayNameOrEmailFallback, initialsFromName } from './userDisplay';

type Mode = 'guest-landing' | 'auth-landing' | 'app';

interface Props {
  mode: Mode;
  user: User | null;
}

const CLOSE_MS = 120;

export const MobileMenu: React.FC<Props> = ({ mode, user }) => {
  const navigate = useNavigate();
  const { authManager } = useRegistry();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const [isMounted, setIsMounted] = useState(false);
  const [isEntered, setIsEntered] = useState(false);

  const open = useCallback((): void => {
    setIsMounted(true);
    // следующий тик — переход в open-состояние
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setIsEntered(true));
    });
  }, []);

  const close = useCallback((): void => {
    setIsEntered(false);
    window.setTimeout(() => {
      setIsMounted(false);
      buttonRef.current?.focus();
    }, CLOSE_MS);
  }, []);

  const toggle = (): void => {
    if (isMounted) close();
    else open();
  };

  // блокируем прокрутку body, когда меню открыто
  useEffect(() => {
    if (!isMounted) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isMounted]);

  // Escape закрывает меню
  useEffect(() => {
    if (!isMounted) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMounted, close]);

  const handleNavClick = (): void => {
    close();
  };

  const handleSettings = (): void => {
    close();
    navigate('/settings');
  };

  const handleLogout = async (): Promise<void> => {
    close();
    try {
      await authManager.logout();
      navigate('/');
    } catch (error) {
       
      console.error('logout failed', error);
    }
  };

  const showLandingNav = mode === 'guest-landing' || mode === 'auth-landing';
  const showAuthLoginLink = mode === 'guest-landing';
  const showUserBlock = (mode === 'auth-landing' || mode === 'app') && user !== null;
  const showAppSettings = mode === 'app';

  return (
    <>
      <button
        ref={buttonRef}
        type='button'
        onClick={toggle}
        aria-label={isMounted ? 'Закрыть меню' : 'Открыть меню'}
        aria-expanded={isMounted}
        aria-controls={panelId}
        className='inline-flex h-11 w-11 items-center justify-center rounded-xl border-0 bg-[var(--default)] text-[color:var(--foreground)] transition-colors hover:bg-[color:var(--surface-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] lg:hidden'
      >
        {isMounted ? <X size={20} strokeWidth={1.5} /> : <Menu size={20} strokeWidth={1.5} />}
      </button>

      {isMounted ? (
        <div className='fixed inset-x-0 top-[65px] bottom-0 z-40 lg:hidden' role='presentation'>
          {/* затемнение */}
          <button
            type='button'
            tabIndex={-1}
            aria-hidden='true'
            onClick={close}
            className='absolute inset-0 border-0 bg-[rgb(0_0_0_/_0.40)] p-0 transition-opacity duration-[160ms] ease-out motion-reduce:transition-none data-[state=closed]:opacity-0'
            data-state={isEntered ? 'open' : 'closed'}
          />
          {/* панель */}
          <div
            id={panelId}
            className='absolute inset-x-0 top-0 flex origin-top -translate-y-2 flex-col gap-1 border-b border-[var(--separator)] bg-[var(--surface)] px-4 py-2 opacity-0 transition-[transform,opacity] duration-[160ms] ease-out data-[state=open]:translate-y-0 data-[state=open]:opacity-100 motion-reduce:transition-none'
            data-state={isEntered ? 'open' : 'closed'}
            role='dialog'
            aria-modal='false'
            aria-label='Меню'
          >
            {showLandingNav
              ? LANDING_NAV_ITEMS.map(item => (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={handleNavClick}
                    className='flex h-11 items-center rounded-xl px-3 text-[15px] text-[color:var(--foreground)] no-underline transition-colors hover:bg-[color:var(--surface-secondary)]'
                  >
                    {item.label}
                  </a>
                ))
              : null}

            {showAuthLoginLink ? (
              <>
                <div className='mx-3 my-1 h-px bg-[var(--separator)]' aria-hidden='true' />
                <Link
                  to='/login'
                  onClick={handleNavClick}
                  className='flex h-11 items-center rounded-xl px-3 text-[15px] text-[color:var(--foreground)] no-underline transition-colors hover:bg-[color:var(--surface-secondary)]'
                >
                  Войти
                </Link>
              </>
            ) : null}

            {showUserBlock && user ? (
              <>
                {showLandingNav ? <div className='mx-3 my-1 h-px bg-[var(--separator)]' aria-hidden='true' /> : null}
                <div className='flex h-11 items-center gap-3 px-3'>
                  <span
                    aria-hidden='true'
                    className='inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-secondary)] text-[13px] font-semibold'
                  >
                    {initialsFromName(displayNameOrEmailFallback(user))}
                  </span>
                  <span className='truncate text-[15px] font-medium'>{displayNameOrEmailFallback(user)}</span>
                </div>
                {showAppSettings ? (
                  <button
                    type='button'
                    onClick={handleSettings}
                    className='flex h-11 items-center gap-3 rounded-xl border-0 bg-transparent px-3 text-left text-[15px] text-[color:var(--foreground)] transition-colors hover:bg-[color:var(--surface-secondary)]'
                  >
                    <Settings size={18} strokeWidth={1.5} aria-hidden='true' />
                    Настройки
                  </button>
                ) : null}
                <button
                  type='button'
                  onClick={handleLogout}
                  className='flex h-11 items-center gap-3 rounded-xl border-0 bg-transparent px-3 text-left text-[15px] text-[color:var(--foreground)] transition-colors hover:bg-[color:var(--surface-secondary)]'
                >
                  <LogOut size={18} strokeWidth={1.5} aria-hidden='true' />
                  Выйти
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
};
