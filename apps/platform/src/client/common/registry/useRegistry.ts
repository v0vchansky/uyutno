import { use } from 'react';

import type { Registry } from './Registry';
import { RegistryContext } from './RegistryContext';

export const useRegistry = (): Registry => {
  const registry = use(RegistryContext);
  if (!registry) {
    throw new Error('useRegistry вызван вне RegistryContext.Provider');
  }
  return registry;
};
