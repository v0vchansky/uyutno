import type React from 'react';
import { Link } from 'react-router';

import { Logo } from './Logo';

const NAV_ITEMS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '#features', label: 'Возможности' },
  { href: '#how', label: 'Как это работает' },
  { href: '#faq', label: 'Вопросы' },
];

export const PublicHeader: React.FC = () => {
  return (
    <header className='border-b border-[var(--separator)] bg-[var(--surface)]'>
      <div className='mx-auto flex max-w-[1200px] items-center gap-3 px-4 py-3 md:gap-6 md:px-6 lg:px-8'>
        <Link to='/' aria-label='уютно — на главную' className='mr-2 inline-flex items-center no-underline'>
          <Logo variant='header' />
        </Link>

        <nav className='hidden flex-1 items-center gap-1 lg:flex' aria-label='Разделы страницы'>
          {NAV_ITEMS.map(item => (
            <a key={item.href} href={item.href} className='button button--ghost'>
              {item.label}
            </a>
          ))}
        </nav>

        <span className='flex-1 lg:hidden' />

        <div className='flex items-center gap-2'>
          <Link to='/login' className='button button--lg button--tertiary hidden md:inline-flex'>
            Войти
          </Link>
          <Link to='/register' className='button button--lg button--primary'>
            <span className='md:hidden'>Создать</span>
            <span className='hidden md:inline'>Создать проект</span>
          </Link>
        </div>
      </div>
    </header>
  );
};
