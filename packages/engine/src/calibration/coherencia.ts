import type { EngineConfig } from '@vp/config/schemas';
import { leerValor, requerido } from '@vp/config/values';

import type { NivelReforma } from '../types';

/**
 * Coherencia entre el coeficiente de estado de T1 y el coste de obra de T3.
 *
 * Son dos partes del modelo que hablan de lo mismo desde lados opuestos: T1
 * descuenta un porcentaje por estar el piso a reformar, y T3 descuenta el coste
 * real de dejarlo reformado. Si el salto de coeficiente entre "a reformar" y
 * "reformado reciente" no llega a cubrir lo que cuesta la obra, T3 queda por
 * debajo de T1 SIEMPRE, y el motor concluye que reformar destruye valor.
 *
 * Eso puede ser cierto en un mercado barato, pero tambien puede ser sintoma de
 * que los coeficientes de estado estan demasiado juntos o de que el modulo de
 * obra esta demasiado alto para la zona. Este calculo distingue una cosa de la
 * otra dando el precio de zona a partir del cual la obra empieza a compensar.
 */

export interface EquilibrioNivel {
  nivel: NivelReforma;
  modulo_eur_m2: number;
  /** Obra con imprevistos, IVA y margen de seguridad ya dentro. */
  coste_total_eur: number;
  /**
   * Valor que aporta reformar, en coeficiente sobre el EUR/m2 de zona:
   *   coef_reformado - coef_a_reformar
   * Si sale <= 0, no hay precio de zona que haga rentable la obra.
   */
  coeficiente_neto: number;
  /**
   * EUR/m2 util homogeneizado (es decir, ya con el resto de coeficientes
   * aplicados) a partir del cual T3 supera a T1.
   */
  eur_m2_equilibrio: number | null;
  /** Con el EUR/m2 dado, ¿compensa la obra? */
  compensa: boolean | null;
}

export interface ResultadoCoherencia {
  m2_utiles: number;
  coef_a_reformar: number;
  coef_reformado_reciente: number;
  margen_seguridad: number;
  imprevistos: number;
  iva: number;
  eur_m2_homogeneizado_actual: number | null;
  niveles: readonly EquilibrioNivel[];
  /** Resumen accionable para el informe de calibracion. */
  diagnostico: string;
}

const NIVELES: readonly NivelReforma[] = [
  'lavado_de_cara',
  'reforma_parcial',
  'reforma_integral',
  'integral_premium',
];

