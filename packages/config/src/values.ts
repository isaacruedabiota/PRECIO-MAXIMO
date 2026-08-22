import type { ValorConfigurable } from './schemas';

/**
 * Lectura de valores de configuracion. Cero dependencias de Node a proposito:
 * el motor importa este modulo en runtime y su tsconfig declara `types: []`,
 * asi que aqui no puede entrar nada de fs, path ni process.
 *
 * El cargador (loader.ts) sí hace I/O y vive aparte.
 */

/**
 * Se lanza cuando el motor necesita un numero que sigue sin fijarse.
 *
 * Es la pieza que implementa la regla "falla ruidosamente". Un ITP mal puesto
 * son 8.000 EUR de error en un piso de 200.000: preferimos una excepcion con la
 * ruta exacta del campo a un resultado plausible calculado sobre un valor por
 * defecto que nadie decidio.
 */
export class MissingConfigError extends Error {
  override readonly name = 'MissingConfigError';

  constructor(
    readonly ruta: string,
    readonly detalle: string,
  ) {
    super(`Falta configurar "${ruta}". ${detalle}`);
  }
}

/** Se lanza cuando un fichero de config no cumple su esquema o no se puede leer. */
export class InvalidConfigError extends Error {
  override readonly name = 'InvalidConfigError';

  constructor(
    readonly archivo: string,
    readonly problemas: string,
  ) {
    super(`Config invalida en ${archivo}:\n${problemas}`);
  }
}

/** Devuelve el valor o lanza. Para cualquier campo escalar de config. */
export function requerido<T>(valor: T | null | undefined, ruta: string, detalle: string): T {
  if (valor === null || valor === undefined) {
    throw new MissingConfigError(ruta, detalle);
  }
  return valor;
}

/**
 * Lee el campo `valor` de un ValorConfigurable. Nunca cae al `sugerido`: el
 * sugerido es una propuesta para la UI y para `config:seed`, no un valor de
 * calculo. Que el motor cayese a el produciria resultados plausibles que nadie
 * ha validado, que es justo lo que este proyecto existe para evitar.
 */
export function leerValor(v: ValorConfigurable, ruta: string): number {
  if (v.valor === null || v.valor === undefined) {
    const pista =
      v.sugerido !== null && v.sugerido !== undefined
        ? ` El brief sugiere ${v.sugerido}; fijalo explicitamente en "valor" o ejecuta pnpm config:seed.`
        : '';
    throw new MissingConfigError(`${ruta}.valor`, `Sigue a null.${pista}`);
  }
  return v.valor;
}
