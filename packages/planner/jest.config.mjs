import { jestBaseConfig } from '../../jest.config.base.mjs';

/** @type {import('jest').Config} */
export default {
  ...jestBaseConfig,
  roots: ['<rootDir>/src'],
};
