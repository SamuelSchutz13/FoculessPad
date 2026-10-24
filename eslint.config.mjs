import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['web/', 'dist/', 'coverage/', 'node_modules/', 'data/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,
);
