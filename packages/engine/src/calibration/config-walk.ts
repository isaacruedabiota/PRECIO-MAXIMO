import type { EngineConfig, ValorConfigurable } from '@vp/config/schemas';

/**
 * Recorrido generico de la configuracion, para las herramientas de calibracion.
 *
 * Sin `any` y sin globals del entorno: el motor sigue siendo puro y su tsconfig
 * declara `types: []`, asi que aqui no se puede usar structuredClone.
 */

export function esRegistro(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function esValorConfigurable(v: unknown): v is ValorConfigurable {
  return esRegistro(v) && 'valor' in v;
}

/** Clon profundo. La config es JSON puro, asi que serializar y volver basta. */
export function clonarConfig(config: EngineConfig): EngineConfig {
  return JSON.parse(JSON.stringify(config)) as EngineConfig;
}

/**
 * Recoge todos los valores configurables de una rama, indexados por su ruta.
 * Devuelve referencias vivas al objeto recorrido: mutar el `valor` de una
 * entrada modifica la config que se le paso.
 */
export function recolectarValores(
  raiz: unknown,
  prefijo: string,
): Map<string, ValorConfigurable> {
  const salida = new Map<string, ValorConfigurable>();

  const visitar = (nodo: unknown, ruta: string): void => {
    if (Array.isArray(nodo)) {
      nodo.forEach((hijo, i) => visitar(hijo, `${ruta}[${i}]`));
      return;
    }
    if (!esRegistro(nodo)) return;

    if (esValorConfigurable(nodo)) {
      salida.set(ruta, nodo);
      return; // no descender: min/max/sugerido no son nodos por si mismos
    }

    for (const [clave, valor] of Object.entries(nodo)) {
      if (clave.startsWith('_')) continue;
      visitar(valor, ruta ? `${ruta}.${clave}` : clave);
    }
  };

  visitar(raiz, prefijo);
  return salida;
}
