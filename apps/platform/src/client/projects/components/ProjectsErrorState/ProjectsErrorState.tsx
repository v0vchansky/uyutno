import { Button } from '@heroui/react';
import type React from 'react';

interface Props {
  onRetry: () => void;
}

/**
 * Ошибка загрузки. Геометрия совпадает с пустым состоянием, чтобы не
 * прыгал контейнер контента при переключении.
 */
export const ProjectsErrorState: React.FC<Props> = ({ onRetry }) => {
  return (
    <div
      role='alert'
      className='flex flex-col items-center gap-6 rounded-3xl bg-[var(--surface)] px-8 py-16 text-center shadow-[var(--surface-shadow)]'
    >
      <div className='flex max-w-[400px] flex-col gap-2'>
        <h2 className='m-0 text-[22px] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]'>
          Не удалось загрузить проекты
        </h2>
        <p className='m-0 text-[14px] leading-[1.5] text-[color:var(--muted)]'>Попробуйте ещё раз через минуту.</p>
      </div>
      <Button onPress={onRetry} className='h-11'>
        Повторить
      </Button>
    </div>
  );
};
