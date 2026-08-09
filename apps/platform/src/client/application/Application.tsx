import type React from 'react';

import { type Registry, RegistryContext } from '@app/common';

import { Router } from './components/Router/Router';

interface Props {
  registry: Registry;
}

export const Application: React.FC<Props> = ({ registry }) => {
  return (
    <RegistryContext.Provider value={registry}>
      <Router />
    </RegistryContext.Provider>
  );
};
