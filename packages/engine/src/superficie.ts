import type { CoeficientesConfig } from '@vp/config/schemas';
import { leerValor } from '@vp/config/values';

import { InputInvalidoError } from './errors';
import { aviso, traza } from './trace';
import type { Aviso, SuperficieInput, SuperficieResuelta, TipoSuperficie } from './types';

/**
 * Conversion a superficie util.
 *
 * Es el input que mas dinero mueve de todo el calculo. Entre 85 m2 construidos
 * y los ~70 utiles que suelen corresponderles hay 15 m2 que, a 1.500 EUR/m2,
 * son 22.500 EUR. Por eso la estimacion nunca es silenciosa: degrada la
 * confianza del resultado y deja aviso.
 */

export interface FactorSuperficie {
  factor: number;
  ruta: string;
}

/**
 * Factor que lleva de `tipo` a superficie util.
 *
 * Devuelve null para 'util' porque no hay nada que convertir. Para la
 * construida con comunes lanza si el factor no esta fijado: no se sustituye por
 * el de la construida sin comunes, que es lo que producia el error del 6%.
 */
export function factorAUtil(
  tipo: TipoSuperficie,
  coeficientes: CoeficientesConfig,
): FactorSuperficie | null {
  switch (tipo) {
    case 'util':
      return null;
    case 'construida':
      return {
        factor: leerValor(
          coeficientes.superficie.factor_construida_a_util,
          'coeficientes.superficie.factor_construida_a_util',
        ),
        ruta: 'coeficientes.superficie.factor_construida_a_util',
      };
    case 'construida_con_comunes':
      return {
        factor: leerValor(
          coeficientes.superficie.factor_construida_con_comunes_a_util,
          'coeficientes.superficie.factor_construida_con_comunes_a_util',
        ),
        ruta: 'coeficientes.superficie.factor_construida_con_comunes_a_util',
      };
  }
}

const NOMBRE: Record<TipoSuperficie, string> = {
  util: 'util',
  construida: 'construida',
  construida_con_comunes: 'construida con partes comunes',
};

export function resolverSuperficie(
  superficie: SuperficieInput,
  coeficientes: CoeficientesConfig,
  fechaCalculo: string,
): { resuelta: SuperficieResuelta; avisos: readonly Aviso[] } {
  if (superficie.m2 <= 0) {
    throw new InputInvalidoError('superficie.m2', 'Debe ser mayor que cero.');
  }

  const conversion = factorAUtil(superficie.tipo, coeficientes);

  if (conversion === null) {
    return {
      resuelta: {
        m2_utiles: traza({
          valor: superficie.m2,
          fuente: 'input usuario',
          fecha_dato: fechaCalculo,
          metodo: 'superficie util declarada',
          confianza: 'alta',
          unidad: 'm2',
        }),
        origen: 'declarada_util',
        factor_aplicado: null,
      },
      avisos: [],
    };
  }

  const utiles = superficie.m2 * conversion.factor;

  return {
    resuelta: {
      m2_utiles: traza({
        valor: utiles,
        fuente: `input usuario (${NOMBRE[superficie.tipo]})`,
        fecha_dato: fechaCalculo,
        metodo: `estimacion: ${superficie.m2} m2 ${NOMBRE[superficie.tipo]} x ${conversion.factor}`,
        confianza: 'media',
        unidad: 'm2',
        notas: [
          'La superficie util no venia declarada: se ha estimado.',
          'Pide la nota simple o la cedula para tener el dato real antes de firmar.',
        ],
      }),
      origen: 'estimada_desde_construida',
      factor_aplicado: conversion.factor,
    },
    avisos: [
      aviso(
        'atencion',
        'SUPERFICIE_ESTIMADA',
        'La superficie util es una estimacion',
        `Solo habia dato de superficie ${NOMBRE[superficie.tipo]} (${superficie.m2} m2). Se ha aplicado un ` +
          `factor de ${conversion.factor} para estimar ${utiles.toFixed(1)} m2 utiles. La confianza del techo ` +
          'de mercado queda degradada. Un error de 10 m2 aqui son decenas de miles de euros en el resultado.',
      ),
    ],
  };
}
