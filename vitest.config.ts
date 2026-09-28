import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          root: import.meta.dirname,
          include: ['packages/*/test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'contracts',
          root: import.meta.dirname,
          include: ['test/contracts/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'privacy',
          root: import.meta.dirname,
          include: ['test/privacy/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
