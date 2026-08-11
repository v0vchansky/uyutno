import type React from 'react';

interface Props {
  onClick: () => void;
}

/**
 * Пунктирная плитка «Новый проект» — последняя ячейка сетки.
 * При клике открывает `NewProjectModal` (модалом управляет страница).
 */
export const NewProjectTile: React.FC<Props> = ({ onClick }) => {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label='Новый проект'
      className='group flex min-h-[220px] items-center justify-center rounded-3xl border border-dashed border-[var(--border)] bg-transparent text-[color:var(--muted)] transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] focus-visible:outline-none focus-visible:border-[color:var(--accent)] focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]'
    >
      <span className='flex items-center gap-2 text-[14px] font-medium'>
        <svg
          width='16'
          height='16'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='1.5'
          strokeLinecap='round'
          aria-hidden='true'
        >
          <path d='M12 5v14M5 12h14' />
        </svg>
        Новый проект
      </span>
    </button>
  );
};
