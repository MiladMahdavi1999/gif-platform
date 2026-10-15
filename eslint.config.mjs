import tseslint from 'typescript-eslint';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      'work/**',
      'test-results/**',
      'playwright-report/**',
      '**/next-env.d.ts',
    ],
  },
  ...tseslint.configs.recommended,
  ...nextVitals.map((config) => ({
    ...config,
    files: ['apps/web/**/*.{ts,tsx,js,jsx}'],
  })),
  { settings: { next: { rootDir: 'apps/web/' } } },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '@gif/db',
            '@gif/db/*',
            '@gif/storage',
            '@gif/storage/*',
            '**/packages/db/**',
            '**/packages/storage/**',
          ],
        },
      ],
    },
  },
  {
    files: ['apps/worker/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '@gif/web',
            '@gif/api',
            'react',
            'next',
            '**/apps/api/**',
            '**/apps/web/**',
          ],
        },
      ],
    },
  },
];
