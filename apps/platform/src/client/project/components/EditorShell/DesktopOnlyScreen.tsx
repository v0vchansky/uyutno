import { Monitor } from 'lucide-react';
import type React from 'react';
import { Link } from 'react-router';

import { Logo, useRegistry } from '@app/common';

import { Route } from '../../../../shared/router/routes';
import { EDITOR_MIN_WIDTH } from '../../hooks/useEditorViewportFit';

/**
 * Экран ниже порога 1024px (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Состояния экрана ·
 * оболочка» → «Заглушка ниже 1024px»; прототип `Planner Editor Shell.dc.html`, кадры «заглушка ниже 1024»).
 *
 * **Одна вёрстка с подменой ссылки, а не два экрана:** вошедшему — «Мои проекты» на `/projects`, гостю (демо,
 * задача 0064) — «На главную» на `/`. Тон по гайдлайну — факт, а не извинение.
 *
 * Шапка здесь своя, а не `PublicLayout`: макет даёт один логотип и **без подвала**, то есть ни одно из четырёх
 * состояний общей шапки (`docs/ui/layout.md`) не подходит целиком.
 */
export const DesktopOnlyScreen: React.FC = () => {
  const { authManager } = useRegistry();
  const isAuthenticated = authManager.getCurrentUser() !== null;

  return (
    <div className='flex min-h-screen flex-col bg-[var(--background)] text-[color:var(--foreground)]'>
      <header className='shrink-0 border-b border-[var(--separator)] bg-[var(--surface)]'>
        {/*
         * Высота — общая для шапок платформы: 69px до 1024px (`docs/ui/layout.md`), то есть контент 44px плюс
         * padding 12px сверху и снизу плюс граница. В прототипе те же числа записаны как `min-height: 44px` при
         * content-box; у нас `box-sizing: border-box` глобальный, поэтому внешняя высота задаётся сразу — ровно
         * как в `PublicHeader`. Заглушка ниже порога не рисуется, поэтому десктопного варианта высоты у неё нет.
         */}
        <div className='mx-auto flex min-h-[68px] max-w-[1200px] items-center px-4 py-3'>
          <Link to={Route.Home} aria-label='уютно — на главную' className='inline-flex items-center no-underline'>
            <Logo variant='header' />
          </Link>
        </div>
      </header>

      <main className='flex flex-1 flex-col items-center justify-center gap-6 px-4 py-6 text-center'>
        <div
          aria-hidden='true'
          className='flex h-24 w-[120px] items-center justify-center rounded-xl bg-[var(--surface-secondary)] text-[color:var(--muted)]'
        >
          <Monitor size={36} />
        </div>

        <div className='flex flex-col gap-2'>
          <h1 className='m-0 text-[22px] font-semibold tracking-[-0.02em] text-balance'>
            Редактор работает на компьютере
          </h1>
          <p className='m-0 max-w-[300px] text-[14px] leading-[1.55] text-pretty text-[color:var(--muted)]'>
            {`Чертить план пальцем неудобно, поэтому редактор открывается на экране от ${EDITOR_MIN_WIDTH} пикселей. Проекты с телефона можно смотреть.`}
          </p>
        </div>

        <Link
          to={isAuthenticated ? Route.Projects : Route.Home}
          /* Кнопка залита акцентом, поэтому кольцо фокуса — со смещением: акцент по акценту не виден. */
          className='inline-flex h-11 items-center rounded-xl bg-[var(--accent)] px-6 text-[15px] font-medium text-[color:var(--accent-foreground)] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]'
        >
          {isAuthenticated ? 'Мои проекты' : 'На главную'}
        </Link>
      </main>
    </div>
  );
};
