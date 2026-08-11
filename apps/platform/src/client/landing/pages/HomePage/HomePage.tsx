import type React from 'react';

import { PublicLayout } from '@app/common';

import { FaqSection } from './FaqSection';
import { FeaturesSection } from './FeaturesSection';
import { FinalCtaSection } from './FinalCtaSection';
import { HeroSection } from './HeroSection';
import { HowItWorksSection } from './HowItWorksSection';
import { UseCasesSection } from './UseCasesSection';

export const HomePage: React.FC = () => {
  return (
    <>
      <title>уютно — планировщик квартиры онлайн</title>
      <meta
        name='description'
        content='Начертите стены, расставьте мебель в реальных размерах и посмотрите комнату в 3D. Бесплатно, прямо в браузере, без установки.'
      />
      <PublicLayout>
        <div className='mx-auto flex w-full max-w-[560px] flex-col gap-12 px-4 pb-8 pt-6 lg:max-w-[1200px] lg:px-8 lg:pb-12 lg:pt-8'>
          <HeroSection />
          <FeaturesSection />
          <HowItWorksSection />
          <UseCasesSection />
          <FaqSection />
          <FinalCtaSection />
        </div>
      </PublicLayout>
    </>
  );
};
