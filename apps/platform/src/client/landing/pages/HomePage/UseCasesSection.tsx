import type React from 'react';

import { PlaceholderScreenshot } from './PlaceholderScreenshot';

interface UseCase {
  title: string;
  description: string;
  caption: string;
}

const USE_CASES: ReadonlyArray<UseCase> = [
  {
    title: 'Переезд',
    description: 'Понять заранее, какая мебель встанет в новую квартиру, а какую проще продать.',
    caption: 'иллюстрация: коробки и новая комната',
  },
  {
    title: 'Ремонт',
    description: 'Проверить расстановку до того, как двигать розетки и заказывать кухню.',
    caption: 'иллюстрация: план с розетками',
  },
  {
    title: 'Перестановка',
    description: 'Подвигать диван на экране, а не вдвоём по комнате в субботу.',
    caption: 'иллюстрация: диван на новом месте',
  },
];

export const UseCasesSection: React.FC = () => {
  return (
    <section className='flex flex-col gap-4'>
      <h2 className='text-[22px] font-semibold tracking-[-0.02em] md:text-[28px]'>Когда пригодится</h2>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fit,minmax(240px,1fr))] md:grid-cols-[repeat(auto-fit,minmax(260px,1fr))]'>
        {USE_CASES.map(useCase => (
          <article
            key={useCase.caption}
            className='flex flex-col gap-4 rounded-[24px] bg-[var(--surface-secondary)] p-6'
          >
            <PlaceholderScreenshot caption={useCase.caption} className='aspect-[3/2] rounded-[8px]' />
            <div className='flex flex-col gap-2'>
              <h3 className='text-[17px] font-semibold'>{useCase.title}</h3>
              <p className='text-pretty text-[14px] leading-[1.55] text-[color:var(--muted)]'>{useCase.description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};
