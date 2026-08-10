import type { InitialState } from './createRegistry';

export const INITIAL_STATE_GLOBAL = '__INITIAL_STATE__';

export const serializeInitialState = (state: InitialState): string => JSON.stringify(state).replace(/</g, '\\u003c');
