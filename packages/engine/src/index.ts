/**
 * @vp/engine - motor de precio maximo.
 *
 * Reglas de este paquete, sin excepciones:
 *   1. Funcion pura. Cero I/O: ni fetch, ni fs, ni base de datos.
 *   2. Cero Date.now(): la fecha de calculo entra como parametro.
 *   3. Cero numeros de negocio en el codigo: todos vienen de la config.
 *   4. Todo numero de salida es un TrazedValue con fuente, fecha y metodo.
 *
 * Es lo que permite testear el motor de verdad, que es donde se juega el
 * proyecto: si el motor esta mal, lo demas da igual.
 */

export * from './types';

import type { CalcInput, MaxPriceResult } from './types';

export const VERSION_MOTOR = '0.0.0-fase0';

/** Se lanza en lo que aun no esta implementado. Nunca devolver un placeholder. */
export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';

  constructor(que: string) {
    super(`${que} no esta implementado todavia (Fase 0: solo contrato).`);
  }
}

/**
 * PRECIO_MAXIMO = min(T1, T2, T3, T4) - suma(descuentos de riesgo)
 *
 * T3 solo aplica si el estado del inmueble != listo para entrar.
 * T4 solo aplica en modo inversor.
 * Los bloqueantes no descuentan: paran el calculo.
 *
 * FASE 1: implementar techo a techo, con tests antes que codigo.
 */
export function calcularPrecioMaximo(_input: CalcInput): MaxPriceResult {
  throw new NotImplementedError('calcularPrecioMaximo');
}
