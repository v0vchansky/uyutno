import type React from 'react';
import { Link } from 'react-router';

import { PublicLayout } from '@app/common';

import { Route } from '../../../../shared/router/routes';

export const NotFoundPage: React.FC = () => {
  return (
    <>
      <title>Страница не найдена — уютно</title>
      <meta name='description' content='Такой страницы нет. Проверьте адрес или вернитесь на главную.' />
      <PublicLayout>
        <div className='flex min-h-full items-center justify-center px-4 py-12 md:p-12'>
          <div className='flex w-full max-w-[360px] flex-col items-center gap-6 text-center'>
            <span className='text-[64px] font-semibold leading-none tracking-[-0.03em] text-[color:var(--muted)] md:text-[88px]'>
              404
            </span>
            <div className='flex flex-col gap-2'>
              <h1 className='m-0 text-[22px] font-semibold tracking-[-0.02em] md:text-[28px]'>Такой страницы нет</h1>
              <p className='m-0 text-[14px] leading-[1.6] text-[color:var(--muted)] md:text-[16px]'>
                Проверьте адрес или вернитесь на главную.
              </p>
            </div>
            <Link to={Route.Home} data-size='xl' className='button button--primary'>
              На главную
            </Link>
          </div>
        </div>
      </PublicLayout>
    </>
  );
};
