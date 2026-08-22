import type { EngineConfig } from '@vp/config/schemas';
import { leerValor } from '@vp/config/values';

import { aviso, traza } from '../trace';
import type { Aviso, DescuentoRiesgo, RiesgosInput } from '../types';

/**
 * Descuentos por riesgo. Se restan del minimo de los cuatro techos.
 *
 * Los importes que el usuario puede leer en un documento (una derrama del acta,
 * una carga de la nota simple) entran tal cual y no se estiman nunca. Lo que hay
 * que estimar se estima con config, y si la config no esta puesta el descuento
 * no se aplica pero queda aviso: un riesgo sin cuantificar sigue siendo un
 * riesgo, y callarlo seria peor que no valorarlo.
 */
export function calcularDescuentos(
  riesgos: RiesgosInput,
  config: EngineConfig,
  fechaCalculo: string,
  minimoTechos: number,
): { descuentos: readonly DescuentoRiesgo[]; avisos: readonly Aviso[] } {
  const conf = config.riesgos.descuentos;
  const descuentos: DescuentoRiesgo[] = [];
  const avisos: Aviso[] = [];

  // --- Derramas aprobadas: importe del acta, nunca estimado ---
  if (riesgos.derramas_aprobadas_eur > 0) {
    descuentos.push({
      codigo: 'DERRAMA_APROBADA',
      concepto: 'Derrama aprobada en junta',
      importe: traza({
        valor: riesgos.derramas_aprobadas_eur,
        fuente: 'input usuario (acta de la junta)',
        fecha_dato: fechaCalculo,
        metodo: 'importe absoluto',
        confianza: 'alta',
        unidad: 'EUR',
      }),
      justificacion:
        'Es una deuda ya aprobada que asume quien compra. No es una estimacion: sale del acta, y por eso ' +
        'es el argumento mas solido que puedes llevar a la mesa.',
    });
  }

  // --- Cargas registrales: importe de la nota simple ---
  if (riesgos.cargas_registrales_eur > 0) {
    descuentos.push({
      codigo: 'CARGAS_REGISTRALES',
      concepto: 'Cargas registrales',
      importe: traza({
        valor: riesgos.cargas_registrales_eur,
        fuente: 'input usuario (nota simple)',
        fecha_dato: fechaCalculo,
        metodo: 'importe absoluto',
        confianza: 'alta',
        unidad: 'EUR',
      }),
      justificacion:
        'Hipoteca viva, embargos o censos que constan en el Registro. Tienen que cancelarse antes o en el ' +
        'momento de la firma, y hasta entonces son riesgo del comprador.',
    });
  }

  // --- ITE ---
  if (riesgos.ite === 'desfavorable' || riesgos.ite === 'no_pasada') {
    const clave = riesgos.ite === 'desfavorable' ? 'ite_desfavorable' : 'ite_no_pasada';
    const entrada = conf[clave].eur_por_m2_fachada;

    if (entrada.valor === null) {
      avisos.push(
        aviso(
          'atencion',
          'ITE_SIN_CUANTIFICAR',
          `La ITE esta ${riesgos.ite === 'desfavorable' ? 'desfavorable' : 'sin pasar'} y no se ha cuantificado`,
          `riesgos.descuentos.${clave}.eur_por_m2_fachada sigue a null, asi que no se ha descontado nada. ` +
            'El riesgo sigue ahi: pide el acta de la ultima junta y el informe de la ITE antes de ofertar.',
        ),
      );
    } else if (riesgos.metros_fachada_edificio === null) {
      avisos.push(
        aviso(
          'atencion',
          'ITE_SIN_METROS_FACHADA',
          'No se puede estimar el coste de la ITE',
          `La ITE esta ${riesgos.ite}, pero sin los metros de fachada del edificio no hay forma de estimar ` +
            'la derrama futura. El riesgo no esta descontado.',
        ),
      );
    } else {
      const eurM2 = leerValor(entrada, `riesgos.descuentos.${clave}.eur_por_m2_fachada`);
      const importe = eurM2 * riesgos.metros_fachada_edificio;
      descuentos.push({
        codigo: clave.toUpperCase(),
        concepto:
          riesgos.ite === 'desfavorable'
            ? 'Inspeccion tecnica del edificio desfavorable'
            : 'Inspeccion tecnica del edificio sin pasar',
        importe: traza({
          valor: importe,
          fuente: 'config/riesgos.json',
          fecha_dato: fechaCalculo,
          metodo: `${eurM2} EUR/m2 x ${riesgos.metros_fachada_edificio} m2 de fachada`,
          confianza: 'baja',
          unidad: 'EUR',
        }),
        justificacion:
          riesgos.ite === 'desfavorable'
            ? 'Una ITE desfavorable obliga a ejecutar las obras. La derrama llega, la cuestion es cuando.'
            : 'Sin ITE pasada no sabes que va a salir. Es riesgo puro y se descuenta como tal.',
      });
    }
  }

  // --- Fibrocemento ---
  if (riesgos.fibrocemento_en_cubierta) {
    const entrada = conf.fibrocemento.eur;
    if (entrada.valor === null) {
      avisos.push(
        aviso(
          'critico',
          'FIBROCEMENTO_SIN_CUANTIFICAR',
          'Hay fibrocemento en cubierta y no se ha cuantificado su retirada',
          'riesgos.descuentos.fibrocemento.eur sigue a null. La retirada exige empresa inscrita en el RERA ' +
            'y plan de trabajo aprobado, y no es barata. Pide presupuesto antes de ofertar.',
        ),
      );
    } else {
      const importe = leerValor(entrada, 'riesgos.descuentos.fibrocemento.eur');
      descuentos.push({
        codigo: 'FIBROCEMENTO',
        concepto: 'Retirada de fibrocemento en cubierta',
        importe: traza({
          valor: importe,
          fuente: 'config/riesgos.json',
          fecha_dato: fechaCalculo,
          metodo: 'importe configurado',
          confianza: 'baja',
          unidad: 'EUR',
        }),
        justificacion:
          'La retirada solo puede hacerla una empresa inscrita en el RERA, con plan de trabajo aprobado ' +
          'por la autoridad laboral.',
      });
    }
  }

  // --- Riesgos porcentuales sobre el minimo de los techos ---
  const porcentuales: { activo: boolean; clave: 'zona_inundable' | 'suelo_contaminado'; concepto: string; justificacion: string }[] = [
    {
      activo: riesgos.zona_inundable === 'si',
      clave: 'zona_inundable',
      concepto: 'Zona inundable',
      justificacion:
        'Encarece el seguro, puede complicar la financiacion y limita la reventa. Comprueba la cartografia ' +
        'de zonas inundables antes de comprometerte.',
    },
    {
      activo: riesgos.suelo_contaminado,
      clave: 'suelo_contaminado',
      concepto: 'Suelo contaminado',
      justificacion: 'La declaracion de suelo contaminado arrastra obligaciones de descontaminacion.',
    },
  ];

  for (const p of porcentuales) {
    if (!p.activo) continue;
    const entrada = conf[p.clave].pct;
    if (entrada.valor === null) {
      avisos.push(
        aviso(
          'critico',
          `${p.clave.toUpperCase()}_SIN_CUANTIFICAR`,
          `${p.concepto}: riesgo detectado y sin cuantificar`,
          `riesgos.descuentos.${p.clave}.pct sigue a null, asi que no se ha descontado nada por este ` +
            'concepto. El riesgo existe igualmente.',
        ),
      );
      continue;
    }
    const pct = leerValor(entrada, `riesgos.descuentos.${p.clave}.pct`);
    descuentos.push({
      codigo: p.clave.toUpperCase(),
      concepto: p.concepto,
      importe: traza({
        valor: minimoTechos * pct,
        fuente: 'config/riesgos.json',
        fecha_dato: fechaCalculo,
        metodo: `${(pct * 100).toFixed(1)}% sobre el minimo de los techos`,
        confianza: 'baja',
        unidad: 'EUR',
      }),
      justificacion: p.justificacion,
    });
  }

  if (riesgos.zona_inundable === 'desconocido') {
    avisos.push(
      aviso(
        'info',
        'ZONA_INUNDABLE_SIN_COMPROBAR',
        'No se ha comprobado si esta en zona inundable',
        'Es una consulta rapida en la cartografia de zonas inundables y afecta al seguro y a la reventa.',
      ),
    );
  }

  return { descuentos, avisos };
}
