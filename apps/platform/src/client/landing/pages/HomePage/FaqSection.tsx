import { Accordion } from '@heroui/react';
import type React from 'react';

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

const FAQ_ITEMS: ReadonlyArray<FaqItem> = [
  {
    id: 'price',
    question: 'Сколько это стоит?',
    answer:
      'Нисколько. Проектов можно завести сколько угодно, ограничений по времени и функциям нет, все модели бесплатные.',
  },
  {
    id: 'install',
    question: 'Нужно ли что-то устанавливать?',
    answer: 'Нет, всё работает в браузере. Проект хранится в аккаунте, а не на компьютере.',
  },
  {
    id: 'mobile',
    question: 'Работает ли с телефона?',
    answer:
      'Редактор — только на компьютере: чертить план пальцем неудобно. С телефона можно посмотреть готовые проекты.',
  },
  {
    id: 'account',
    question: 'Нужен ли аккаунт?',
    answer:
      'Посмотреть пример можно без него. Чтобы сохранить свой проект и вернуться к нему, понадобится почта или вход через Yandex ID и VK ID.',
  },
];

export const FaqSection: React.FC = () => {
  return (
    <section id='faq' className='flex flex-col gap-4'>
      <div className='flex flex-col gap-2'>
        <h2 className='text-[22px] font-semibold tracking-[-0.02em] md:text-[28px]'>Вопросы</h2>
        <p className='max-w-[560px] text-pretty text-[14px] leading-[1.6] text-[color:var(--muted)] md:text-[16px]'>
          Если чего-то здесь нет, напишите — ответим и добавим.
        </p>
      </div>

      <Accordion defaultExpandedKeys={new Set([FAQ_ITEMS[0]!.id])}>
        {FAQ_ITEMS.map(item => (
          <Accordion.Item key={item.id} id={item.id}>
            <Accordion.Heading>
              <Accordion.Trigger className='py-6 text-[17px] font-semibold'>
                {item.question}
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body className='pb-6 text-[14px] leading-[1.55] text-[color:var(--muted)]'>
                {item.answer}
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </section>
  );
};
