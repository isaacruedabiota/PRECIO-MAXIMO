import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema.js';

/**
 * Cliente de base de datos. Driver postgres-js: JavaScript puro, sin binarios
 * nativos que compilar. Detalle no menor cuando el destino de despliegue es una
 * Raspberry Pi arm64.
 */

export type Db = ReturnType<typeof crearDb>;

export function crearDb(url: string = requiereDatabaseUrl()) {
  const sql = postgres(url, {
    // La Pi tiene 4 GB: no hace falta un pool grande y si conviene no gastarla.
    max: 5,
    idle_timeout: 30,
  });
  return drizzle(sql, { schema });
}

function requiereDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'Falta DATABASE_URL. En local: copia .env.example a .env y levanta la base con "pnpm db:up". ' +
        'En la Raspberry Pi la cadena vive en /etc/vp/vp-web.env.',
    );
  }
  return url;
}

export { schema };
export * from './schema.js';
