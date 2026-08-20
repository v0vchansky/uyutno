import { jestBaseConfig } from '../../jest.config.base.mjs';

/** @type {import('jest').Config} */
export default {
  ...jestBaseConfig,
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    ...jestBaseConfig.moduleNameMapper,
    '^@app/(.*)$': '<rootDir>/src/client/$1',
    '^@server/(.*)$': '<rootDir>/src/server/$1',
  },
  // `kysely` и `uuidv7` — ESM-only: Jest без vm-modules требует CJS, поэтому пакеты прогоняются
  // через тот же swc-transform, что и исходники (pnpm-раскладка `.pnpm/<pkg>@<v>/node_modules/<pkg>`).
  transformIgnorePatterns: ['/node_modules/(?!.*(kysely|uuidv7))'],
};
