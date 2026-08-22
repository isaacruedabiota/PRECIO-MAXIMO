import type { EngineConfig } from '@vp/config/schemas';

import type { CalcInput } from '../types';
import { clonarConfig, recolectarValores } from './config-walk';

/**
 * Analisis de sensibilidad.
 *
 * Mueve cada valor configurable a los extremos de su horquilla y mide cuanto se
 * desplaza el precio maximo. Sirve para decidir donde gastar el esfuerzo de
 * verificacion: con 93 valores pendientes no todos merecen la misma atencion.
 * Los que apenas mueven el resultado pueden esperar; los que lo mueven miles de
 * euros hay que contrastarlos antes de fiarse del numero.
 */

export interface ImpactoValor {
  ruta: string;
  valor_actual: number | null;
  min: number | null;
  max: number | null;
  precio_en_min: number | null;
  precio_en_max: number | null;
  /** Diferencia de precio maximo entre los dos extremos de la horquilla. */
  recorrido_eur: number;
  /** Ese recorrido como fraccion del precio maximo del caso base. */
  recorrido_pct: number;
  error: string | null;
}

export interface ResultadoSensibilidad {
  precio_base: number;
  impactos: readonly ImpactoValor[];
}

/** Firma minima del motor que necesita el analisis, para no crear un ciclo. */
export type Calculadora = (input: CalcInput) => { precio_maximo: { valor: number } | null };

/**
 * @param ramas Secciones de config a explorar. Por defecto las que alimentan T1
 *              y T3, que son las que se estan calibrando.
 */
export function analizarSensibilidad(
  input: CalcInput,
  calcular: Calculadora,
  ramas: readonly (keyof EngineConfig)[] = ['coeficientes', 'reforma'],
): ResultadoSensibilidad {
  const base = calcular(input).precio_maximo?.valor;
  if (base === undefined || base === null) {
    throw new Error('El caso base no produce precio maximo: no hay nada que sensibilizar.');
  }

  const originales = recolectarValores(seleccionar(input.config, ramas), '');
  const impactos: ImpactoValor[] = [];

  for (const [ruta, original] of originales) {
    const actual = original.valor ?? null;
    // Sin horquilla declarada se explora un +-10% alrededor del valor actual.
    const min = original.min ?? (actual !== null ? actual * 0.9 : null);
    const max = original.max ?? (actual !== null ? actual * 1.1 : null);

    const enMin = precioCon(input, calcular, ramas, ruta, min);
    const enMax = precioCon(input, calcular, ramas, ruta, max);
    const recorrido = enMin !== null && enMax !== null ? Math.abs(enMax - enMin) : 0;

    impactos.push({
      ruta,
      valor_actual: actual,
      min,
      max,
      precio_en_min: enMin,
      precio_en_max: enMax,
      recorrido_eur: Math.round(recorrido * 100) / 100,
      recorrido_pct: base === 0 ? 0 : Math.round((recorrido / base) * 10000) / 10000,
      error: enMin === null || enMax === null ? 'no evaluable' : null,
    });
  }

  impactos.sort((a, b) => b.recorrido_eur - a.recorrido_eur);
  return { precio_base: base, impactos };
}

// ---------------------------------------------------------------------------

function seleccionar(
  config: EngineConfig,
  ramas: readonly (keyof EngineConfig)[],
): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const rama of ramas) salida[rama] = config[rama];
  return salida;
}

/** Recalcula el precio maximo con un unico valor de config sustituido. */
function precioCon(
  input: CalcInput,
  calcular: Calculadora,
  ramas: readonly (keyof EngineConfig)[],
  ruta: string,
  valor: number | null,
): number | null {
  if (valor === null) return null;

  const config = clonarConfig(input.config);
  const objetivo = recolectarValores(seleccionar(config, ramas), '').get(ruta);
  if (objetivo === undefined) return null;

  objetivo.valor = valor;

  try {
    return calcular({ ...input, config }).precio_maximo?.valor ?? null;
  } catch {
    // Un valor extremo puede dejar la config incoherente. No es un fallo del
    // analisis: simplemente ese punto no se puede evaluar.
    return null;
  }
}
