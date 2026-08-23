/**
 * Carga de DATABASE_URL para los CLI que tocan la base.
 *
 * Vivia dentro de migrate.ts, pero los scripts de ingesta necesitan lo mismo y
 * duplicarlo llevaria a que uno de los dos se quedara sin el arreglo la proxima
 * vez que haya que tocarlo.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

/** El .env de la raiz del monorepo. */
export const ENV_RAIZ = resolve(AQUI, '..', '..', '..', '.env');

/**
 * Se resuelve desde la ubicacion del modulo y no desde el directorio de
 * trabajo, porque pnpm ejecuta los scripts con el cwd en su propio paquete y un
 * ".env" relativo no lo encontraria.
 */
export function cargarEnv(): void {
  // El entorno real manda sobre el fichero. En la Pi la cadena viene de
  // /etc/vp/vp-web.env via systemd, y un .env que se hubiera colado en el arbol
  // desplegado no debe pisarla.
  if (process.env['DATABASE_URL'] !== undefined) return;
  if (!existsSync(ENV_RAIZ)) return;
  process.loadEnvFile(ENV_RAIZ);
}

/**
 * Devuelve la cadena de conexion o para con un mensaje util. No cae a un valor
 * por defecto: apuntar sin querer a la base equivocada es justo lo que se evito
 * al separar vp de vp_dev.
 */
export function requiereDatabaseUrl(): string {
  cargarEnv();
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    console.error(
      `Falta DATABASE_URL. Se ha buscado en el entorno y en ${ENV_RAIZ}.\n` +
        'Si desarrollas contra la Pi, abre antes el tunel con: pnpm db:tunnel',
    );
    process.exit(1);
  }
  return url;
}

/** Nombre de la base al final de la cadena, para poder decir contra cual se escribe. */
export function nombreDeLaBase(url: string): string {
  const m = /\/([^/?]+)(\?|$)/.exec(url);
  return m?.[1] ?? '(desconocida)';
}
