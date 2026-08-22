import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_FILES, type EngineConfig } from './schemas';
import { InvalidConfigError } from './values';

/**
 * Carga y validacion de la configuracion de negocio.
 *
 * El motor NO usa este modulo: es I/O. Quien carga la config es el borde de la
 * aplicacion (la web, un script CLI, un test) y se la pasa al motor ya validada.
 * Los helpers de lectura que si usa el motor viven en values.ts, sin Node.
 */

export { InvalidConfigError, MissingConfigError, leerValor, requerido } from './values';

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

const AQUI = dirname(fileURLToPath(import.meta.url));

/**
 * Directorio de los JSON. Sobrescribible con VP_CONFIG_DIR para poder ajustar
 * los tipos de ITP en la Raspberry Pi sin reconstruir la aplicacion.
 */
export function configDir(): string {
  const desdeEnv = process.env['VP_CONFIG_DIR'];
  const dir = desdeEnv ? resolve(desdeEnv) : resolve(AQUI, '..', 'data');

  // El bundle de produccion mueve los ficheros compilados, asi que la ruta
  // relativa al modulo puede dejar de apuntar a data/. Mejor un error explicito
  // ahora que un "cannot read file" tres capas mas abajo.
  if (!existsSync(dir)) {
    throw new InvalidConfigError(
      dir,
      desdeEnv
        ? 'VP_CONFIG_DIR apunta a un directorio que no existe.'
        : 'No se encuentra el directorio de configuracion. Define VP_CONFIG_DIR.',
    );
  }
  return dir;
}

export interface ConfigCargada {
  config: EngineConfig;
  /** JSON crudo por fichero, para auditar y para mostrar en la UI. */
  raw: Record<string, unknown>;
  dir: string;
}

export function loadConfig(dir: string = configDir()): ConfigCargada {
  const raw: Record<string, unknown> = {};
  const parsed: Record<string, unknown> = {};
  const huellas: string[] = [];

  for (const [clave, { archivo, schema }] of Object.entries(CONFIG_FILES)) {
    const ruta = join(dir, archivo);

    let contenido: string;
    try {
      contenido = readFileSync(ruta, 'utf8');
    } catch (causa) {
      throw new InvalidConfigError(ruta, `No se puede leer el fichero: ${String(causa)}`);
    }

    let json: unknown;
    try {
      json = JSON.parse(contenido);
    } catch (causa) {
      throw new InvalidConfigError(ruta, `JSON mal formado: ${String(causa)}`);
    }

    const resultado = schema.safeParse(json);
    if (!resultado.success) {
      const problemas = resultado.error.issues
        .map((i) => `  - ${i.path.join('.') || '(raiz)'}: ${i.message}`)
        .join('\n');
      throw new InvalidConfigError(archivo, problemas);
    }

    raw[clave] = json;
    parsed[clave] = resultado.data;
    huellas.push(contenido);
  }

  const huella = createHash('sha256').update(huellas.join('\u0000')).digest('hex').slice(0, 12);

  const config = {
    ...(parsed as Omit<EngineConfig, 'version'>),
    version: huella,
  } as EngineConfig;

  return { config, raw, dir };
}

// ---------------------------------------------------------------------------
// Auditoria: que falta por rellenar y que falta por verificar
// ---------------------------------------------------------------------------

export interface AuditoriaConfig {
  /** Rutas con valor null. El motor lanzara si necesita alguna de ellas. */
  pendientes: string[];
  /** Bloques con verificado: false. No impiden calcular, pero generan aviso. */
  sin_verificar: string[];
  /** Rutas con `valor` fijado pero fuera de la horquilla min/max declarada. */
  fuera_de_rango: string[];
}

function esValorConfigurable(nodo: Record<string, unknown>): boolean {
  return 'valor' in nodo;
}

export function auditarConfig(raw: Record<string, unknown>): AuditoriaConfig {
  const pendientes: string[] = [];
  const sin_verificar: string[] = [];
  const fuera_de_rango: string[] = [];

  const visitar = (nodo: unknown, ruta: string): void => {
    if (Array.isArray(nodo)) {
      nodo.forEach((hijo, i) => visitar(hijo, `${ruta}[${i}]`));
      return;
    }
    if (nodo === null || typeof nodo !== 'object') return;

    const obj = nodo as Record<string, unknown>;

    if (esValorConfigurable(obj)) {
      const valor = obj['valor'];
      if (valor === null) {
        pendientes.push(`${ruta}.valor`);
      } else if (typeof valor === 'number') {
        const min = obj['min'];
        const max = obj['max'];
        if (typeof min === 'number' && valor < min) fuera_de_rango.push(`${ruta}.valor (${valor} < min ${min})`);
        if (typeof max === 'number' && valor > max) fuera_de_rango.push(`${ruta}.valor (${valor} > max ${max})`);
      }
      return; // no descender: min/max/sugerido no son campos pendientes
    }

    for (const [clave, valor] of Object.entries(obj)) {
      // Las claves _doc, _como_rellenar, etc. son documentacion inline.
      if (clave.startsWith('_')) continue;

      const sub = ruta ? `${ruta}.${clave}` : clave;

      if (clave === 'verificado' && valor === false) {
        sin_verificar.push(ruta || '(raiz)');
        continue;
      }
      if (valor === null) {
        pendientes.push(sub);
        continue;
      }
      visitar(valor, sub);
    }
  };

  for (const [clave, contenido] of Object.entries(raw)) {
    visitar(contenido, clave);
  }

  return { pendientes, sin_verificar, fuera_de_rango };
}
