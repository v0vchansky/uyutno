import { jestBaseConfig } from '../../jest.config.base.mjs';

/** @type {import('jest').Config} */
export default {
  ...jestBaseConfig,
  roots: ['<rootDir>/src'],
  // `robust-predicates` — ESM-only (ADR 0017 C2): Jest без vm-modules требует CJS, поэтому пакет
  // прогоняется через тот же swc-transform, что и исходники (pnpm-раскладка `.pnpm/<pkg>@<v>/node_modules/<pkg>`).
  transformIgnorePatterns: ['/node_modules/(?!.*robust-predicates)'],
};
