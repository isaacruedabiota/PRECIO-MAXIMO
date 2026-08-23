/**
 * Valor de referencia del Catastro, en modo MANUAL.
 *
 * COMPROBADO el 2026-08-22 sobre https://www.sedecatastro.gob.es/Accesos/SECAccvr.aspx:
 * la consulta exige "Certificado electronico de identificacion o DNI electronico"
 * o "Cl@ve PIN - Cl@ve permanente". No hay via anonima, ni siquiera para el
 * inmueble propio.
 *
 * El brief es explicito: si requiere autenticacion, no se rodea. Asi que este
 * adaptador no consulta nada. Da el enlace y los pasos, y recoge la cifra que
 * el usuario haya leido, con su ejercicio y su fecha de consulta.
 *
 * Importa mas de lo que parece: desde la Ley 11/2021 la base imponible del ITP
 * es max(precio escriturado, valor de referencia), asi que un valor de
 * referencia inventado se traduce en euros de impuesto mal calculados.
 */

import { SinDatoError } from '../ports';
import type { Procedencia, Respuesta, ValorReferenciaPort } from '../ports';

export const FUENTE_VALOR_REFERENCIA = 'Catastro - Sede Electronica (valor de referencia)';

export const URL_SEDE_VALOR_REFERENCIA =
  'https://www.sedecatastro.gob.es/Accesos/SECAccvr.aspx';

export interface ValorReferenciaAportado {
  valor_referencia_eur: number;
  /** Ejercicio al que corresponde el valor. El de la fecha de devengo del ITP. */
  ejercicio: number;
  /** ISO (YYYY-MM-DD). Cuando lo consulto el usuario. */
  consultado_en: string;
}

export class ValorReferenciaManualAdapter implements ValorReferenciaPort {
  readonly modo = 'manual' as const;

  instrucciones(rc: string): { url: string; pasos: readonly string[] } {
    return {
      url: URL_SEDE_VALOR_REFERENCIA,
      pasos: [
        `Abre ${URL_SEDE_VALOR_REFERENCIA}`,
        'Elige el ejercicio en el que vayas a firmar: el valor de referencia cambia cada ano.',
        'Entra en "Consulta de valor de referencia".',
        'Identificate con certificado electronico, DNIe o Cl@ve. No hay acceso anonimo.',
        `Introduce la referencia catastral ${rc}.`,
        'Apunta el importe y el ejercicio, y pasalos al calculo.',
      ],
    };
  }

  obtener(
    rc: string,
    aportado?: ValorReferenciaAportado,
  ): Promise<Respuesta<{ valor_referencia_eur: number; ejercicio: number }>> {
    if (aportado === undefined) {
      // Devolver 0, o el valor catastral, o una estimacion, produciria una cuota
      // de ITP plausible y falsa. Se falla, que es la regla 3.
      return Promise.reject(
        new SinDatoError(
          FUENTE_VALOR_REFERENCIA,
          `valor de referencia de ${rc}: requiere certificado o Cl@ve, hay que consultarlo a mano`,
        ),
      );
    }

    const procedencia: Procedencia = {
      fuente: FUENTE_VALOR_REFERENCIA,
      url: URL_SEDE_VALOR_REFERENCIA,
      fecha_dato: `${aportado.ejercicio}-01-01`,
      obtenido_en: aportado.consultado_en,
      desde_cache: false,
    };

    return Promise.resolve({
      datos: {
        valor_referencia_eur: aportado.valor_referencia_eur,
        ejercicio: aportado.ejercicio,
      },
      procedencia,
    });
  }
}
