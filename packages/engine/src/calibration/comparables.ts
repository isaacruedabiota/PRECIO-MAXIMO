import type { EngineConfig } from '@vp/config/schemas';

import { calcularT1 } from '../ceilings/t1-mercado';
import { resolverSuperficie } from '../superficie';
import type { MarketData, PropertyInput } from '../types';

/**
 * Contraste contra operaciones observadas.
 *
 * Es el bucle de calibracion de verdad: se le dan operaciones reales con sus
 * caracteristicas y su precio, y devuelve cuanto se equivoca T1 y en que
 * direccion. El sesgo importa mas que el error absoluto: un modelo que falla
 * un 12% arriba y abajo por igual esta mal calibrado en dispersion; uno que
 * falla siempre un 25% a la baja tiene los coeficientes mal puestos.
 *
 * De donde salen los comparables: escrituras del portal del Notariado por
 * codigo postal, o pisos que el propio usuario ha visitado y cuyo precio de
 * cierre conoce. Nunca de un portal inmobiliario: ni scrapeado ni por terceros.
 */

export interface ComparableObservado {
  id: string;
  /** Precio realmente pagado, no el de oferta. */
  precio_observado: number;
  property: PropertyInput;
}

export interface ContrasteComparable {
  id: string;
  observado: number;
  estimado: number;
  error_eur: number;
  /** (estimado - observado) / observado. Positivo = el modelo sobrevalora. */
  error_pct: number;
}

export interface ResultadoContraste {
  n: number;
  /** Media de los errores con signo. Es el sesgo del modelo. */
  sesgo_pct: number;
  /** Media de los errores en valor absoluto. Es la dispersion. */
  error_absoluto_medio_pct: number;
  peor: ContrasteComparable | null;
  detalle: readonly ContrasteComparable[];
  diagnostico: string;
}

export function contrastarComparables(params: {
  comparables: readonly ComparableObservado[];
  market: MarketData;
  config: EngineConfig;
  fecha_calculo: string;
}): ResultadoContraste {
  const { comparables, market, config, fecha_calculo } = params;

  if (comparables.length === 0) {
    throw new Error('Hacen falta comparables observados para contrastar nada.');
  }

  const detalle: ContrasteComparable[] = comparables.map((c) => {
    const { resuelta } = resolverSuperficie(c.property.superficie, config.coeficientes, fecha_calculo);
    const r = calcularT1({
      fecha_calculo,
      property: c.property,
      market,
      config,
      superficie: resuelta,
    });

    const estimado = r.valorTotal;
    const errorEur = estimado - c.precio_observado;

    return {
      id: c.id,
      observado: c.precio_observado,
      estimado: Math.round(estimado * 100) / 100,
      error_eur: Math.round(errorEur * 100) / 100,
      error_pct: Math.round((errorEur / c.precio_observado) * 10000) / 10000,
    };
  });

  const n = detalle.length;
  const sesgo = detalle.reduce((s, d) => s + d.error_pct, 0) / n;
  const absoluto = detalle.reduce((s, d) => s + Math.abs(d.error_pct), 0) / n;
  const peor = detalle.reduce<ContrasteComparable | null>(
    (p, d) => (p === null || Math.abs(d.error_pct) > Math.abs(p.error_pct) ? d : p),
    null,
  );

  return {
    n,
    sesgo_pct: Math.round(sesgo * 10000) / 10000,
    error_absoluto_medio_pct: Math.round(absoluto * 10000) / 10000,
    peor,
    detalle,
    diagnostico: diagnosticar(n, sesgo, absoluto),
  };
}

function diagnosticar(n: number, sesgo: number, absoluto: number): string {
  const partes: string[] = [];

  if (n < 10) {
    partes.push(
      `Solo ${n} comparables: suficiente para detectar un sesgo grosero, no para afinar coeficientes ` +
        'uno a uno. A partir de 15-20 el diagnostico empieza a ser fiable.',
    );
  }

  if (Math.abs(sesgo) < 0.05) {
    partes.push(`Sesgo del ${(sesgo * 100).toFixed(1)}%: el modelo esta centrado.`);
  } else if (sesgo < 0) {
    partes.push(
      `El modelo infravalora un ${Math.abs(sesgo * 100).toFixed(1)}% de media. Los coeficientes penalizan ` +
        'de mas, o el EUR/m2 de partida se queda corto para esta zona.',
    );
  } else {
    partes.push(
      `El modelo sobrevalora un ${(sesgo * 100).toFixed(1)}% de media. Los coeficientes penalizan de menos, ` +
        'o el EUR/m2 de partida esta por encima de lo que se paga en esta zona.',
    );
  }

  partes.push(
    `Error absoluto medio del ${(absoluto * 100).toFixed(1)}%.` +
      (absoluto > 0.15
        ? ' Por encima del 15% la dispersion es demasiado alta para negociar con este numero delante.'
        : ''),
  );

  return partes.join(' ');
}
