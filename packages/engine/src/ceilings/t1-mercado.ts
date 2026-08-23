import type { CoeficientesConfig, EngineConfig } from '@vp/config/schemas';
import { leerValor } from '@vp/config/values';

import { factorAUtil } from '../superficie';
import { anioDe, aviso, linea, mesesEntre, peorConfianza, traza } from '../trace';
import type {
  Aviso,
  Confianza,
  DesgloseLinea,
  EstadoConservacion,
  MarketData,
  PropertyInput,
  SuperficieResuelta,
  Techo,
} from '../types';

/**
 * T1 - Techo de mercado.
 *
 * Responde a "cuanto se esta pagando realmente por pisos comparables". Cuatro
 * pasos: precio base de la zona, actualizacion temporal con el IPV,
 * homogeneizacion por las caracteristicas del inmueble, y superficie.
 */

export interface ContextoT1 {
  fecha_calculo: string;
  property: PropertyInput;
  market: MarketData;
  config: EngineConfig;
  superficie: SuperficieResuelta;
  /**
   * Sobrescribe el estado de conservacion. Lo usa T3 para obtener el ARV
   * (valor una vez reformado) reutilizando exactamente la misma metodologia.
   */
  estadoOverride?: EstadoConservacion;
}

export interface Coeficiente {
  nombre: string;
  valor: number;
  explicacion: string;
}

export interface ResultadoT1 {
  techo: Techo;
  /** EUR/m2 util ya homogeneizado. T3 lo necesita para derivar el ARV. */
  eurM2Homogeneizado: number;
  /** Valor del inmueble sin anexos. */
  valorVivienda: number;
  /** Valor del inmueble con anexos. Es el valor del techo. */
  valorTotal: number;
  confianza: Confianza;
  /** Coeficientes aplicados. El argumentario los convierte en puntos de negociacion. */
  coeficientes: readonly Coeficiente[];
}

