import type { EngineConfig } from '@vp/config/schemas';

import { aviso } from '../trace';
import type { Aviso, Bloqueante, PropertyInput, RiesgosInput } from '../types';

/**
 * Bloqueantes.
 *
 * No descuentan: paran el calculo. Dar un precio maximo sobre un inmueble sin
 * division horizontal, o sobre una VPO cuyo precio fija la administracion,
 * seria devolver un numero falso con apariencia de rigor. Es peor que no
 * devolver nada, porque parece util.
 *
 * Un dato a null no bloquea: bloquea el "no" confirmado. Lo desconocido genera
 * aviso, porque bloquear por no haber mirado dejaria la herramienta inservible
 * en el momento en que mas se usa, que es antes de tener toda la documentacion.
 */
export function detectarBloqueantes(
  property: PropertyInput,
  riesgos: RiesgosInput,
  config: EngineConfig,
): { bloqueantes: readonly Bloqueante[]; avisos: readonly Aviso[] } {
  const conf = config.riesgos.bloqueantes;
  const bloqueantes: Bloqueante[] = [];
  const avisos: Aviso[] = [];

  if (property.tiene_division_horizontal === false && conf.sin_division_horizontal.activo) {
    bloqueantes.push({
      codigo: 'SIN_DIVISION_HORIZONTAL',
      titulo: conf.sin_division_horizontal.titulo,
      detalle: conf.sin_division_horizontal.detalle,
      como_verificar: conf.sin_division_horizontal.como_verificar,
      referencia_legal: 'Ley 49/1960 de Propiedad Horizontal',
    });
  } else if (property.tiene_division_horizontal === null) {
    avisos.push(
      aviso(
        'atencion',
        'DIVISION_HORIZONTAL_SIN_COMPROBAR',
        'No se ha comprobado la division horizontal',
        'Si el piso no tiene finca registral propia, ningun banco te dara hipoteca sobre el. ' +
          conf.sin_division_horizontal.como_verificar,
      ),
    );
  }

  if (property.es_vpo === true && conf.vpo_precio_maximo.activo) {
    bloqueantes.push({
      codigo: 'VPO_PRECIO_MAXIMO',
      titulo: conf.vpo_precio_maximo.titulo,
      detalle: conf.vpo_precio_maximo.detalle,
      como_verificar: conf.vpo_precio_maximo.como_verificar,
    });
  } else if (property.es_vpo === null) {
    avisos.push(
      aviso(
        'info',
        'VPO_SIN_COMPROBAR',
        'No se ha comprobado si es vivienda protegida',
        'Si lo fuera y la proteccion siguiera vigente, el precio lo fijaria la administracion y este ' +
          'calculo no serviria. ' + conf.vpo_precio_maximo.como_verificar,
      ),
    );
  }

  if (riesgos.afeccion_urbanistica && conf.afeccion_urbanistica.activo) {
    bloqueantes.push({
      codigo: 'AFECCION_URBANISTICA',
      titulo: conf.afeccion_urbanistica.titulo,
      detalle: conf.afeccion_urbanistica.detalle,
      como_verificar: conf.afeccion_urbanistica.como_verificar,
    });
  }

  return { bloqueantes, avisos };
}
