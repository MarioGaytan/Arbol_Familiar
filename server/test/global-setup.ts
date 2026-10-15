import pg from 'pg';

/** Crea desde cero la base de pruebas y le aplica las migraciones, igual que al arrancar el servidor. */
export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://arbol:arbol@localhost:5440/arbol_test');
  const dbName = url.pathname.slice(1);
  // Candado de seguridad: jamás borrar una base que no sea de pruebas
  if (!/^[a-z0-9_]+_test$/.test(dbName)) {
    throw new Error(`La base de pruebas debe terminar en "_test" (recibí "${dbName}"). No se tocó nada.`);
  }

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const c = new pg.Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${dbName}`);
  await c.end();

  process.env.DATABASE_URL = url.toString();
  const { migrate } = await import('../src/migrate.js');
  const { pool } = await import('../src/db.js');
  await migrate(() => undefined);
  await pool.end();
}
