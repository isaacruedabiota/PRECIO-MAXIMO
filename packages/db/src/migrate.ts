/**
 * CLI: pnpm db:migrate
 *
 * Habilita PostGIS y aplica las migraciones generadas por drizzle-kit.
 * PostGIS va antes porque el esquema declara columnas geometry.
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nombreDeLaBase, requiereDatabaseUrl } from './env';

const AQUI = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const url = requiereDatabaseUrl();
  console.log(`Base: ${nombreDeLaBase(url)}`);

  // max: 1 -> las migraciones van en una sola conexion, en orden.
  const sql = postgres(url, { max: 1 });

  try {
    await sql`CREATE EXTENSION IF NOT EXISTS postgis`;
    console.log('PostGIS disponible.');

    const db = drizzle(sql);
    await migrate(db, { migrationsFolder: resolve(AQUI, '..', 'migrations') });
    console.log('Migraciones aplicadas.');
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error('Fallo al migrar:', error);
  process.exit(1);
});
