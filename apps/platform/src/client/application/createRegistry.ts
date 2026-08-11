import { AuthManager, type User } from '@app/auth';
import type { Registry } from '@app/common';

import type { OAuthProviderId } from '../../shared/auth';

export interface InitialState {
  user: User | null;
  oauthEnabledProviders: OAuthProviderId[];
}

const DEFAULT_INITIAL_STATE: InitialState = { user: null, oauthEnabledProviders: [] };

export const createRegistry = (initialState: InitialState = DEFAULT_INITIAL_STATE): Registry => ({
  authManager: new AuthManager(initialState.user),
  oauthEnabledProviders: initialState.oauthEnabledProviders,
});
