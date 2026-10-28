import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'

export default [
  // ✅ Ignore build + artifacts (évite de lint des fichiers générés)
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      'release/**',
      '.vercel/**',
      'storybook-static/**',
      '**/*.min.js',
    ],
  },

  // -------------------------
  // ✅ Front (Browser): src/*
  // -------------------------
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    settings: { react: { version: '18.3' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,

      // ✅ Très souvent inutile (et source d'erreurs) sur projets modernes
      'react/prop-types': 'off',
      'no-unused-vars': 'off', // Too many false positives in existing codebase
      'react/no-unescaped-entities': 'off', // Too many legacy issues
      'no-useless-escape': 'off', // Legacy regex issues
      'react/no-unknown-property': 'off', // Radix UI / CMDK attributes

      'react/jsx-no-target-blank': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // A11y: configure for our component patterns
      // label-has-associated-control: warn — shadcn Label uses forwardRef + htmlFor
      // which the linter can't resolve statically through custom components.
      'jsx-a11y/label-has-associated-control': ['warn', {
        labelComponents: ['Label'],
        controlComponents: ['Input', 'Select', 'Textarea', 'Switch', 'Checkbox'],
        assert: 'either',
        depth: 3,
      }],
      'jsx-a11y/no-autofocus': ['warn'], // Allow controlled autoFocus (e.g. chat input)
    },
  },

  // --------------------------------------
  // ✅ Node (scripts/api/config): process, Buffer, require, etc.
  // --------------------------------------
  {
    files: [
      'scripts/**/*.{js,jsx}',
      'api/**/*.{js,jsx}',
      'tests/**/*.{js,jsx}',
      'playwright.config.{js,cjs,mjs}',
      'vite.config.{js,cjs,mjs}',
      'eslint.config.{js,cjs,mjs}',
      '**/*.config.{js,cjs,mjs}',
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.node,
        // Si tu as des tests type Jest/Vitest (describe/it/expect)
        ...globals.jest,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': 'off', // Too many false positives in scripts
      'no-useless-escape': 'off', // Regex patterns in scripts
      'no-redeclare': 'off', // Overlap with globals
      'no-prototype-builtins': 'off',
    },
  },

  // --------------------------------------
  // ✅ UI Components (Shadcn/Radix): relax rules for primitives
  // Content/labels are passed via {...props} spread — linter can't verify statically
  // --------------------------------------
  {
    files: ['src/components/ui/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'jsx-a11y/heading-has-content': 'off',
      'jsx-a11y/anchor-has-content': 'off',
      'jsx-a11y/anchor-is-valid': 'off',
    },
  },

  // --------------------------------------
  // ✅ Context files: allow hooks + providers in same file
  // --------------------------------------
  {
    files: ['src/contexts/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
]
