import type { Aviso, Confianza, DesgloseLinea, NivelAviso, TrazedValue, Unidad } from './types';

/**
 * Utilidades de trazabilidad.
 *
 * Todo numero que sale del motor pasa por aqui. Si construir el TrazedValue
 * resulta incomodo en algun sitio, la respuesta correcta es averiguar de donde
 * sale el numero, no saltarse el envoltorio.
 */

const ORDEN_CONFIANZA: Record<Confianza, number> = { alta: 3, media: 2, baja: 1 };

/** La confianza de un calculo es la de su eslabon mas debil. */
export function peorConfianza(...niveles: readonly Confianza[]): Confianza {
  return niveles.reduce<Confianza>(
    (peor, actual) => (ORDEN_CONFIANZA[actual] < ORDEN_CONFIANZA[peor] ? actual : peor),
    'alta',
  );
}

export interface DatosTraza {
  valor: number;
  fuente: string;
  fecha_dato: string;
  metodo: string;
  confianza: Confianza;
  unidad: Unidad;
  notas?: readonly string[];
}

/**
 * Construye un TrazedValue redondeando a la precision que corresponde a su
 * unidad. Los euros a centimos, los coeficientes a cuatro decimales: arrastrar
 * ruido de coma flotante hasta el informe no aporta rigor, solo lo aparenta.
 */
export function traza(datos: DatosTraza): TrazedValue {
  const decimales = ['EUR', 'EUR/m2', 'm2'].includes(datos.unidad) ? 2 : 6;
  const factor = 10 ** decimales;
  const valor = Math.round(datos.valor * factor) / factor;

  const base = {
    valor,
    fuente: datos.fuente,
    fecha_dato: datos.fecha_dato,
    metodo: datos.metodo,
    confianza: datos.confianza,
    unidad: datos.unidad,
  };

  return datos.notas !== undefined && datos.notas.length > 0
    ? { ...base, notas: datos.notas }
    : base;
}

export function linea(concepto: string, valor: TrazedValue, formula?: string): DesgloseLinea {
  return formula !== undefined ? { concepto, valor, formula } : { concepto, valor };
}

export function aviso(
  nivel: NivelAviso,
  codigo: string,
  titulo: string,
  detalle: string,
  referencia_legal?: string,
): Aviso {
  return referencia_legal !== undefined
    ? { nivel, codigo, titulo, detalle, referencia_legal }
    : { nivel, codigo, titulo, detalle };
}

/** Extrae el año de una fecha ISO sin construir un Date (el motor es puro). */
export function anioDe(fechaIso: string): number {
  const anio = Number.parseInt(fechaIso.slice(0, 4), 10);
  if (Number.isNaN(anio)) {
    throw new Error(`Fecha ISO invalida: "${fechaIso}"`);
  }
  return anio;
}

/** Meses transcurridos entre dos fechas ISO. Aproximacion por año y mes. */
export function mesesEntre(desdeIso: string, hastaIso: string): number {
  const a1 = anioDe(desdeIso);
  const m1 = Number.parseInt(desdeIso.slice(5, 7), 10) || 1;
  const a2 = anioDe(hastaIso);
  const m2 = Number.parseInt(hastaIso.slice(5, 7), 10) || 1;
  return (a2 - a1) * 12 + (m2 - m1);
}
