import type React from 'react';

import { PublicFooter } from './PublicFooter';
import { PublicHeader } from './PublicHeader';

interface Props {
  children: React.ReactNode;
}

export const PublicLayout: React.FC<Props> = ({ children }) => {
  return (
    <div className='flex min-h-screen flex-col bg-[var(--surface)] text-[color:var(--foreground)]'>
      <PublicHeader />
      <main className='flex-1'>{children}</main>
      <PublicFooter />
    </div>
  );
};
