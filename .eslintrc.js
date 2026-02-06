module.exports = {
  env: {
    browser: true,
    es2020: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: [
    '@typescript-eslint',
  ],
  rules: {
    // Allow console.log in extension code (common for debugging)
    'no-console': 'off',
    // Allow unused variables (common in event handlers and VS Code API)
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    // Allow explicit any (common for VS Code API compatibility)
    '@typescript-eslint/no-explicit-any': 'off',
    // Allow require imports (needed for some Node.js modules)
    '@typescript-eslint/no-require-imports': 'off',
    // Allow const reassignments (sometimes needed for logic flow)
    'prefer-const': 'off',
    // Allow undefined globals like NodeJS
    'no-undef': 'off',
  },
  ignorePatterns: [
    'dist/',
    'node_modules/',
    '*.js',
  ],
};