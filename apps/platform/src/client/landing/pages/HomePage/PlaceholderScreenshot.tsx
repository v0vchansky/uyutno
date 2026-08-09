import type React from 'react';

interface Props {
  caption: string;
  className?: string;
  numberBadge?: number;
}

const STRIPES_BACKGROUND = 'repeating-linear-gradient(45deg, oklch(95% 0 0) 0 4px, transparent 4px 8px)';

export const PlaceholderScreenshot: React.FC<Props> = ({ caption, className = '', numberBadge }) => {
  return (
    <div
      data-landing-placeholder='true'
      role='img'
      aria-label={`Плейсхолдер: ${caption}`}
      className={`relative overflow-hidden bg-[var(--surface)] ${className}`}
    >
      <div className='absolute inset-0' style={{ backgroundImage: STRIPES_BACKGROUND }} />
      {numberBadge != null && (
        <span className='absolute left-3 top-3 flex h-7 w-7 items-center justify-center rounded-[8px] bg-[var(--accent)] text-[14px] font-semibold text-[color:var(--accent-foreground)]'>
          {numberBadge}
        </span>
      )}
      <span
        className='absolute bottom-3 left-3 rounded-[8px] bg-[var(--surface)] px-2 py-1 text-[11px] text-[color:var(--muted)]'
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
      >
        {caption}
      </span>
    </div>
  );
};
