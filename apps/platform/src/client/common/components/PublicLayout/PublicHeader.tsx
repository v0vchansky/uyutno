import type React from 'react';
import { Link } from 'react-router';

import type { User } from '@app/auth';

import { LANDING_NAV_ITEMS } from './landingNav';
import { Logo } from '../Logo/Logo';
import { MobileMenu } from './MobileMenu';
import { ProfileMenu } from './ProfileMenu';

export type HeaderMode = 'guest-landing' | 'auth-landing' | 'app' | 'auth';

interface Props {
  mode: HeaderMode;
  user: User | null;
}

/**
 * Шапка на 4 состояния. Логотип во всех состояниях ведёт на `/`.
 *
 * Три ссылки-действия («Войти», «Создать проект», «Мои проекты») одеты BEM-классами библиотеки, а не
 * набором утилит (задача 0097): заливка, радиус, наведение, нажатие и кольцо фокуса приезжают из темы.
 * Высота держится классом `h-10` поверх шкалы намеренно — `docs/ui/layout.md` задаёт содержимому шапки
 * ровно 40px на десктопе, а `.button` даёт 40px только до 768px и 36px выше.
 *
 * - `guest-landing`: логотип, навигация по секциям, «Войти» + «Создать проект».
 * - `auth-landing`: логотип, навигация, «Мои проекты» + меню профиля (аватар + шеврон).
 * - `app`: логотип, справа меню профиля (аватар + имя + шеврон); фон под шапкой серый.
 * - `auth`: только логотип.
 *
 * До 1024px навигация и профиль уходят в бургер (кроме `auth`).
 */
export const PublicHeader: React.FC<Props> = ({ mode, user }) => {
  const isAuth = mode === 'auth';
  const isApp = mode === 'app';
  const showNav = mode === 'guest-landing' || mode === 'auth-landing';

  return (
    <header className='sticky top-0 z-40 border-b border-[var(--separator)] bg-[var(--surface)]'>
      {/* Единая высота шапки на всех 4 состояниях (см. docs/ui/layout.md).
          Целевые размеры контента — 40px на десктопе, 44px до 1024px; вместе с
          py-3 (12+12 = 24px) внутренний бокс — 64px / 68px соответственно.
          Так как в проекте box-sizing: border-box, min-height задаётся сразу
          на внешнюю высоту контейнера. */}
      <div className='mx-auto flex min-h-[68px] max-w-[1200px] items-center gap-6 px-4 py-3 lg:min-h-16 lg:px-8'>
        <Link to='/' aria-label='уютно — на главную' className='inline-flex items-center no-underline'>
          <Logo variant='header' />
        </Link>

        {isAuth ? null : (
          <>
            {showNav ? (
              <nav className='hidden flex-1 items-center gap-1 lg:flex' aria-label='Разделы страницы'>
                {LANDING_NAV_ITEMS.map(item => (
                  <a
                    key={item.href}
                    href={item.href}
                    className='inline-flex h-9 items-center rounded-xl px-3 text-[14px] text-[color:var(--foreground)] no-underline transition-colors hover:bg-[color:var(--surface-secondary)]'
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            ) : (
              <span className='flex-1' />
            )}

            <div className='ml-auto flex items-center gap-2'>
              {mode === 'guest-landing' ? (
                <>
                  <Link to='/login' className='button button--tertiary hidden h-10 no-underline lg:inline-flex'>
                    Войти
                  </Link>
                  <Link to='/register' className='button button--primary h-10 no-underline'>
                    <span className='lg:hidden'>Создать</span>
                    <span className='hidden lg:inline'>Создать проект</span>
                  </Link>
                </>
              ) : null}

              {mode === 'auth-landing' && user ? (
                <>
                  <Link to='/projects' className='button button--primary h-10 no-underline'>
                    <span className='lg:hidden'>Проекты</span>
                    <span className='hidden lg:inline'>Мои проекты</span>
                  </Link>
                  <div className='hidden lg:block'>
                    <ProfileMenu user={user} variant='compact' />
                  </div>
                </>
              ) : null}

              {mode === 'app' && user ? (
                <div className='hidden lg:block'>
                  <ProfileMenu user={user} variant='full' />
                </div>
              ) : null}

              {isApp || mode === 'auth-landing' || mode === 'guest-landing' ? (
                <MobileMenu
                  mode={isApp ? 'app' : mode === 'auth-landing' ? 'auth-landing' : 'guest-landing'}
                  user={user}
                />
              ) : null}
            </div>
          </>
        )}
      </div>
    </header>
  );
};
