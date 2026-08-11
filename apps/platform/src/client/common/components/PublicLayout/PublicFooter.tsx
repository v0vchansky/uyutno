import type React from 'react';
import { Link } from 'react-router';

import { Logo } from './Logo';

export type FooterMode = 'guest-landing' | 'auth-landing' | 'app' | 'auth';

interface Props {
  mode: FooterMode;
}

interface FooterLink {
  to: string;
  label: string;
  external?: boolean;
}

const PRODUCT_LINKS: ReadonlyArray<FooterLink> = [
  { to: '#features', label: 'Возможности' },
  { to: '#how', label: 'Как это работает' },
  { to: '#faq', label: 'Вопросы' },
  { to: '/demo', label: 'Пример проекта' },
];

const GUEST_ACCOUNT_LINKS: ReadonlyArray<FooterLink> = [
  { to: '/login', label: 'Войти' },
  { to: '/register', label: 'Регистрация' },
  { to: '/forgot-password', label: 'Сброс пароля' },
];

const AUTH_ACCOUNT_LINKS: ReadonlyArray<FooterLink> = [
  { to: '/projects', label: 'Мои проекты' },
  { to: '/projects/new', label: 'Создать проект' },
  { to: '/settings', label: 'Настройки' },
];

const SUPPORT_LINKS: ReadonlyArray<FooterLink> = [
  { to: 'mailto:hello@uyutno.app', label: 'Написать нам', external: true },
  { to: 'mailto:bug@uyutno.app', label: 'Сообщить об ошибке', external: true },
];

const LEGAL_LINKS: ReadonlyArray<FooterLink> = [
  { to: '/terms', label: 'Условия использования' },
  { to: '/privacy', label: 'Конфиденциальность' },
];

const columnLinkClass =
  'text-[14px] text-[color:var(--muted)] no-underline transition-colors hover:text-[color:var(--accent)]';
const legalLinkClass =
  'text-[13px] text-[color:var(--muted)] no-underline transition-colors hover:text-[color:var(--foreground)]';

const renderLink = (link: FooterLink, className: string): React.ReactNode =>
  link.external ? (
    <a key={link.to + link.label} href={link.to} className={className}>
      {link.label}
    </a>
  ) : (
    <Link key={link.to + link.label} to={link.to} className={className}>
      {link.label}
    </Link>
  );

const FooterColumn: React.FC<{ title: string; links: ReadonlyArray<FooterLink> }> = ({ title, links }) => (
  <div className='flex flex-col gap-3'>
    <span className='text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]'>{title}</span>
    <div className='flex flex-col gap-2'>{links.map(link => renderLink(link, columnLinkClass))}</div>
  </div>
);

export const PublicFooter: React.FC<Props> = ({ mode }) => {
  const year = new Date().getFullYear();

  if (mode === 'auth') {
    return (
      <footer className='bg-[var(--surface)]'>
        <div className='mx-auto flex max-w-[1200px] justify-center px-4 py-6 lg:px-8'>
          <div className='flex flex-wrap items-center justify-center gap-4 text-[13px] text-[color:var(--muted)]'>
            <span>© {year} уютно</span>
            {LEGAL_LINKS.map(link => renderLink(link, legalLinkClass))}
          </div>
        </div>
      </footer>
    );
  }

  if (mode === 'app') {
    return (
      <footer className='border-t border-[var(--separator)] bg-[var(--surface)]'>
        <div className='mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 py-6 lg:px-8'>
          <div className='flex flex-wrap items-center gap-4 text-[13px] text-[color:var(--muted)]'>
            <span>© {year} уютно</span>
            {LEGAL_LINKS.map(link => renderLink(link, legalLinkClass))}
          </div>
          <a href='mailto:hello@uyutno.app' className={legalLinkClass}>
            Написать нам
          </a>
        </div>
      </footer>
    );
  }

  // guest-landing / auth-landing
  const accountLinks = mode === 'auth-landing' ? AUTH_ACCOUNT_LINKS : GUEST_ACCOUNT_LINKS;

  return (
    <footer className='border-t border-[var(--separator)] bg-[var(--surface-secondary)]'>
      <div className='mx-auto flex max-w-[1200px] flex-col gap-8 px-4 py-8 lg:px-8 lg:py-12'>
        <div className='grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_1fr_1fr_1fr]'>
          <div className='flex max-w-[280px] flex-col gap-3'>
            <Link to='/' className='inline-flex items-center no-underline'>
              <Logo variant='header' />
            </Link>
            <p className='m-0 text-[14px] leading-[1.55] text-[color:var(--muted)]'>
              Бесплатный планировщик интерьера: 2D-план, мебель в реальных габаритах, просмотр в 3D.
            </p>
          </div>
          <FooterColumn title='Продукт' links={PRODUCT_LINKS} />
          <FooterColumn title='Аккаунт' links={accountLinks} />
          <FooterColumn title='Поддержка' links={SUPPORT_LINKS} />
        </div>
        <div className='h-px bg-[var(--border)]' aria-hidden='true' />
        <div className='flex flex-wrap items-center gap-4 text-[13px] text-[color:var(--muted)]'>
          <span>© {year} уютно</span>
          {LEGAL_LINKS.map(link => renderLink(link, legalLinkClass))}
        </div>
      </div>
    </footer>
  );
};
