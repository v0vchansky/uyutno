import { Popover } from '@heroui/react';
import { ChevronDown, LogOut, Settings } from 'lucide-react';
import type React from 'react';
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

export const ProfileMenu: React.FC<Props> = ({ user, variant }) => {
  const navigate = useNavigate();
  const { authManager } = useRegistry();
  const name = displayNameOrEmailFallback(user);
  const initials = initialsFromName(name);

  const handleSettings = (): void => {
    navigate('/settings');
  };

  const handleLogout = async (): Promise<void> => {
    try {
      await authManager.logout();
      navigate('/');
    } catch (error) {
       
      console.error('logout failed', error);
    }
  };

  return (
    <Popover>
      <Popover.Trigger
        className='inline-flex h-10 items-center gap-2 rounded-xl border-0 bg-[var(--default)] pl-1 pr-2 text-[14px] font-normal text-[color:var(--foreground)] transition-colors hover:bg-[color:var(--surface-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] data-[pressed]:bg-[color:var(--surface-tertiary)]'
        aria-label='Меню профиля'
      >
        <span
          aria-hidden='true'
          className='inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface)] text-[13px] font-semibold text-[color:var(--foreground)]'
        >
          {initials}
        </span>
        {variant === 'full' ? <span className='max-w-[160px] truncate pr-1'>{name}</span> : null}
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden='true' />
      </Popover.Trigger>
      <Popover.Content
        offset={8}
        placement='bottom right'
        className='w-[220px] rounded-xl border border-[var(--separator)] bg-[var(--surface)] p-1 shadow-[0_2px_8px_rgb(0_0_0_/_0.10)]'
      >
        <Popover.Dialog className='flex flex-col p-0'>
          <div className='flex flex-col gap-0.5 px-3 py-2'>
            <span className='truncate text-[14px] font-medium text-[color:var(--foreground)]'>{name}</span>
            <span className='truncate text-[13px] text-[color:var(--muted)]'>{user.email}</span>
          </div>
          <div className='mx-2 my-1 h-px bg-[var(--separator)]' aria-hidden='true' />
          <button
            type='button'
            onClick={handleSettings}
            className='flex h-9 items-center gap-2 rounded-lg border-0 bg-transparent px-3 text-left text-[14px] font-normal text-[color:var(--foreground)] transition-colors hover:bg-[var(--surface-secondary)] focus:outline-none focus-visible:bg-[var(--surface-secondary)]'
          >
            <Settings size={16} strokeWidth={1.5} aria-hidden='true' />
            Настройки
          </button>
          <button
            type='button'
            onClick={handleLogout}
            className='flex h-9 items-center gap-2 rounded-lg border-0 bg-transparent px-3 text-left text-[14px] font-normal text-[color:var(--foreground)] transition-colors hover:bg-[var(--surface-secondary)] focus:outline-none focus-visible:bg-[var(--surface-secondary)]'
          >
            <LogOut size={16} strokeWidth={1.5} aria-hidden='true' />
            Выйти
          </button>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
};
