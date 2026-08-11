import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { type Registry, RegistryContext, UNAUTHORIZED_EVENT, type UnauthorizedEventDetail } from '@app/common';

import { Router } from './components/Router/Router';

interface Props {
  registry: Registry;
}

const UnauthorizedListener: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<UnauthorizedEventDetail>).detail;
      if (detail?.target) navigate(detail.target, { replace: true });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
  }, [navigate]);

  return null;
};

const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // По SSR в v0 не гидрируем query — на клиенте запрашиваем свежее.
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 30_000,
      },
    },
  });

export const Application: React.FC<Props> = ({ registry }) => {
  const [queryClient] = useState(createQueryClient);

  return (
    <RegistryContext.Provider value={registry}>
      <QueryClientProvider client={queryClient}>
        <UnauthorizedListener />
        <Router />
      </QueryClientProvider>
    </RegistryContext.Provider>
  );
};