export function calcularT1(ctx: ContextoT1): ResultadoT1 {
  const { fecha_calculo, property, market, config, superficie } = ctx;
  const coef = config.coeficientes;
  const avisos: Aviso[] = [];
  const desglose: DesgloseLinea[] = [];

  const m2Utiles = superficie.m2_utiles.valor;
  const ref = market.precio_m2;

  // -------------------------------------------------------------------------
  // Paso 1: precio base EUR/m2, convertido a superficie util si hace falta
  // -------------------------------------------------------------------------
  let eurM2 = ref.eur_m2;

  const conversionBase = factorAUtil(ref.base_superficie, coef);
  if (conversionBase !== null) {
    // El EUR/m2 de la fuente se refiere a metros construidos. Para el mismo
    // importe total hay menos metros utiles, luego el EUR/m2 util es mayor.
    eurM2 = eurM2 / conversionBase.factor;
    avisos.push(
      aviso(
        'info',
        'PRECIO_BASE_CONVERTIDO',
        `El precio de referencia venia en superficie ${ref.base_superficie.replace(/_/g, ' ')}`,
        `${ref.eur_m2.toFixed(0)} EUR/m2 se han convertido a ${eurM2.toFixed(0)} EUR/m2 util dividiendo ` +
          `por ${conversionBase.factor} (${conversionBase.ruta}).`,
      ),
    );
  }

  desglose.push(
    linea(
      'Precio base de la zona',
      traza({
        valor: eurM2,
        fuente: `${ref.fuente} (${ref.ambito})`,
        fecha_dato: ref.fecha_dato,
        metodo:
          conversionBase !== null ? 'convertido a superficie util' : 'dato de superficie util',
        confianza: 'alta',
        unidad: 'EUR/m2',
      }),
    ),
  );

  // -------------------------------------------------------------------------
  // Paso 2: actualizacion temporal con el IPV del INE
  // -------------------------------------------------------------------------
  if (market.ipv === null) {
    avisos.push(
      aviso(
        'atencion',
        'SIN_ACTUALIZACION_IPV',
        'El precio base no se ha actualizado a fecha de hoy',
        `El dato de ${ref.fuente} es de ${ref.fecha_dato} y no hay variacion del IPV disponible para ` +
          `${property.localizacion.ccaa}. El precio de partida puede estar desfasado varios trimestres.`,
      ),
    );
  } else {
    const antes = eurM2;
    eurM2 = eurM2 * (1 + market.ipv.variacion_acumulada);
    desglose.push(
      linea(
        'Actualizacion IPV',
        traza({
          valor: eurM2,
          fuente: `INE IPV ${market.ipv.ccaa} (tabla ${market.ipv.id_tabla_ine})`,
          fecha_dato: market.ipv.hasta,
          metodo: `${antes.toFixed(0)} x (1 + ${market.ipv.variacion_acumulada})`,
          confianza: 'alta',
          unidad: 'EUR/m2',
        }),
        `${antes.toFixed(2)} x (1 + ${market.ipv.variacion_acumulada}) desde ${market.ipv.desde}`,
      ),
    );
  }

  // Cuando la superficie declarada y la base del precio son del mismo tipo, el
  // factor de conversion se cancela: multiplica los metros y divide el EUR/m2
  // en la misma proporcion. Solo importa cuando difieren, y entonces lo que
  // manda no es cada factor sino la razon entre los dos.
  if (property.superficie.tipo !== ref.base_superficie) {
    avisos.push(
      aviso(
        'atencion',
        'CONVERSION_SUPERFICIE_ASIMETRICA',
        'La superficie del piso y la del precio de referencia son de tipos distintos',
        `Has dado la superficie como "${property.superficie.tipo.replace(/_/g, ' ')}" y el precio de ` +
          `referencia va sobre "${ref.base_superficie.replace(/_/g, ' ')}". Eso obliga a usar dos factores ` +
          'de conversion distintos, y ninguno de los dos esta contrastado, asi que su cociente entra ' +
          'directo en el resultado. Si puedes, da la superficie en la misma base que el precio: entonces ' +
          'el factor se cancela y deja de importar.',
      ),
    );
  }

  const eurM2Actualizado = eurM2;

  // -------------------------------------------------------------------------
  // Paso 3: homogeneizacion
  // -------------------------------------------------------------------------
  const coeficientes = construirCoeficientes(ctx, coef, avisos);

  let producto = 1;
  for (const c of coeficientes) {
    producto *= c.valor;
    desglose.push(
      linea(
        `Coeficiente: ${c.nombre}`,
        traza({
          valor: c.valor,
          fuente: 'config/coeficientes.json',
          fecha_dato: fecha_calculo,
          metodo: c.explicacion,
          confianza: 'media',
          unidad: 'coeficiente',
        }),
      ),
    );
  }

  const topeMin = leerValor(coef.limites.coeficiente_global_min, 'coeficientes.limites.coeficiente_global_min');
  const topeMax = leerValor(coef.limites.coeficiente_global_max, 'coeficientes.limites.coeficiente_global_max');
  const productoSinTope = producto;
  producto = Math.min(Math.max(producto, topeMin), topeMax);

  if (producto !== productoSinTope) {
    avisos.push(
      aviso(
        'atencion',
        'COEFICIENTE_GLOBAL_TOPADO',
        'La acumulacion de coeficientes ha tocado el tope',
        `El producto de los coeficientes daba ${productoSinTope.toFixed(4)} y se ha limitado a ` +
          `${producto.toFixed(4)}. Cuando esto pasa suele ser senal de que el inmueble se aleja tanto ` +
          'del comparable medio de la zona que la homogeneizacion deja de ser fiable.',
      ),
    );
  }

  const eurM2Homogeneizado = eurM2Actualizado * producto;
  const valorVivienda = eurM2Homogeneizado * m2Utiles;

  desglose.push(
    linea(
      'EUR/m2 homogeneizado',
      traza({
        valor: eurM2Homogeneizado,
        fuente: `${ref.fuente} homogeneizado`,
        fecha_dato: ref.fecha_dato,
        metodo: `${eurM2Actualizado.toFixed(2)} x ${producto.toFixed(4)}`,
        confianza: 'media',
        unidad: 'EUR/m2',
      }),
    ),
  );

  // -------------------------------------------------------------------------
  // Paso 4: anexos, en valor absoluto
  // -------------------------------------------------------------------------
  const { total: totalAnexos, lineas: lineasAnexos } = valorarAnexos(ctx, coef, avisos);
  desglose.push(...lineasAnexos);

  const valorTotal = valorVivienda + totalAnexos;

  // -------------------------------------------------------------------------
  // Confianza
  // -------------------------------------------------------------------------
  const confianza = calcularConfianza(ctx, coef, avisos);

  const rango = calcularRango(ref, eurM2Homogeneizado, m2Utiles, totalAnexos);

  return {
    techo: {
      id: 'T1',
      nombre: 'Techo de mercado',
      aplica: true,
      motivo_no_aplica: null,
      valor: traza({
        valor: valorTotal,
        fuente: `${ref.fuente} (${ref.ambito})`,
        fecha_dato: ref.fecha_dato,
        metodo: 'comparacion homogeneizada',
        confianza,
        unidad: 'EUR',
        notas:
          ref.n_transacciones !== null
            ? [`Sustentado en ${ref.n_transacciones} transacciones.`]
            : ['La fuente no informa del numero de transacciones que sustentan el dato.'],
      }),
      rango,
      desglose,
      avisos,
    },
    eurM2Homogeneizado,
    valorVivienda,
    valorTotal,
    confianza,
    coeficientes,
  };
}

