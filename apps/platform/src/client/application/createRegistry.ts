import { AuthManager } from '@app/auth';
import type { Registry } from '@app/common';

export const createRegistry = (): Registry => ({
  authManager: new AuthManager(),
});
