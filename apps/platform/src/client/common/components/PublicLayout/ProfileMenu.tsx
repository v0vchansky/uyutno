import { ChevronDown, LogOut, Settings } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import type { User } from '@app/auth';

import { useRegistry } from '../../registry/useRegistry';

import { displayNameOrEmailFallback, initialsFromName } from './userDisplay';

interface Props {
  user: User;
  /**
   * `compact` — только аватар в квадрате + шеврон (для вошедшего лендинга).
   * `full` — аватар + имя + шеврон (для приложения).
   */
  variant: 'compact' | 'full';
}

/**
 * Меню профиля для десктопа. Свой лёгкий дропдаун вместо HeroUI Popover/Dropdown:
 * React Aria в non-modal режиме ломает outside-close/toggle, а модальный — блокирует скролл
 * страницы через `usePreventScroll`. Здесь — простой useState + document listeners:
 * закрывается по клику вне, по скроллу окна, по повторному клику на триггер и по Escape.
 */
export const ProfileMenu: React.FC<Props> = ({ user, variant }) => {
  const navigate = useNavigate();
  const { authManager } = useRegistry();
  const name = displayNameOrEmailFallback(user);
  const initials = initialsFromName(name);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const close = useCallback((): void => {
    setIsOpen(false);
  }, []);

  const toggle = useCallback((): void => {
    setIsOpen(prev => !prev);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (target && (triggerRef.current?.contains(target) || menuRef.current?.contains(target))) {
        return;
      }
      close();
    };
    const onScroll = (): void => close();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, close]);

  const handleSettings = (): void => {
    close();
    navigate('/settings');
  };

  const handleLogout = (): void => {
    close();
    authManager.logout();
  };

  return (
    <div className='relative'>
      <button
        ref={triggerRef}
        type='button'
        onClick={toggle}
        aria-label='Меню профиля'
        aria-haspopup='menu'
        aria-expanded={isOpen}
        className='inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border-0 bg-[var(--default)] pl-1 pr-2 text-[14px] font-normal text-[color:var(--foreground)] transition-colors hover:bg-[color:var(--surface-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]'
      >
        <span
          aria-hidden='true'
          className='inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface)] text-[13px] font-semibold text-[color:var(--foreground)]'
        >
          {initials}
        </span>
        {variant === 'full' ? <span className='max-w-[160px] truncate pr-1'>{name}</span> : null}
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden='true' />
      </button>

      {isOpen ? (
        <div
          ref={menuRef}
          role='menu'
          aria-label='Меню профиля'
          className='absolute right-0 top-full z-50 mt-2 flex w-[220px] flex-col rounded-xl border border-[var(--separator)] bg-[var(--surface)] p-1 shadow-[0_2px_8px_rgb(0_0_0_/_0.10)]'
        >
          <div className='flex flex-col gap-0.5 px-3 py-2'>
            <span className='truncate text-[14px] font-medium text-[color:var(--foreground)]'>{name}</span>
            <span className='truncate text-[13px] text-[color:var(--muted)]'>{user.email}</span>
          </div>
          <div className='mx-2 my-1 h-px bg-[var(--separator)]' aria-hidden='true' />
          <button
            type='button'
            role='menuitem'
            onClick={handleSettings}
            className='flex h-9 cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-3 text-left text-[14px] font-normal text-[color:var(--foreground)] transition-colors hover:bg-[var(--surface-secondary)] focus:outline-none focus-visible:bg-[var(--surface-secondary)]'
          >
            <Settings size={16} strokeWidth={1.5} aria-hidden='true' />
            Настройки
          </button>
          <button
            type='button'
            role='menuitem'
            onClick={handleLogout}
            className='flex h-9 cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-3 text-left text-[14px] font-normal text-[color:var(--foreground)] transition-colors hover:bg-[var(--surface-secondary)] focus:outline-none focus-visible:bg-[var(--surface-secondary)]'
          >
            <LogOut size={16} strokeWidth={1.5} aria-hidden='true' />
            Выйти
          </button>
        </div>
      ) : null}
    </div>
  );
};
