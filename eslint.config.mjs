import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.d.ts',
      '**/.sovra-storage*/**',
      '**/.test-e2e-storage/**',
      '**/chain/data/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      'no-console': ['warn', { allow: ['debug', 'info', 'warn', 'error'] }],
      'no-debugger': 'error',
    },
  },
];
