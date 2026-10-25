module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  // `usage-example.ts` is a hand-run documentation sample, not application
  // code; its console.log output is part of the example itself.
  ignorePatterns: [
    '.eslintrc.js',
    'dist',
    'node_modules',
    'src/modules/stellar/soroban/usage-example.ts',
  ],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    // Secrets such as password-reset tokens must never reach stdout. Allow
    // `warn`/`error` so intentional diagnostics remain possible; any stray
    // `console.log` (e.g. the one that used to leak the reset token) fails lint.
    'no-console': ['error', { allow: ['warn', 'error'] }],
  },
};
