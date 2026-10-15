import { defineConfig } from 'vitest/config';

// Base de datos SÓLO para pruebas: se borra y se vuelve a crear en cada corrida.
// Nunca apuntes esto a tu base real; test/global-setup.ts exige que el nombre termine en "_test".
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arbol:arbol@localhost:5440/arbol_test';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Todas las pruebas comparten la misma base: un archivo a la vez
    fileParallelism: false,
    env: { DATABASE_URL: TEST_DATABASE_URL, NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    testTimeout: 15_000,
  },
});
