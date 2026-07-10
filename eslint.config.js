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
      // Printing must go through printDocument() (hidden iframe). The old
      // window.open("","_blank")+document.write() pattern is blocked by mobile
      // browsers, which then reload the whole app instead of printing (v156 fix,
      // 2026-07-10). This rule fails the lint if anyone reintroduces it.
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.object.name='window'][callee.property.name='open'][arguments.0.value='']",
        message: "Do not print via window.open(\"\",...)+document.write() — mobile browsers block the popup and reload the app. Use printDocument(html) (hidden-iframe helper) in src/App.jsx instead.",
      }],
    },
  },
])
