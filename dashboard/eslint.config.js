import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    files: [
      '**/admin-api/**/*.js',
      '**/sandra-chat-api/**/*.js',
      'check_db.js',
      'test-chat.js',
      'src/index.js',
      'src/db/**/*.js',
      'src/routes/**/*.js',
      'src/services/**/*.js',
      'src/middleware/**/*.js',
      'src/queue/**/*.js',
      'src/workers/**/*.js'
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        sourceType: 'commonjs',
      },
    },
  },
])