export function comprobarCoherenciaEstadoReforma(params: {
  config: EngineConfig;
  m2_utiles: number;
  /** EUR/m2 util ya homogeneizado del caso que se esta estudiando, si se tiene. */
  eur_m2_homogeneizado?: number;
  /** true para usar la provision alta de imprevistos. */
  edificio_antiguo_o_sin_proyecto?: boolean;
  /** true si la obra cumple el art. 91 LIVA. */
  iva_reducido?: boolean;
  /**
   * Sustituye el tipo de IVA de la config. Pensado para poder dar una cota
   * inferior con 0 mientras los tipos reales sigan sin verificarse: si a IVA
   * cero la obra ya no compensa, con IVA tampoco, y eso se puede afirmar sin
   * inventar ningun tipo.
   */
  iva_override?: number;
}): ResultadoCoherencia {
  const { config, m2_utiles } = params;
  const coef = config.coeficientes;
  const ref = config.reforma;

  const coefAReformar = leerValor(coef.estado_conservacion.a_reformar, 'coeficientes.estado_conservacion.a_reformar');
  const coefReformado = leerValor(
    coef.estado_conservacion.reformado_reciente,
    'coeficientes.estado_conservacion.reformado_reciente',
  );
  const margen = leerValor(ref.margen_seguridad, 'reforma.margen_seguridad');

  const imprevistos = params.edificio_antiguo_o_sin_proyecto === true
    ? leerValor(ref.imprevistos.edificio_antiguo_o_sin_proyecto, 'reforma.imprevistos.edificio_antiguo_o_sin_proyecto')
    : leerValor(ref.imprevistos.por_defecto, 'reforma.imprevistos.por_defecto');

  const iva =
    params.iva_override ??
    (params.iva_reducido === true
      ? requerido(
          ref.iva.tipo_reducido_rehabilitacion,
          'reforma.iva.tipo_reducido_rehabilitacion',
          'Tipo reducido de IVA.',
        )
      : requerido(ref.iva.tipo_general, 'reforma.iva.tipo_general', 'Tipo general de IVA.'));

  // El margen de seguridad va sobre el coste de obra (ADR-012), asi que:
  //   T3 > T1  <=>  cR x P x m2 - coste x (1 + margen) > cA x P x m2
  //            <=>  P x m2 x (cR - cA) > coste x (1 + margen)
  const coeficienteNeto = coefReformado - coefAReformar;

  const niveles: EquilibrioNivel[] = NIVELES.map((nivel) => {
    const modulo = leerValor(ref.modulos_eur_m2_util[nivel], `reforma.modulos_eur_m2_util.${nivel}`);
    const coste = modulo * m2_utiles * (1 + imprevistos) * (1 + iva) * (1 + margen);

    const equilibrio = coeficienteNeto > 0 ? coste / (coeficienteNeto * m2_utiles) : null;

    return {
      nivel,
      modulo_eur_m2: modulo,
      coste_total_eur: Math.round(coste * 100) / 100,
      coeficiente_neto: Math.round(coeficienteNeto * 1e6) / 1e6,
      eur_m2_equilibrio: equilibrio === null ? null : Math.round(equilibrio * 100) / 100,
      compensa:
        params.eur_m2_homogeneizado === undefined || equilibrio === null
          ? null
          : params.eur_m2_homogeneizado >= equilibrio,
    };
  });

  return {
    m2_utiles,
    coef_a_reformar: coefAReformar,
    coef_reformado_reciente: coefReformado,
    margen_seguridad: margen,
    imprevistos,
    iva,
    eur_m2_homogeneizado_actual: params.eur_m2_homogeneizado ?? null,
    niveles,
    diagnostico: diagnosticar(coeficienteNeto, niveles, params.eur_m2_homogeneizado),
  };
}

function diagnosticar(
  coeficienteNeto: number,
  niveles: readonly EquilibrioNivel[],
  eurM2?: number,
): string {
  if (coeficienteNeto <= 0) {
    return (
      'El coeficiente de "reformado reciente" no supera al de "a reformar": aun con obra gratis, T3 ' +
      'quedaria por debajo de T1. Los dos coeficientes de estado estan mal puestos, porque reformar ' +
      'nunca puede restar valor de mercado.'
    );
  }

  if (eurM2 === undefined) {
    return 'Sin EUR/m2 de referencia no se puede decir si la obra compensa en esta zona.';
  }

  const compensan = niveles.filter((n) => n.compensa === true).map((n) => n.nivel);
  if (compensan.length === 0) {
    const masBarato = niveles[0];
    return (
      `A ${eurM2.toFixed(0)} EUR/m2 homogeneizado, ningun nivel de reforma compensa: ni el mas barato, que ` +
      `necesitaria ${masBarato?.eur_m2_equilibrio?.toFixed(0) ?? '?'} EUR/m2. T3 mandara siempre sobre T1, ` +
      'y el motor dira que reformar destruye valor. Antes de aceptarlo, contrasta el salto entre los ' +
      'coeficientes de estado y los modulos de obra con lo que se paga de verdad en la zona.'
    );
  }

  return (
    `A ${eurM2.toFixed(0)} EUR/m2 homogeneizado compensan estos niveles: ${compensan.join(', ')}. ` +
    'Por encima de ahi, T3 deja de ser el techo limitante.'
  );
}
