import type React from 'react';

import { PlaceholderScreenshot } from './PlaceholderScreenshot';

interface SmallCard {
  title: string;
  description: string;
  caption: string;
}

const SMALL_CARDS: ReadonlyArray<SmallCard> = [
  {
    title: 'Мебель в габаритах',
    description:
      'Диваны, столы, шкафы и кровати из каталога занимают ровно столько места, сколько займут в квартире. Проход остаётся проходом.',
    caption: 'каталог мебели',
  },
  {
    title: 'Просмотр в 3D',
    description:
      'Один клик — и вы стоите посреди комнаты. Камера крутится вокруг, к плану можно вернуться в любой момент.',
    caption: 'вид комнаты в 3D',
  },
];

export const FeaturesSection: React.FC = () => {
  return (
    <section id='features' className='flex flex-col gap-4'>
      <div className='flex flex-col gap-2'>
        <h2 className='text-[22px] font-semibold tracking-[-0.02em] md:text-[28px]'>Что внутри</h2>
        <p className='max-w-[560px] text-pretty text-[14px] leading-[1.6] text-[color:var(--muted)] md:text-[16px]'>
          Три инструмента, которых хватает, чтобы понять, как будет выглядеть комната.
        </p>
      </div>

      <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
        <article className='col-span-1 grid grid-cols-1 items-center gap-8 rounded-[24px] bg-[var(--surface-secondary)] p-6 md:col-span-2 md:p-8 lg:grid-cols-[1fr_1.15fr]'>
          <div className='flex flex-col gap-2'>
            <h3 className='text-[22px] font-semibold tracking-[-0.02em]'>План со стенами</h3>
            <p className='text-pretty text-[16px] leading-[1.6] text-[color:var(--muted)]'>
              Стены, двери и окна рисуются мышью с привязкой к сетке. Размеры проставляются сами, пересчитывать ничего
              не нужно.
            </p>
          </div>
          <PlaceholderScreenshot caption='2D-план со стенами' className='aspect-[16/9] rounded-[8px]' />
        </article>

        {SMALL_CARDS.map(card => (
          <article key={card.caption} className='flex flex-col gap-4 rounded-[24px] bg-[var(--surface-secondary)] p-6'>
            <PlaceholderScreenshot caption={card.caption} className='aspect-[16/10] rounded-[8px]' />
            <div className='flex flex-col gap-2'>
              <h3 className='text-[17px] font-semibold'>{card.title}</h3>
              <p className='text-pretty text-[14px] leading-[1.55] text-[color:var(--muted)]'>{card.description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};