// ---------------------------------------------------------------------------

function construirCoeficientes(
  ctx: ContextoT1,
  coef: CoeficientesConfig,
  avisos: Aviso[],
): Coeficiente[] {
  const { property, market, superficie } = ctx;
  const estado = ctx.estadoOverride ?? property.estado_conservacion;
  const lista: Coeficiente[] = [];

  // Estado de conservacion
  lista.push({
    nombre: `estado ${estado}`,
    valor: leerValor(coef.estado_conservacion[estado], `coeficientes.estado_conservacion.${estado}`),
    explicacion: `Estado de conservacion: ${estado}`,
  });

  // Planta
  const clavePlanta = claveDePlanta(property);
  lista.push({
    nombre: `planta ${clavePlanta}`,
    valor: leerValor(coef.planta[clavePlanta], `coeficientes.planta.${clavePlanta}`),
    explicacion: `Planta ${property.planta.numero}${property.planta.es_atico ? ' (atico)' : ''}`,
  });

  // Ascensor: solo penaliza su ausencia, y de forma progresiva por planta
  if (!property.ascensor) {
    const claveAscensor = claveDeSinAscensor(property.planta.numero);
    lista.push({
      nombre: `sin ascensor, ${claveAscensor}`,
      valor: leerValor(coef.sin_ascensor[claveAscensor], `coeficientes.sin_ascensor.${claveAscensor}`),
      explicacion: `Edificio sin ascensor, planta ${property.planta.numero}`,
    });
  }

  // Exterior / interior
  lista.push({
    nombre: property.situacion,
    valor: leerValor(coef.situacion[property.situacion], `coeficientes.situacion.${property.situacion}`),
    explicacion: `Vivienda ${property.situacion}`,
  });

  // Orientacion
  lista.push({
    nombre: `orientacion ${property.orientacion}`,
    valor: leerValor(
      coef.orientacion[property.orientacion],
      `coeficientes.orientacion.${property.orientacion}`,
    ),
    explicacion: `Orientacion ${property.orientacion}`,
  });

  // Certificado energetico
  const claveCee =
    property.certificado_energetico.estado === 'registrado'
      ? property.certificado_energetico.letra_consumo
      : 'no_disponible';
  lista.push({
    nombre: `CEE ${claveCee}`,
    valor: leerValor(coef.certificado_energetico[claveCee], `coeficientes.certificado_energetico.${claveCee}`),
    explicacion: `Certificado energetico ${claveCee}`,
  });

  // Antiguedad
  const antiguedad = coeficienteAntiguedad(ctx, coef, avisos);
  if (antiguedad !== null) lista.push(antiguedad);

  // Superficie atipica: penaliza por menor liquidez, no por menor valor unitario
  if (market.superficie_p90_zona_m2 !== null && superficie.m2_utiles.valor > market.superficie_p90_zona_m2) {
    lista.push({
      nombre: 'superficie atipica',
      valor: leerValor(coef.superficie.atipica_sobre_p90, 'coeficientes.superficie.atipica_sobre_p90'),
      explicacion:
        `${superficie.m2_utiles.valor.toFixed(0)} m2 utiles supera el P90 de la zona ` +
        `(${market.superficie_p90_zona_m2} m2): menos compradores potenciales, menos liquidez`,
    });
  }

  return lista;
}

