import type { Coeficiente } from './ceilings/t1-mercado';
import { traza } from './trace';
import type {
  DescuentoRiesgo,
  PropertyInput,
  PuntoArgumentario,
  Techo,
  TechoId,
  TrazedValue,
} from './types';

/**
 * Argumentario de negociacion.
 *
 * Traduce el calculo a frases que se pueden decir en voz alta delante del
 * vendedor, cada una con las cifras que la respaldan. Un descuento sin
 * justificacion es una rebaja pedida; el mismo descuento con la fuente y la
 * fecha delante es un argumento.
 */

export interface ParametrosArgumentario {
  fecha_calculo: string;
  property: PropertyInput;
  techos: Readonly<Record<TechoId, Techo>>;
  techoLimitante: TechoId | null;
  coeficientesT1: readonly Coeficiente[];
  valorViviendaT1: number;
  descuentos: readonly DescuentoRiesgo[];
  precioMaximo: number;
}

export function construirArgumentario(p: ParametrosArgumentario): PuntoArgumentario[] {
  const puntos: PuntoArgumentario[] = [];
  const t1 = p.techos.T1;

  // -------------------------------------------------------------------------
  // El precio de mercado de la zona, con su fuente
  // -------------------------------------------------------------------------
  if (t1.valor !== null) {
    const respaldo: TrazedValue[] = [t1.valor];
    const eurM2 = t1.desglose.find((l) => l.concepto === 'EUR/m2 homogeneizado');
    if (eurM2 !== undefined) respaldo.push(eurM2.valor);

    puntos.push({
      titular: `El valor de mercado comparable es de ${formatearEur(t1.valor.valor)}`,
      detalle:
        `Calculado sobre ${t1.valor.fuente}, dato de ${t1.valor.fecha_dato}, homogeneizado por las ` +
        `caracteristicas concretas del piso. Confianza ${t1.valor.confianza}.` +
        (t1.rango !== null
          ? ` La horquilla de la zona va de ${formatearEur(t1.rango.min)} a ${formatearEur(t1.rango.max)}.`
          : ''),
      respaldo,
      impacto_eur: null,
    });
  }

  // -------------------------------------------------------------------------
  // Cada coeficiente que penaliza es un argumento
  // -------------------------------------------------------------------------
  for (const c of p.coeficientesT1) {
    if (c.valor >= 1) continue;

    // Lo que resta esa caracteristica frente a un piso identico que no la tenga.
    const impacto = (p.valorViviendaT1 * (1 - c.valor)) / c.valor;

    puntos.push({
      titular: `${mayuscula(c.nombre)}: ${formatearEur(impacto)} menos que un comparable sin esa pega`,
      detalle: `${c.explicacion}. Coeficiente aplicado: ${c.valor}.`,
      respaldo: [
        traza({
          valor: c.valor,
          fuente: 'config/coeficientes.json',
          fecha_dato: p.fecha_calculo,
          metodo: c.explicacion,
          confianza: 'media',
          unidad: 'coeficiente',
        }),
      ],
      impacto_eur: Math.round(impacto * 100) / 100,
    });
  }

  // -------------------------------------------------------------------------
  // Los descuentos por riesgo, que son los argumentos mas duros
  // -------------------------------------------------------------------------
  for (const d of p.descuentos) {
    puntos.push({
      titular: `${d.concepto}: ${formatearEur(d.importe.valor)}`,
      detalle: d.justificacion,
      respaldo: [d.importe],
      impacto_eur: d.importe.valor,
    });
  }

  // -------------------------------------------------------------------------
  // Que techo manda, y por que
  // -------------------------------------------------------------------------
  if (p.techoLimitante !== null) {
    const techo = p.techos[p.techoLimitante];
    if (techo.valor !== null) {
      puntos.push({
        titular: `El limite lo pone ${techo.nombre.toLowerCase()}: ${formatearEur(techo.valor.valor)}`,
        detalle: explicarLimitante(p.techoLimitante, techo),
        respaldo: [techo.valor],
        impacto_eur: null,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Comparacion con lo que pide el vendedor
  // -------------------------------------------------------------------------
  const diferencia = p.property.precio_pedido - p.precioMaximo;
  if (diferencia > 0) {
    puntos.push({
      titular: `Pide ${formatearEur(diferencia)} por encima de tu maximo`,
      detalle:
        `El precio publicado es ${formatearEur(p.property.precio_pedido)} y tu techo esta en ` +
        `${formatearEur(p.precioMaximo)}, un ${((diferencia / p.precioMaximo) * 100).toFixed(1)}% menos.` +
        (p.property.dias_publicado !== null && p.property.dias_publicado > 90
          ? ` Lleva ${p.property.dias_publicado} dias publicado, lo que suele indicar que el precio esta por encima de mercado.`
          : ''),
      respaldo: [],
      impacto_eur: -diferencia,
    });
  }

  return puntos;
}

function explicarLimitante(id: TechoId, techo: Techo): string {
  switch (id) {
    case 'T1':
      return (
        'Es el mercado el que marca el limite, no tu bolsillo: por encima de esa cifra estarias pagando ' +
        'mas de lo que vale un piso comparable en la zona. ' + (techo.valor?.notas?.join(' ') ?? '')
      );
    case 'T2':
      return (
        'El limite es financiero, no de mercado: el piso podria valer mas, pero tu ahorro y tu capacidad ' +
        'de pago no dan para mas con todos los impuestos y gastos dentro. ' +
        (techo.valor?.notas?.join(' ') ?? '')
      );
    case 'T3':
      return (
        'Manda la reforma: lo que pagues por la compra mas lo que cueste la obra tiene que caber por ' +
        'debajo del valor que tendra el piso ya reformado, con margen de seguridad.'
      );
    case 'T4':
      return (
        'Manda la rentabilidad: por encima de esa cifra la operacion deja de dar el retorno que te has ' +
        'marcado, aunque el piso valga mas y aunque puedas pagarlo. ' + (techo.valor?.notas?.join(' ') ?? '')
      );
  }
}

function formatearEur(n: number): string {
  return `${Math.round(n).toLocaleString('es-ES')} EUR`;
}

function mayuscula(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
