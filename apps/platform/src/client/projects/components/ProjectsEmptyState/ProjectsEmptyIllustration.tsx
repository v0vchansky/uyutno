import type React from 'react';
import { useId } from 'react';

/**
 * Заглушка-иллюстрация для «пустого» состояния — 180×120 с тем же
 * диагональным паттерном, что и превью карточки.
 */
export const ProjectsEmptyIllustration: React.FC = () => {
  const patternId = useId();
  return (
    <div className='h-[120px] w-[180px] overflow-hidden rounded-xl bg-[var(--background)]'>
      <svg
        role='presentation'
        aria-hidden='true'
        width='100%'
        height='100%'
        preserveAspectRatio='none'
        viewBox='0 0 180 120'
      >
        <defs>
          <pattern id={patternId} width='8' height='8' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'>
            <rect width='4' height='8' fill='var(--border)' />
          </pattern>
        </defs>
        <rect width='180' height='120' fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
};
