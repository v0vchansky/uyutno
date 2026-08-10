import type React from 'react';
import { useEffect } from 'react';
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

export const Application: React.FC<Props> = ({ registry }) => {
  return (
    <RegistryContext.Provider value={registry}>
      <UnauthorizedListener />
      <Router />
    </RegistryContext.Provider>
  );
};
