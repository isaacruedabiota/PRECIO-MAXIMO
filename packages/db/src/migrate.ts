/**
 * CLI: pnpm db:migrate
 *
 * Habilita PostGIS y aplica las migraciones generadas por drizzle-kit.
 * PostGIS va antes porque el esquema declara columnas geometry.
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ENV_RAIZ = resolve(AQUI, '..', '..', '..', '.env');

/**
 * Carga el .env de la raiz del monorepo.
 *
 * Se resuelve desde la ubicacion del modulo y no desde el directorio de
 * trabajo, porque pnpm ejecuta este script con el cwd en packages/db y un
 * ".env" relativo no lo encontraria.
 */
function cargarEnv(): void {
  // El entorno real manda sobre el fichero. En la Pi la cadena viene de
  // /etc/vp/vp-web.env via systemd, y un .env que se hubiera colado en el arbol
  // desplegado no debe pisarla.
  if (process.env['DATABASE_URL'] !== undefined) return;
  if (!existsSync(ENV_RAIZ)) return;
  process.loadEnvFile(ENV_RAIZ);
}

async function main(): Promise<void> {
  cargarEnv();
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.error(
      `Falta DATABASE_URL. Se ha buscado en el entorno y en ${ENV_RAIZ}.
` +
        'Si desarrollas contra la Pi, abre antes el tunel con: pnpm db:tunnel',
    );
    process.exit(1);
  }

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
