import { AuthManager, type User } from '@app/auth';
import type { Registry } from '@app/common';

export interface InitialState {
  user: User | null;
}

export const createRegistry = (initialState: InitialState = { user: null }): Registry => ({
  authManager: new AuthManager(initialState.user),
});
