import type React from 'react';
import { Link } from 'react-router';

export const FinalCtaSection: React.FC = () => {
  return (
    <section className='flex flex-col flex-wrap items-start gap-6 rounded-[24px] bg-[var(--surface-secondary)] p-6 md:flex-row md:items-center md:justify-between md:p-8'>
      <div className='flex flex-col gap-2'>
        <h2 className='text-[22px] font-semibold tracking-[-0.02em]'>Попробуйте на своей квартире</h2>
        <p className='text-[14px] text-[color:var(--muted)]'>Регистрация занимает минуту, платить не нужно.</p>
      </div>
      <Link to='/register' data-size='xl' className='button button--primary self-stretch md:self-auto'>
        Создать проект
      </Link>
    </section>
  );
};
