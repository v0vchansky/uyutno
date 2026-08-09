import { createContext } from 'react';

import type { Registry } from './Registry';

export const RegistryContext = createContext<Registry | null>(null);