function claveDePlanta(property: PropertyInput): 'bajo' | 'primera_segunda' | 'intermedia' | 'atico' {
  if (property.planta.es_bajo || property.planta.numero <= 0) return 'bajo';
  if (property.planta.es_atico) return 'atico';
  if (property.planta.numero <= 2) return 'primera_segunda';
  return 'intermedia';
}

function claveDeSinAscensor(planta: number): 'planta_0_2' | 'planta_3' | 'planta_4' | 'planta_5_o_mas' {
  if (planta <= 2) return 'planta_0_2';
  if (planta === 3) return 'planta_3';
  if (planta === 4) return 'planta_4';
  return 'planta_5_o_mas';
}

/**
 * Depreciacion por vida util residual (metodologia del art. 18 ECO/805/2003),
 * calculada de forma RELATIVA a la antiguedad de referencia de la zona.
 *
 * El motivo es un riesgo real de doble conteo: el EUR/m2 de la zona ya incorpora
 * la antiguedad media de su parque. Depreciar en absoluto sobre esa base penaliza
 * dos veces al inmueble viejo. Con edad_referencia_zona_anios = 0 el resultado
 * coincide con la depreciacion absoluta del brief, y se emite aviso.
 */
function coeficienteAntiguedad(
  ctx: ContextoT1,
  coef: CoeficientesConfig,
  avisos: Aviso[],
): Coeficiente | null {
  const { property, fecha_calculo } = ctx;
  const anioRef = property.anio_rehabilitacion ?? property.anio_construccion;

  if (anioRef === null) {
    avisos.push(
      aviso(
        'atencion',
        'SIN_ANIO_CONSTRUCCION',
        'No hay ano de construccion',
        'Sin ano de construccion no se puede aplicar depreciacion por antiguedad. El techo de mercado ' +
          'puede estar sobrevalorado si el edificio es antiguo. El Catastro lo publica: merece la pena buscarlo.',
      ),
    );
    return null;
  }

  const edad = Math.max(0, anioDe(fecha_calculo) - anioRef);
  const vidaUtil = leerValor(coef.antiguedad.vida_util_total_anios, 'coeficientes.antiguedad.vida_util_total_anios');

  // La antiguedad del parque describe la zona, asi que el dato de mercado manda
  // sobre el respaldo global de config.
  const delMercado = ctx.market.antiguedad_parque;
  const edadReferencia =
    delMercado !== null
      ? delMercado.edad_media_anios
      : leerValor(
          coef.antiguedad.edad_referencia_zona_anios,
          'coeficientes.antiguedad.edad_referencia_zona_anios',
        );
  const minimo = leerValor(coef.antiguedad.coeficiente_minimo, 'coeficientes.antiguedad.coeficiente_minimo');

  const residualInmueble = Math.max(0, 1 - edad / vidaUtil);
  const residualReferencia = Math.max(0.01, 1 - edadReferencia / vidaUtil);

  const sinTopar = residualInmueble / residualReferencia;
  let valor = Math.max(sinTopar, minimo);

  // Techo opcional. El coeficiente relativo es simetrico: si el piso es MAS
  // NUEVO que la media del parque sale por encima de 1, y sin tope ese premio
  // no lo limita nada. Con un parque de 44,8 anos y vida util de 100, una obra
  // nueva se llevaria un +81%, y lo unico que lo frenaria seria el tope global,
  // que es justo lo que ADR-013 dice que no debe hacer el trabajo del modelo.
  //
  // Se deja a null (sin tope) por defecto para no cambiar el resultado hasta
  // que se fije un valor contrastado. Aun asi se avisa cuando el premio es
  // grande, porque mueve T1 tanto como una penalizacion.
  const maximoConfigurado = coef.antiguedad.coeficiente_maximo;
  const maximo =
    maximoConfigurado === undefined || maximoConfigurado.valor === null
      ? null
      : maximoConfigurado.valor;
  if (maximo !== null && valor > maximo) {
    avisos.push(
      aviso(
        'atencion',
        'ANTIGUEDAD_PREMIO_TOPADO',
        'El premio por ser mas nuevo que la zona se ha topado',
        `El inmueble tiene ${edad} anos frente a los ${edadReferencia.toFixed(1)} de media del parque, ` +
          `lo que daria un coeficiente de ${sinTopar.toFixed(4)}. Se ha limitado a ${maximo} ` +
          '(coeficientes.antiguedad.coeficiente_maximo).',
      ),
    );
    valor = maximo;
  } else if (maximo === null && valor > 1.15) {
    avisos.push(
      aviso(
        'atencion',
        'ANTIGUEDAD_PREMIO_SIN_TOPE',
        'El inmueble es bastante mas nuevo que la media de la zona, y ese premio no tiene tope',
        `Tiene ${edad} anos frente a los ${edadReferencia.toFixed(1)} de media del parque, asi que la ` +
          `depreciacion relativa le da un coeficiente de ${valor.toFixed(4)}: sube T1 un ` +
          `${((valor - 1) * 100).toFixed(0)}% sobre el precio de la zona. Es coherente con el modelo ` +
          '(el EUR/m2 de la zona describe un parque mas viejo), pero el modelo lineal de vida util ' +
          'premia de mas la obra reciente. Si el numero te parece alto, fija ' +
          'coeficientes.antiguedad.coeficiente_maximo.',
        'Metodologia del art. 18 de la Orden ECO/805/2003',
      ),
    );
  }

  if (edadReferencia === 0) {
    avisos.push(
      aviso(
        'critico',
        'ANTIGUEDAD_ABSOLUTA',
        'La depreciacion por antiguedad se esta aplicando contra obra nueva',
        'coeficientes.antiguedad.edad_referencia_zona_anios sigue en 0. Como el EUR/m2 de la zona ya ' +
          'refleja la antiguedad media de su parque, depreciar ademas contra obra nueva penaliza dos veces ' +
          'al inmueble antiguo. El analisis de sensibilidad (pnpm calibrate) situa este parametro como el ' +
          'que mas mueve el resultado, por encima del 70% del valor en pisos de los 70 y 80: mientras siga ' +
          'en 0, el numero que salga dice mas de este ajuste que del piso. Pon ahi la antiguedad media del ' +
          'parque de viviendas de la zona.',
        'Metodologia del art. 18 de la Orden ECO/805/2003',
      ),
    );
  }

  const explicaciones = [
    `${edad} anos sobre una vida util de ${vidaUtil}`,
    delMercado !== null
      ? `relativo a un parque de ${delMercado.edad_media_anios} anos de media (${delMercado.fuente})`
      : `relativo a una edad de referencia de ${edadReferencia} anos (config)`,
  ];

  // Penalizacion extra por instalaciones fuera de norma
  const corte = coef.antiguedad.anio_corte_instalaciones;
  if (
    property.anio_construccion !== null &&
    property.anio_construccion < corte &&
    property.anio_rehabilitacion === null
  ) {
    const extra = leerValor(
      coef.antiguedad.penalizacion_extra_pre_1980_sin_rehabilitar,
      'coeficientes.antiguedad.penalizacion_extra_pre_1980_sin_rehabilitar',
    );
    valor *= extra;
    explicaciones.push(`x ${extra} por edificio anterior a ${corte} sin rehabilitar (instalaciones fuera de norma)`);
    avisos.push(
      aviso(
        'atencion',
        'INSTALACIONES_ANTERIORES_A_NORMA',
        `Edificio de ${property.anio_construccion}, sin rehabilitacion registrada`,
        'Electricidad y fontaneria previsiblemente fuera de la normativa actual, y sin aislamiento termico. ' +
          'Cuentalo en el presupuesto de reforma y pide el acta de la ultima junta por si hay derramas previstas.',
      ),
    );
  }

  return { nombre: 'antiguedad', valor, explicacion: explicaciones.join(', ') };
}

