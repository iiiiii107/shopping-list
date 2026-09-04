import { defineConfig } from 'vitest/config';

/* The rules tests are their own run: they need the emulator, they talk over a
   socket, and they have no business slowing down `npm test`. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/rules.test.js'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
