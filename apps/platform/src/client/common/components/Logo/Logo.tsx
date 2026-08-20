import type React from 'react';

type LogoVariant = 'header' | 'footer';

interface Props {
  variant: LogoVariant;
}

const MARK_SIZES: Record<LogoVariant, { width: number; height: number; square: number; second: number }> = {
  header: { width: 26, height: 20, square: 17, second: 16 },
  footer: { width: 20, height: 15, square: 13, second: 12 },
};

export const Logo: React.FC<Props> = ({ variant }) => {
  const mark = MARK_SIZES[variant];
  const wordClasses = variant === 'header' ? 'text-[19px] sm:text-[21px]' : 'text-[15px]';

  return (
    <span className='inline-flex items-center gap-2'>
      <span
        className='relative block'
        style={{ width: `${mark.width}px`, height: `${mark.height}px` }}
        aria-hidden='true'
      >
        <span
          className='absolute left-0 top-0 rounded-[5px] bg-[var(--accent)]'
          style={{ width: `${mark.square}px`, height: `${mark.square}px`, transform: 'rotate(-8deg)' }}
        />
        <span
          className='absolute top-[1px] rounded-[5px] bg-[var(--accent)] opacity-45'
          style={{
            left: variant === 'header' ? '10px' : '8px',
            width: `${mark.second}px`,
            height: `${mark.second}px`,
            transform: 'rotate(7deg)',
          }}
        />
      </span>
      <span
        className={`-translate-y-[1.5px] font-bold leading-none tracking-[-0.02em] ${wordClasses}`}
        style={{ fontFamily: 'var(--font-nunito)' }}
      >
        уютно
      </span>
    </span>
  );
};