function valorarAnexos(
  ctx: ContextoT1,
  coef: CoeficientesConfig,
  avisos: Aviso[],
): { total: number; lineas: DesgloseLinea[] } {
  const { property, market } = ctx;
  const anexos = property.anexos;
  const lineas: DesgloseLinea[] = [];

  const hayAnexos = anexos.plazas_garaje > 0 || anexos.trasteros > 0 || anexos.terraza_m2 > 0;
  if (!hayAnexos) return { total: 0, lineas };

  if (market.anexos === null) {
    avisos.push(
      aviso(
        'atencion',
        'ANEXOS_SIN_VALORAR',
        'Los anexos no se han valorado',
        'El inmueble tiene garaje, trastero o terraza, pero no hay precios de anexos para la zona. ' +
          'El techo de mercado se queda corto: anadelos a mano cuando tengas la referencia.',
      ),
    );
    return { total: 0, lineas };
  }

  const precios = market.anexos;
  let total = 0;

  if (anexos.plazas_garaje > 0 && precios.garaje_eur !== null) {
    const importe = anexos.plazas_garaje * precios.garaje_eur;
    total += importe;
    lineas.push(
      linea(
        'Garaje',
        traza({
          valor: importe,
          fuente: precios.fuente,
          fecha_dato: precios.fecha_dato,
          metodo: `${anexos.plazas_garaje} plazas x ${precios.garaje_eur} EUR`,
          confianza: 'media',
          unidad: 'EUR',
        }),
      ),
    );
  }

  if (anexos.trasteros > 0 && precios.trastero_eur !== null) {
    const importe = anexos.trasteros * precios.trastero_eur;
    total += importe;
    lineas.push(
      linea(
        'Trastero',
        traza({
          valor: importe,
          fuente: precios.fuente,
          fecha_dato: precios.fecha_dato,
          metodo: `${anexos.trasteros} x ${precios.trastero_eur} EUR`,
          confianza: 'media',
          unidad: 'EUR',
        }),
      ),
    );
  }

  const umbralTerraza = leerValor(
    coef.anexos.terraza_m2_minima_computable,
    'coeficientes.anexos.terraza_m2_minima_computable',
  );
  if (anexos.terraza_m2 > umbralTerraza && precios.terraza_eur_m2 !== null) {
    const importe = anexos.terraza_m2 * precios.terraza_eur_m2;
    total += importe;
    lineas.push(
      linea(
        'Terraza',
        traza({
          valor: importe,
          fuente: precios.fuente,
          fecha_dato: precios.fecha_dato,
          metodo: `${anexos.terraza_m2} m2 x ${precios.terraza_eur_m2} EUR/m2 (umbral ${umbralTerraza} m2)`,
          confianza: 'media',
          unidad: 'EUR',
        }),
      ),
    );
  }

  return { total, lineas };
}

