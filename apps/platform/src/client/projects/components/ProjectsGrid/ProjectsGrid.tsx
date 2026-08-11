import type React from 'react';

interface Props {
  children: React.ReactNode;
}

/**
 * Сетка карточек проектов. Точная геометрия из спеки:
 * - десктоп: `repeat(auto-fill, minmax(280px, 1fr))`, gap 16px;
 * - до 1024px: `minmax(240px, 1fr)`.
 * Значения задаются инлайн через `style`, потому что Tailwind не даёт
 * прямого шортката для `auto-fill minmax()`, а нам критично сохранить
 * поведение из макета один-в-один.
 */
export const ProjectsGrid: React.FC<Props> = ({ children }) => {
  return (
    <div
      className='grid gap-4'
      style={{
        gridTemplateColumns: 'repeat(auto-fill, minmax(var(--projects-grid-min, 280px), 1fr))',
      }}
    >
      {children}
    </div>
  );
};
