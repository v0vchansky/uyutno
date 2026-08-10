import { randomBytes } from 'node:crypto';

const SESSION_ID_BYTES = 32;

export const generateSessionId = (): string => randomBytes(SESSION_ID_BYTES).toString('base64url');
