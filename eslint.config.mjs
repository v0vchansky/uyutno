import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Модули клиента и границы импортов между ними — ADR 0007.
 * `application` может импортировать всё, остальные — только разрешённое множество.
 * Планер — воркспейс-пакет `@uyutno/planner` (ADR 0015), а не модуль клиента: по графу его импортируют
 * `landing`/`project`/`common`/`application`; `auth` и `core` — нет.
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
      '@uyutno/planner',
      '@uyutno/planner/*',
    ],
  },
  {
    files: ['apps/platform/src/client/core/**/*.{ts,tsx}'],
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
      '@uyutno/planner',
      '@uyutno/planner/*',
    ],
  },
];

const clientNoServer = {
  group: ['@server', '@server/*'],
  message: 'Клиент не импортирует серверный код (ADR 0007, 0010).',
};

// `no-restricted-imports` из разных конфигов не сливается (последний побеждает) — запрет `@server` повторяется здесь,
// иначе override модуля перекрыл бы общий запрет для `apps/platform/src/client/**`.
const clientBoundaryConfigs = clientModuleBoundaries.map(({ files, forbidden }) => ({
  files,
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          clientNoServer,
          ...forbidden.map(pattern => ({
            group: [pattern],
            message: 'Импорт нарушает граф модулей из ADR 0007.',
          })),
        ],
      },
    ],
  },
}));

/**
 * Слои пакета `packages/planner` и направление импортов между ними — ADR 0015.
 * `document/` → `engine/` → `projection/` → `ui/`: слой импортирует только нижележащие; `three` — с `projection/`,
 * `react` — только в `ui/`. Граница с платформой физическая (у пакета нет `@app/*`), правило ниже — для понятного сообщения.
 */
const plannerLayerMessage = 'Импорт нарушает слои пакета планера из ADR 0015.';
const plannerNoPlatform = {
  group: ['@app', '@app/*', '@server', '@server/*'],
  message: 'Пакет планера не импортирует платформу: всё внешнее — через DI (ADR 0015).',
};
const plannerNoThree = { group: ['three', 'three/*'], message: plannerLayerMessage };
const plannerNoReact = { group: ['react', 'react/*', 'react-dom', 'react-dom/*'], message: plannerLayerMessage };
/** Относительные импорты вышележащих слоёв (любой глубины). */
const plannerNoUpperLayers = layers => ({
  group: layers.flatMap(layer => [`**/${layer}`, `**/${layer}/**`]),
  message: plannerLayerMessage,
});

/**
 * Один override на слой: ESLint не сливает `no-restricted-imports` из нескольких конфигов (последний побеждает),
 * поэтому запрет платформы (`plannerNoPlatform`) повторяется в каждом слое, а не задаётся отдельно на `src/**`.
 */
const plannerLayerConfigs = [
  {
    files: ['packages/planner/src/document/**/*.{ts,tsx}'],
    patterns: [plannerNoPlatform, plannerNoThree, plannerNoReact, plannerNoUpperLayers(['engine', 'projection', 'ui'])],
  },
  {
    files: ['packages/planner/src/engine/**/*.{ts,tsx}'],
    patterns: [plannerNoPlatform, plannerNoThree, plannerNoReact, plannerNoUpperLayers(['projection', 'ui'])],
  },
  {
    files: ['packages/planner/src/projection/**/*.{ts,tsx}'],
    patterns: [plannerNoPlatform, plannerNoReact, plannerNoUpperLayers(['ui'])],
  },
  {
    files: ['packages/planner/src/ui/**/*.{ts,tsx}', 'packages/planner/src/*.{ts,tsx}'],
    patterns: [plannerNoPlatform],
  },
].map(({ files, patterns }) => ({
  files,
  rules: {
    'no-restricted-imports': ['error', { patterns }],
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
      // Референсные исходники конкурента (задача 0045) — не наш код.
      'docs/product/reference/**',
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
    files: ['apps/platform/src/client/**/*.{ts,tsx}', 'packages/planner/src/ui/**/*.{ts,tsx}'],
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
      'no-restricted-imports': ['error', { patterns: [clientNoServer] }],
    },
  },
  ...clientBoundaryConfigs,
  ...plannerLayerConfigs,
  {
    files: ['**/*.generated.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  prettier,
);
