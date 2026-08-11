import type React from 'react';
import { useId } from 'react';

interface Props {
  className?: string;
}

/**
 * Диагональный SVG-паттерн — используется как заглушка вместо превью 3D-вида
 * (карточка проекта, пустое состояние). Форма 8×8, rotate(45deg), полоски
 * `--border` на прозрачном фоне: контейнер даёт свой `--background`, паттерн
 * рисуется поверх.
 */
export const ProjectPlaceholder: React.FC<Props> = ({ className }) => {
  const patternId = useId();
  return (
    <svg
      className={className}
      role='presentation'
      aria-hidden='true'
      width='100%'
      height='100%'
      preserveAspectRatio='none'
      viewBox='0 0 200 150'
    >
      <defs>
        <pattern id={patternId} width='8' height='8' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'>
          <rect width='4' height='8' fill='var(--border)' />
        </pattern>
      </defs>
      <rect width='200' height='150' fill={`url(#${patternId})`} />
    </svg>
  );
};
