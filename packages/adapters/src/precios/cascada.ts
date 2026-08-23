/**
 * Cascada de fuentes de precio de T1.
 *
 *   1. Notariado por codigo postal   precio de escritura, el dato rey
 *   2. MITMA municipal               valor tasado del municipio
 *   3. MITMA provincial              valor tasado de la provincia
 *
 * Lo importante no es solo elegir, sino DEJAR CONSTANCIA de en que escalon se
 * ha parado: la confianza de T1 depende de eso, y un precio provincial aplicado
 * a un piso concreto es una aproximacion muy distinta de una escritura del
 * mismo codigo postal.
 *
 * Funcion pura: la lectura de la base va aparte.
 */

import type { AmbitoPrecio, PrecioM2Referencia } from '@vp/engine';

/** Un candidato ya leido de su fuente, sin decidir todavia si se usa. */
export interface CandidatoPrecio extends PrecioM2Referencia {
  /** Para el informe: por que se ha descartado, si se descarta. */
  descripcion: string;
}

/** Orden de preferencia. Menor es mejor. */
const PRIORIDAD: Readonly<Record<AmbitoPrecio, number>> = {
  codigo_postal: 0,
  municipio: 1,
  provincia: 2,
};

export interface ResultadoCascada {
  elegido: CandidatoPrecio;
  /** Los que se han mirado y no se han usado, con el motivo. */
  descartados: readonly { candidato: CandidatoPrecio; motivo: string }[];
  /** Frase para el informe: de donde sale el numero y que se ha perdido. */
  explicacion: string;
}

export class SinPrecioDeMercadoError extends Error {
  override readonly name = 'SinPrecioDeMercadoError';

  constructor(readonly consulta: string) {
    super(
      `No hay ningun precio de mercado para ${consulta}. ` +
        'El motor no calcula T1 con un precio inventado.',
    );
  }
}

/**
 * Elige el escalon mas fino disponible.
 *
 * No se promedian escalones ni se mezcla un dato de CP con uno provincial:
 * serian numeros distintos con distinta poblacion detras, y el resultado no
 * sabria decir de donde sale.
 */
export function resolverCascada(
  candidatos: readonly CandidatoPrecio[],
  consulta: string,
): ResultadoCascada {
  const validos = candidatos.filter((c) => Number.isFinite(c.eur_m2) && c.eur_m2 > 0);
  if (validos.length === 0) {
    throw new SinPrecioDeMercadoError(consulta);
  }

  const ordenados = [...validos].sort((a, b) => PRIORIDAD[a.ambito] - PRIORIDAD[b.ambito]);
  const elegido = ordenados[0] as CandidatoPrecio;
  const descartados = ordenados.slice(1).map((c) => ({
    candidato: c,
    motivo: `hay dato de ambito ${elegido.ambito}, que es mas fino que ${c.ambito}`,
  }));

  const explicacion =
    elegido.ambito === 'codigo_postal'
      ? `${elegido.descripcion}: precio de escritura del propio codigo postal.`
      : elegido.ambito === 'municipio'
        ? `${elegido.descripcion}: no hay dato de escrituras del codigo postal, se usa el del municipio.`
        : `${elegido.descripcion}: no hay dato del codigo postal ni del municipio, se usa el provincial. ` +
          'Un precio provincial mezcla mercados muy distintos; conviene contrastarlo a mano.';

  return { elegido, descartados, explicacion };
}
