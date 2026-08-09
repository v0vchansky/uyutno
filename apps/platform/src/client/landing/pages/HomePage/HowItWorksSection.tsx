import type React from 'react';

import { PlaceholderScreenshot } from './PlaceholderScreenshot';

interface Step {
  title: string;
  description: string;
  caption: string;
}

const STEPS: ReadonlyArray<Step> = [
  {
    title: 'Начертите комнату',
    description: 'Понадобятся только длины стен. Замерить рулеткой одну квартиру — минут пятнадцать.',
    caption: 'чертёж стен',
  },
  {
    title: 'Расставьте мебель',
    description: 'Перетащите предметы из каталога и подвиньте так, как хотите поставить дома.',
    caption: 'перетаскивание мебели',
  },
  {
    title: 'Посмотрите в 3D',
    description:
      'Проверьте, не тесно ли, и сохраните. Проект остаётся в аккаунте, вернуться можно с любого компьютера.',
    caption: 'переключение в 3D',
  },
];

export const HowItWorksSection: React.FC = () => {
  return (
    <section id='how' className='flex flex-col gap-4'>
      <h2 className='text-[22px] font-semibold tracking-[-0.02em] md:text-[28px]'>Как это работает</h2>
      <div className='grid grid-cols-1 gap-6 sm:grid-cols-[repeat(auto-fit,minmax(240px,1fr))] md:grid-cols-[repeat(auto-fit,minmax(260px,1fr))]'>
        {STEPS.map((step, index) => (
          <article key={step.caption} className='flex flex-col gap-4'>
            <PlaceholderScreenshot
              caption={step.caption}
              numberBadge={index + 1}
              className='aspect-[16/10] rounded-[12px] bg-[var(--surface-secondary)]'
            />
            <div className='flex flex-col gap-2'>
              <h3 className='text-[17px] font-semibold'>{step.title}</h3>
              <p className='text-pretty text-[14px] leading-[1.55] text-[color:var(--muted)]'>{step.description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};