function calcularConfianza(ctx: ContextoT1, coef: CoeficientesConfig, avisos: Aviso[]): Confianza {
  const { market, superficie, fecha_calculo } = ctx;
  const ref = market.precio_m2;
  const reglas = coef.confianza;
  const niveles: Confianza[] = ['alta'];

  if (ref.ambito === 'municipio') {
    niveles.push(reglas.degradar_si_fallback_municipal);
    avisos.push(
      aviso(
        'info',
        'FALLBACK_MUNICIPAL',
        'No hay dato por codigo postal',
        `Se ha usado el precio medio del municipio en lugar del de ${ctx.property.localizacion.codigo_postal}. ` +
          'Dentro de un mismo municipio hay diferencias grandes entre barrios.',
      ),
    );
  }

  if (ref.ambito === 'provincia') {
    niveles.push(reglas.degradar_si_fallback_provincial);
    avisos.push(
      aviso(
        'critico',
        'FALLBACK_PROVINCIAL',
        'Solo hay dato provincial',
        'El precio de partida es la media de la provincia entera. Como referencia para negociar un piso ' +
          'concreto vale poco: busca el EUR/m2 del codigo postal en el portal del Notariado e introducelo a mano.',
      ),
    );
  }

  if (ref.n_transacciones !== null && ref.n_transacciones < reglas.min_transacciones_confianza_alta) {
    niveles.push('baja');
    avisos.push(
      aviso(
        'atencion',
        'POCAS_TRANSACCIONES',
        `Solo ${ref.n_transacciones} transacciones en la muestra`,
        `Por debajo de ${reglas.min_transacciones_confianza_alta} operaciones la media de la zona se mueve mucho ` +
          'con cada caso particular.',
      ),
    );
  }

  if (superficie.origen === 'estimada_desde_construida') {
    niveles.push(reglas.degradar_si_superficie_estimada);
  }

  const meses = mesesEntre(ref.fecha_dato, fecha_calculo);
  if (meses > reglas.meses_antiguedad_dato_para_degradar) {
    niveles.push('media');
    avisos.push(
      aviso(
        'atencion',
        'DATO_DESFASADO',
        `El precio de referencia tiene ${meses} meses`,
        `El dato es de ${ref.fecha_dato}. Por encima de ${reglas.meses_antiguedad_dato_para_degradar} meses ` +
          'conviene actualizarlo antes de usarlo para negociar.',
      ),
    );
  }

  return peorConfianza(...niveles);
}

/**
 * Horquilla P25-P75 del techo.
 *
 * Los percentiles vienen en la misma base que el EUR/m2 de la fuente, asi que
 * se les aplica el mismo recorrido completo que al valor central: conversion a
 * superficie util, actualizacion por IPV y coeficientes de homogeneizacion.
 * Ese recorrido se resume en la razon entre el EUR/m2 final y el de partida.
 */
function calcularRango(
  ref: MarketData['precio_m2'],
  eurM2Homogeneizado: number,
  m2Utiles: number,
  totalAnexos: number,
): { min: number; max: number } | null {
  if (ref.p25 === null || ref.p75 === null || ref.eur_m2 === 0) return null;

  const recorrido = eurM2Homogeneizado / ref.eur_m2;
  const redondear = (n: number): number => Math.round(n * 100) / 100;

  return {
    min: redondear(ref.p25 * recorrido * m2Utiles + totalAnexos),
    max: redondear(ref.p75 * recorrido * m2Utiles + totalAnexos),
  };
}
