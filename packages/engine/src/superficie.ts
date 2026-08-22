import type { CoeficientesConfig } from '@vp/config/schemas';
import { leerValor } from '@vp/config/values';

import { InputInvalidoError } from './errors';
import { aviso, traza } from './trace';
import type { Aviso, SuperficieInput, SuperficieResuelta } from './types';

/**
 * Resuelve la superficie a metros utiles.
 *
 * Es el input que mas dinero mueve de todo el calculo. Entre 85 m2 construidos
 * y los ~70 utiles que suelen corresponderles hay 15 m2 que, a 1.500 EUR/m2,
 * son 22.500 EUR. Por eso la estimacion nunca es silenciosa: degrada la
 * confianza del resultado y deja aviso.
 */
export function resolverSuperficie(
  superficie: SuperficieInput,
  coeficientes: CoeficientesConfig,
  fechaCalculo: string,
): { resuelta: SuperficieResuelta; avisos: readonly Aviso[] } {
  if (superficie.m2 <= 0) {
    throw new InputInvalidoError('superficie.m2', 'Debe ser mayor que cero.');
  }

  if (superficie.tipo === 'util') {
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

  const factor = leerValor(
    coeficientes.superficie.factor_construida_a_util,
    'coeficientes.superficie.factor_construida_a_util',
  );
  const utiles = superficie.m2 * factor;

  return {
    resuelta: {
      m2_utiles: traza({
        valor: utiles,
        fuente: 'input usuario (construida)',
        fecha_dato: fechaCalculo,
        metodo: `estimacion: ${superficie.m2} m2 construidos x ${factor}`,
        confianza: 'media',
        unidad: 'coeficiente',
        notas: [
          'La superficie util no venia declarada: se ha estimado desde la construida.',
          'Pide la nota simple o la cedula para tener el dato real antes de firmar.',
        ],
      }),
      origen: 'estimada_desde_construida',
      factor_aplicado: factor,
    },
    avisos: [
      aviso(
        'atencion',
        'SUPERFICIE_ESTIMADA',
        'La superficie util es una estimacion',
        `Solo habia dato de superficie construida (${superficie.m2} m2). Se ha aplicado un factor de ` +
          `${factor} para estimar ${utiles.toFixed(1)} m2 utiles. La confianza del techo de mercado ` +
          'queda degradada. Un error de 10 m2 aqui son decenas de miles de euros en el resultado.',
      ),
    ],
  };
}
