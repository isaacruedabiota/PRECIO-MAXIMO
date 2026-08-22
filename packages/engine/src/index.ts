/**
 * @vp/engine - motor de precio maximo.
 *
 * Reglas de este paquete, sin excepciones:
 *   1. Funcion pura. Cero I/O: ni fetch, ni fs, ni base de datos.
 *   2. Cero Date.now(): la fecha de calculo entra como parametro.
 *   3. Cero numeros de negocio en el codigo: todos vienen de la config.
 *   4. Todo numero de salida es un TrazedValue con fuente, fecha y metodo.
 *
 * Es lo que permite testear el motor de verdad, que es donde se juega el
 * proyecto: si el motor esta mal, lo demas da igual.
 */

import { leerValor } from '@vp/config/values';

export * from './types';
export * from './errors';
export { peorConfianza, traza } from './trace';
export { cuotaFrances, capitalDesdeCuota, mayorQueCumple } from './math/finance';
export { baseImponibleITP, calcularGastosCompra, resolverTipoITP } from './costs/gastos-compra';
export type { DesgloseGastos } from './costs/gastos-compra';
export { arancelEscalado } from './costs/arancel';
export { calcularT1 } from './ceilings/t1-mercado';
export { calcularT2 } from './ceilings/t2-financiero';
export { calcularT3 } from './ceilings/t3-reforma';
export { detectarBloqueantes } from './risk/blockers';
export { calcularDescuentos } from './risk/discounts';
export { resolverSuperficie } from './superficie';

import { construirArgumentario } from './argumentario';
import { calcularT1 } from './ceilings/t1-mercado';
import { calcularT2 } from './ceilings/t2-financiero';
import { calcularT3 } from './ceilings/t3-reforma';
import { NotImplementedError } from './errors';
import { detectarBloqueantes } from './risk/blockers';
import { calcularDescuentos } from './risk/discounts';
import { resolverSuperficie } from './superficie';
import { aviso, peorConfianza, traza } from './trace';
import type {
  Aviso,
  CalcInput,
  Confianza,
  MaxPriceResult,
  NivelAviso,
  Techo,
  TechoId,
  TrazedValue,
} from './types';

export const VERSION_MOTOR = '0.1.0-fase1';

const ORDEN_TECHOS: readonly TechoId[] = ['T1', 'T2', 'T3', 'T4'];

/**
 * PRECIO_MAXIMO = min(T1, T2, T3, T4) - suma(descuentos de riesgo)
 *
 * T3 solo aplica si hay reforma prevista.
 * T4 solo aplica en modo inversor.
 * Los bloqueantes no descuentan: paran el calculo.
 */
