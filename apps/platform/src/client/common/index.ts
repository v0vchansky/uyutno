export { Logo } from './components/Logo/Logo';
export { PublicLayout } from './components/PublicLayout/PublicLayout';

export { displayNameOrEmailFallback, initialsFromName } from './lib/userDisplay';

export { api, UNAUTHORIZED_EVENT } from './http/api';
export type { UnauthorizedEventDetail } from './http/api';

export { TERMS_URL, PRIVACY_URL } from './legal/legalUrls';

export type { Registry } from './registry/Registry';
export { RegistryContext } from './registry/RegistryContext';
export { useRegistry } from './registry/useRegistry';
