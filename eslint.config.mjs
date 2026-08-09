import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Модули клиента и границы импортов между ними — ADR 0007.
 * `application` может импортировать всё, остальные — только разрешённое множество.
 */
const clientModuleBoundaries = [
  {
    files: ['apps/platform/src/client/landing/**/*.{ts,tsx}'],
    forbidden: ['@app/application', '@app/application/*', '@app/project', '@app/project/*'],
  },
  {
    files: ['apps/platform/src/client/project/**/*.{ts,tsx}'],
    forbidden: ['@app/application', '@app/application/*', '@app/landing', '@app/landing/*'],
  },
  {
    files: ['apps/platform/src/client/common/**/*.{ts,tsx}'],
    forbidden: [
      '@app/application',
      '@app/application/*',
      '@app/landing',
      '@app/landing/*',
      '@app/project',
      '@app/project/*',
    ],
  },
  {
    files: ['apps/platform/src/client/auth/**/*.{ts,tsx}'],
    forbidden: [
      '@app/application',
      '@app/application/*',
      '@app/landing',
      '@app/landing/*',
      '@app/project',
      '@app/project/*',
      '@app/common',
      '@app/common/*',
      '@app/planner',
      '@app/planner/*',
    ],
  },
  {
    files: ['apps/platform/src/client/planner/**/*.{ts,tsx}', 'apps/platform/src/client/core/**/*.{ts,tsx}'],
    forbidden: [
      '@app/application',
      '@app/application/*',
      '@app/landing',
      '@app/landing/*',
      '@app/project',
      '@app/project/*',
      '@app/common',
      '@app/common/*',
      '@app/auth',
      '@app/auth/*',
    ],
  },
];

const clientBoundaryConfigs = clientModuleBoundaries.map(({ files, forbidden }) => ({
  files,
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: forbidden.map(pattern => ({
          group: [pattern],
          message: 'Импорт нарушает граф модулей из ADR 0007.',
        })),
      },
    ],
  },
}));

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.tsbuildinfo',
      '**/coverage/**',
      'docs/ui/handoffs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['apps/platform/src/client/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: globals.browser,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
  {
    files: ['apps/platform/src/server/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@app', '@app/*'],
              message: 'Сервер не импортирует клиентский код (ADR 0007, 0010).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/platform/src/client/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@server', '@server/*'],
              message: 'Клиент не импортирует серверный код (ADR 0007, 0010).',
            },
          ],
        },
      ],
    },
  },
  ...clientBoundaryConfigs,
  {
    files: ['**/*.generated.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  prettier,
);
