import type React from 'react';
import { Link } from 'react-router';

import { PlaceholderScreenshot } from './PlaceholderScreenshot';

const SECONDARY_CTA_STYLE = {
  ['--button-bg' as string]: 'var(--surface)',
  ['--button-bg-hover' as string]: 'var(--surface-secondary)',
  ['--button-fg' as string]: 'var(--foreground)',
} as React.CSSProperties;

export const HeroSection: React.FC = () => {
  return (
    <section className='rounded-[24px] bg-[var(--surface-secondary)] p-6 lg:p-8'>
      <div className='grid grid-cols-1 items-center gap-8 lg:grid-cols-[1.05fr_1fr]'>
        <div className='flex flex-col gap-6'>
          <div className='flex flex-col gap-4'>
            <h1 className='text-balance text-[28px] font-semibold leading-[1.1] tracking-[-0.03em] lg:text-[44px]'>
              Планировка квартиры за вечер
            </h1>
            <p className='max-w-[440px] text-pretty text-[16px] leading-[1.6] text-[color:var(--muted)]'>
              Начертите стены, расставьте мебель в реальных размерах и посмотрите комнату в 3D. Бесплатно, прямо в
              браузере, без установки.
            </p>
          </div>

          <div className='flex flex-col gap-3 lg:flex-row lg:flex-wrap'>
            <Link to='/register' data-size='xl' className='button button--primary'>
              Собрать планировку
            </Link>
            <Link to='/demo' data-size='xl' className='button' style={SECONDARY_CTA_STYLE}>
              Посмотреть пример
            </Link>
          </div>

          <div className='flex flex-wrap gap-4 text-[13px] text-[color:var(--muted)]'>
            <span>Без оплаты</span>
            <span>Сколько угодно проектов</span>
          </div>
        </div>

        <PlaceholderScreenshot caption='скриншот 3D-вида' className='aspect-[4/3] rounded-[24px]' />
      </div>
    </section>
  );
};
