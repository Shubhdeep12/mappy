/**
 * ESLint Configuration (Flat Config)
 * 
 * Modern ESLint flat config format for 2026.
 * Supports TypeScript, React, and modern JavaScript.
 * 
 * Plugins:
 * - @eslint/js: Core ESLint rules
 * - typescript-eslint: TypeScript-specific rules
 * - eslint-plugin-react-hooks: React Hooks rules
 * - eslint-plugin-react-refresh: React Fast Refresh rules
 */

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'build',
      'node_modules',
      '*.config.js',
      '*.config.mjs',
      '.pnpm-store',
      'coverage',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unused-imports': 'warn',
    },
  }
);