export function calcularPrecioMaximo(input: CalcInput): MaxPriceResult {
  const { fecha_calculo, property, riesgos, buyer, market, config, reforma } = input;
  const avisos: Aviso[] = [];

  const disclaimer = config.negociacion.disclaimer.texto;

  // -------------------------------------------------------------------------
  // 1. Bloqueantes. Si hay alguno, no se devuelve ningun numero.
  // -------------------------------------------------------------------------
  const { bloqueantes, avisos: avisosBloqueantes } = detectarBloqueantes(property, riesgos, config);
  avisos.push(...avisosBloqueantes);

  if (bloqueantes.length > 0) {
    return {
      fecha_calculo,
      version_motor: VERSION_MOTOR,
      version_config: config.version,
      bloqueantes,
      techos: techosDetenidos(),
      techo_limitante: null,
      minimo_techos: null,
      descuentos_riesgo: [],
      precio_maximo: null,
      precio_entrada_negociacion: null,
      comparativa_precio_pedido: null,
      metricas_inversion: null,
      argumentario: [],
      avisos: ordenarAvisos(avisos),
      confianza_global: 'baja',
      disclaimer,
    };
  }

  // -------------------------------------------------------------------------
  // 2. Superficie util
  // -------------------------------------------------------------------------
  const { resuelta: superficie, avisos: avisosSuperficie } = resolverSuperficie(
    property.superficie,
    config.coeficientes,
    fecha_calculo,
  );
  avisos.push(...avisosSuperficie);

  // -------------------------------------------------------------------------
  // 3. T1 - mercado
  // -------------------------------------------------------------------------
  const r1 = calcularT1({ fecha_calculo, property, market, config, superficie });

  // -------------------------------------------------------------------------
  // 4. T2 - financiero-fiscal
  // -------------------------------------------------------------------------
  const r2 = calcularT2({ fecha_calculo, property, buyer, config });

  // -------------------------------------------------------------------------
  // 5. T3 - reforma
  // -------------------------------------------------------------------------
  const m2 = superficie.m2_utiles.valor;
  let valorReformado: TrazedValue;
  let arvDerivado: boolean;

  if (market.arv_eur_m2 !== null) {
    valorReformado = traza({
      valor: market.arv_eur_m2 * m2,
      fuente: 'dato de mercado de vivienda reformada',
      fecha_dato: market.precio_m2.fecha_dato,
      metodo: `${market.arv_eur_m2} EUR/m2 x ${m2.toFixed(1)} m2 utiles`,
      confianza: 'media',
      unidad: 'EUR',
    });
    arvDerivado = false;
  } else {
    const rArv = calcularT1({
      fecha_calculo,
      property,
      market,
      config,
      superficie,
      estadoOverride: 'reformado_reciente',
    });
    valorReformado = traza({
      valor: rArv.valorTotal,
      fuente: 'derivado de T1',
      fecha_dato: market.precio_m2.fecha_dato,
      metodo: 'mismo calculo de T1 con el coeficiente de "reformado reciente"',
      confianza: peorConfianza(rArv.confianza, 'media'),
      unidad: 'EUR',
    });
    arvDerivado = true;
  }

  const r3 = calcularT3({
    fecha_calculo,
    property,
    config,
    superficie,
    reforma,
    valorReformado,
    arvDerivado,
  });

  if (reforma === null && property.estado_conservacion === 'a_reformar') {
    avisos.push(
      aviso(
        'atencion',
        'REFORMA_NO_DESCRITA',
        'El inmueble esta a reformar pero no se ha descrito la reforma',
        'Sin nivel de reforma previsto no se puede calcular el techo de reforma, que en un piso a reformar ' +
          'suele ser el que manda. El resultado se queda corto de informacion.',
      ),
    );
  }

  // -------------------------------------------------------------------------
  // 6. T4 - rentabilidad
  // -------------------------------------------------------------------------
  if (buyer.objetivo !== 'residencia') {
    // Devolver un precio maximo ignorando un techo que podria ser el que manda
    // seria peor que no devolver nada.
    throw new NotImplementedError(
      `El modo "${buyer.objetivo}" necesita T4 (techo de rentabilidad), que llega en la segunda entrega ` +
        'de la Fase 1',
    );
  }

  const techos: Record<TechoId, Techo> = {
    T1: r1.techo,
    T2: r2.techo,
    T3: r3.techo,
    T4: {
      id: 'T4',
      nombre: 'Techo de rentabilidad',
      aplica: false,
      motivo_no_aplica: 'Solo aplica en modo inversor. El objetivo declarado es residencia.',
      valor: null,
      rango: null,
      desglose: [],
      avisos: [],
    },
  };

  for (const id of ORDEN_TECHOS) avisos.push(...techos[id].avisos);

  // -------------------------------------------------------------------------
  // 7. Minimo de los techos
  // -------------------------------------------------------------------------
  const aplicables = ORDEN_TECHOS.map((id) => techos[id]).filter(
    (t): t is Techo & { valor: TrazedValue } => t.aplica && t.valor !== null,
  );

  if (aplicables.length === 0) {
    avisos.push(
      aviso(
        'critico',
        'SIN_TECHO_CALCULABLE',
        'No se ha podido calcular ningun techo',
        'Revisa los avisos anteriores: sin al menos un techo no hay precio maximo que dar.',
      ),
    );
    return {
      fecha_calculo,
      version_motor: VERSION_MOTOR,
      version_config: config.version,
      bloqueantes: [],
      techos,
      techo_limitante: null,
      minimo_techos: null,
      descuentos_riesgo: [],
      precio_maximo: null,
      precio_entrada_negociacion: null,
      comparativa_precio_pedido: null,
      metricas_inversion: null,
      argumentario: [],
      avisos: ordenarAvisos(avisos),
      confianza_global: 'baja',
      disclaimer,
    };
  }

  const limitante = aplicables.reduce((a, b) => (b.valor.valor < a.valor.valor ? b : a));
  const minimo = limitante.valor.valor;

  // -------------------------------------------------------------------------
  // 8. Descuentos por riesgo
  // -------------------------------------------------------------------------
  const { descuentos, avisos: avisosRiesgo } = calcularDescuentos(riesgos, config, fecha_calculo, minimo);
  avisos.push(...avisosRiesgo);

  const totalDescuentos = descuentos.reduce((suma, d) => suma + d.importe.valor, 0);
  const precioMaximoBruto = minimo - totalDescuentos;
  const precioMaximo = Math.max(0, precioMaximoBruto);

  if (precioMaximoBruto <= 0) {
    avisos.push(
      aviso(
        'critico',
        'DESCUENTOS_SUPERAN_TECHO',
        'Los riesgos se comen el valor entero del inmueble',
        `El menor de los techos es ${minimo.toFixed(0)} EUR y los descuentos por riesgo suman ` +
          `${totalDescuentos.toFixed(0)} EUR. Con estas cargas, la operacion no tiene precio de compra que la salve.`,
      ),
    );
  }

  // -------------------------------------------------------------------------
  // 8 bis. El valor de referencia catastral, contrastado con el precio que de
  // verdad se va a ofrecer.
  //
  // T2 comprueba esto contra SU propio techo, que suele ser mucho mas alto que
  // el precio final. Lo que importa al comprador es lo que pasa al precio que
  // va a poner sobre la mesa: si el valor de referencia lo supera, pagara
  // impuesto sobre una cifra superior a la que paga, y bajar mas el precio ya
  // no reduce el impuesto.
  // -------------------------------------------------------------------------
  const valorReferencia = property.valor_referencia_catastral;
  if (valorReferencia !== null && valorReferencia > precioMaximo && !property.es_obra_nueva) {
    // Se sustituye el aviso que pudiera haber emitido T2 sobre su propio techo:
    // dos mensajes con el mismo codigo y cifras distintas solo confunden.
    for (let i = avisos.length - 1; i >= 0; i -= 1) {
      if (avisos[i]?.codigo === 'VALOR_REFERENCIA_MANDA') avisos.splice(i, 1);
    }

    const tipo = r2.gastos?.tipo_aplicado ?? 0;
    const exceso = valorReferencia - precioMaximo;

    avisos.push(
      aviso(
        'critico',
        'VALOR_REFERENCIA_MANDA',
        'Pagaras impuesto sobre el valor de referencia, no sobre lo que pagas',
        `Tu precio maximo es ${precioMaximo.toFixed(0)} EUR, pero el valor de referencia del Catastro es ` +
          `${valorReferencia.toFixed(0)} EUR. La base imponible del impuesto es la mayor de las dos, asi que ` +
          `tributarias sobre ${exceso.toFixed(0)} EUR que no has pagado: ` +
          `${(exceso * tipo).toFixed(0)} EUR de impuesto de mas. Y ojo, bajar mas el precio negociado no ` +
          'reduce el impuesto, solo aumenta esa diferencia.',
        'Ley 11/2021, art. 10 del texto refundido del ITPAJD',
      ),
    );
  }

  // -------------------------------------------------------------------------
  // 9. Precio de entrada en negociacion y comparativa
  // -------------------------------------------------------------------------
  const factorMin = leerValor(config.negociacion.precio_entrada.factor_min, 'negociacion.precio_entrada.factor_min');
  const factorMax = leerValor(config.negociacion.precio_entrada.factor_max, 'negociacion.precio_entrada.factor_max');

  const umbralBajo = leerValor(
    config.negociacion.veredicto_precio_pedido.umbral_por_debajo_de_mercado,
    'negociacion.veredicto_precio_pedido.umbral_por_debajo_de_mercado',
  );
  const umbralAlto = leerValor(
    config.negociacion.veredicto_precio_pedido.umbral_sobrevalorado,
    'negociacion.veredicto_precio_pedido.umbral_sobrevalorado',
  );

  const diferencia = property.precio_pedido - precioMaximo;
  const diferenciaPct = precioMaximo === 0 ? 0 : diferencia / precioMaximo;

  const confianzaGlobal: Confianza = peorConfianza(...aplicables.map((t) => t.valor.confianza));

  return {
    fecha_calculo,
    version_motor: VERSION_MOTOR,
    version_config: config.version,
    bloqueantes: [],
    techos,
    techo_limitante: limitante.id,
    minimo_techos: traza({
      valor: minimo,
      fuente: `${limitante.nombre} (${limitante.id})`,
      fecha_dato: limitante.valor.fecha_dato,
      metodo: `minimo de los techos aplicables: ${aplicables.map((t) => t.id).join(', ')}`,
      confianza: limitante.valor.confianza,
      unidad: 'EUR',
    }),
    descuentos_riesgo: descuentos,
    precio_maximo: traza({
      valor: precioMaximo,
      fuente: `${limitante.id} menos descuentos por riesgo`,
      fecha_dato: fecha_calculo,
      metodo: `${minimo.toFixed(0)} - ${totalDescuentos.toFixed(0)} de descuentos`,
      confianza: confianzaGlobal,
      unidad: 'EUR',
      notas: [`Manda ${limitante.nombre.toLowerCase()}.`],
    }),
    precio_entrada_negociacion: {
      min: Math.round(precioMaximo * factorMin),
      max: Math.round(precioMaximo * factorMax),
    },
    comparativa_precio_pedido: {
      precio_pedido: property.precio_pedido,
      diferencia_eur: Math.round(diferencia * 100) / 100,
      diferencia_pct: Math.round(diferenciaPct * 10000) / 10000,
      veredicto:
        diferenciaPct <= umbralBajo
          ? 'por_debajo_de_mercado'
          : diferenciaPct >= umbralAlto
            ? 'sobrevalorado'
            : 'en_precio',
    },
    metricas_inversion: null,
    argumentario: construirArgumentario({
      fecha_calculo,
      property,
      techos,
      techoLimitante: limitante.id,
      coeficientesT1: r1.coeficientes,
      valorViviendaT1: r1.valorVivienda,
      descuentos,
      precioMaximo,
    }),
    avisos: ordenarAvisos(avisos),
    confianza_global: confianzaGlobal,
    disclaimer,
  };
}

// ---------------------------------------------------------------------------

const PESO_AVISO: Record<NivelAviso, number> = { critico: 0, atencion: 1, info: 2 };

/** Lo critico primero. Un aviso importante enterrado bajo diez informativos no se lee. */
function ordenarAvisos(avisos: readonly Aviso[]): Aviso[] {
  return [...avisos].sort((a, b) => PESO_AVISO[a.nivel] - PESO_AVISO[b.nivel]);
}

function techosDetenidos(): Record<TechoId, Techo> {
  const detenido = (id: TechoId, nombre: string): Techo => ({
    id,
    nombre,
    aplica: false,
    motivo_no_aplica: 'Calculo detenido por un bloqueante.',
    valor: null,
    rango: null,
    desglose: [],
    avisos: [],
  });

  return {
    T1: detenido('T1', 'Techo de mercado'),
    T2: detenido('T2', 'Techo financiero-fiscal'),
    T3: detenido('T3', 'Techo de reforma'),
    T4: detenido('T4', 'Techo de rentabilidad'),
  };
}
