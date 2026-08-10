/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/src/client/$1',
    '^@server/(.*)$': '<rootDir>/src/server/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', tsx: true, decorators: false },
          transform: { react: { runtime: 'automatic' } },
          target: 'es2022',
        },
      },
    ],
  },
};
