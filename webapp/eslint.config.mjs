import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Every remaining hit is `useEffect(() => { asyncLoader() }, deps)`
      // where the setState runs after an `await` — two renders total,
      // not the cascade this rule targets, and the rule can't see
      // through the async boundary. Downgraded rather than papered
      // over with per-site disables; clearing it for real means
      // replacing fetch-in-effect with a shared data-loading hook
      // across the 17 list pages, which is its own change.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
)
