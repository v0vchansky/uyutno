import type React from 'react';
import { Link } from 'react-router';

import { Logo } from './Logo';

const FOOTER_LINKS: ReadonlyArray<{ to: string; label: string }> = [
  { to: '/demo', label: 'Пример проекта' },
  { to: '/login', label: 'Войти' },
];

export const PublicFooter: React.FC = () => {
  return (
    <footer className='border-t border-[var(--separator)] bg-[var(--surface)]'>
      <div className='mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 py-6 md:px-6 md:py-8 lg:px-8'>
        <Logo variant='footer' />
        <div className='flex flex-wrap items-center gap-4 text-[13px] text-[color:var(--muted)]'>
          {FOOTER_LINKS.map(link => (
            <Link
              key={link.to}
              to={link.to}
              className='inline-flex min-h-[44px] items-center text-[color:var(--muted)] no-underline transition-colors hover:text-[color:var(--foreground)]'
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
};
