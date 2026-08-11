import type { AuthManager } from '@app/auth';

import type { OAuthProviderId } from '../../../shared/auth';

export interface Registry {
  authManager: AuthManager;
  oauthEnabledProviders: OAuthProviderId[];
}
