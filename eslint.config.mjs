// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

const UNSAFE_SHELL_MESSAGE =
  'Use the safe wrapper (execFile/spawn with an argument array) from src/main/lib/shell-exec.ts instead of exec/execSync — a string-interpolated shell command is a command-injection risk. See claude.md Code Quality Standard.';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-electron/**',
      '**/out/**',
      '**/build/**',
      '**/release/**',
      '**/.vite/**',
      '**/coverage/**',
      'mockup_design/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain Node scripts (build tooling, ESLint/Vitest configs
    // themselves) — TS files get Node globals from @types/node instead,
    // and don't need this (no-undef is off for TS in the recommended
    // config above).
    files: ['**/*.mjs', '**/*.cjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    rules: {
      // Command-injection guardrail: the raw, shell-interpreting variants of
      // child_process are banned everywhere. Route all shelling-out through
      // apps/desktop/src/main/lib/shell-exec.ts (execFile/spawn, argv array,
      // shell: false) instead.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'child_process',
              importNames: ['exec', 'execSync'],
              message: UNSAFE_SHELL_MESSAGE,
            },
            {
              name: 'node:child_process',
              importNames: ['exec', 'execSync'],
              message: UNSAFE_SHELL_MESSAGE,
            },
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Prettier last: turns off any ESLint formatting rules that would
  // conflict with Prettier's own formatting.
  eslintConfigPrettier,
);
