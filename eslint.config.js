import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', '.output', '.wrangler', 'src/routeTree.gen.ts', 'worker-configuration.d.ts', 'test-results', 'playwright-report'] },
  { files: ['tests/**/*.{ts,mjs}'], languageOptions: { globals: globals.node } },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Context modules export both providers and hooks.
      'react-refresh/only-export-components': 'off',
    },
  },
)
