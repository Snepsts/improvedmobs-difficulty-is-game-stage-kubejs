import antfu from '@antfu/eslint-config'

export default antfu({
  // antfu overrides
  rules: {
    'no-console': 'off',
    'indent': ['error', 2],
    'quotes': ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
    'no-undef': 'off',
    'brace-style': ['error', '1tbs'],
    'unused-imports/no-unused-vars': 'off',
    'no-useless-return': 'off',
  },
})
