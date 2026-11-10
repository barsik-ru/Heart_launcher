const tsParser = require('@typescript-eslint/parser')
const reactHooks = require('eslint-plugin-react-hooks')

module.exports = [
  { ignores: ['out/**', 'release/**', 'node_modules/**', 'coverage/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' }
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'no-undef': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
]
