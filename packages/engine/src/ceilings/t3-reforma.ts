import type { EngineConfig } from '@vp/config/schemas';
import { MissingConfigError, leerValor, requerido } from '@vp/config/values';

import { anioDe, aviso, linea, traza } from '../trace';
import type {
  Aviso,
  DesgloseLinea,
  PropertyInput,
  ReformaPrevista,
  SuperficieResuelta,
  Techo,
  TrazedValue,
} from '../types';

/**
 * T3 - Techo de reforma.
 *
 * Responde a "si hay que reformarlo, cuanto puedo pagar para que compra mas
 * reforma no supere el valor final".
 *
 *   coste_reforma = suma(partidas) x (1 + imprevistos) x (1 + IVA)
 *   T3            = valor_reformado - coste_reforma - margen_seguridad
 *
 * El margen de seguridad es lo que te protege de que la obra se desvie, que es
 * lo que hace la obra.
 */

export interface ContextoT3 {
  fecha_calculo: string;
  property: PropertyInput;
  config: EngineConfig;
  superficie: SuperficieResuelta;
  reforma: ReformaPrevista | null;
  /** Valor de mercado una vez reformado (ARV), calculado por el orquestador. */
  valorReformado: TrazedValue;
  /** true si el ARV se ha derivado de T1 en vez de observarse en el mercado. */
  arvDerivado: boolean;
}

export interface ResultadoT3 {
  techo: Techo;
  costeReforma: number | null;
}

export function calcularT3(ctx: ContextoT3): ResultadoT3 {
  const { fecha_calculo, property, config, superficie, reforma, valorReformado } = ctx;

  if (reforma === null) {
    return {
      techo: {
        id: 'T3',
        nombre: 'Techo de reforma',
        aplica: false,
        motivo_no_aplica:
          property.estado_conservacion === 'a_reformar'
            ? 'El inmueble esta a reformar pero no se ha descrito la reforma prevista.'
            : 'El inmueble esta listo para entrar: no hay reforma que descontar.',
        valor: null,
        rango: null,
        desglose: [],
        avisos: [],
      },
      costeReforma: null,
    };
  }

  const avisos: Aviso[] = [];
  const desglose: DesgloseLinea[] = [];
  const conf = config.reforma;
  const m2 = superficie.m2_utiles.valor;

  // -------------------------------------------------------------------------
  // Coste de ejecucion
  // -------------------------------------------------------------------------
  const moduloEurM2 = leerValor(
    conf.modulos_eur_m2_util[reforma.nivel],
    `reforma.modulos_eur_m2_util.${reforma.nivel}`,
  );
  const costeModulo = moduloEurM2 * m2;

  desglose.push(
    linea(
      `Modulo de obra: ${reforma.nivel}`,
      traza({
        valor: costeModulo,
        fuente: 'config/reforma.json',
        fecha_dato: fecha_calculo,
        metodo: `${moduloEurM2} EUR/m2 util x ${m2.toFixed(1)} m2`,
        confianza: superficie.origen === 'estimada_desde_construida' ? 'baja' : 'media',
        unidad: 'EUR',
      }),
    ),
  );

  let costeSingulares = 0;
  for (const partida of reforma.partidas_singulares) {
    const entrada = conf.partidas_singulares_eur[partida];
    if (entrada === undefined || typeof entrada === 'string') {
      throw new MissingConfigError(
        `reforma.partidas_singulares_eur.${partida}`,
        'La partida no existe en la configuracion.',
      );
    }
    const importe = leerValor(entrada, `reforma.partidas_singulares_eur.${partida}`);
    costeSingulares += importe;
    desglose.push(
      linea(
        `Partida singular: ${partida}`,
        traza({
          valor: importe,
          fuente: 'config/reforma.json',
          fecha_dato: fecha_calculo,
          metodo: 'importe absoluto',
          confianza: 'media',
          unidad: 'EUR',
        }),
      ),
    );
  }

  const costeEjecucion = costeModulo + costeSingulares;

  // -------------------------------------------------------------------------
  // Imprevistos
  // -------------------------------------------------------------------------
  const anioCorte = conf.imprevistos.anio_corte_edificio_antiguo;
  const edificioAntiguo = property.anio_construccion !== null && property.anio_construccion < anioCorte;
  const subeImprevistos = edificioAntiguo || !reforma.hay_proyecto_cerrado;

  const pctImprevistos = subeImprevistos
    ? leerValor(conf.imprevistos.edificio_antiguo_o_sin_proyecto, 'reforma.imprevistos.edificio_antiguo_o_sin_proyecto')
    : leerValor(conf.imprevistos.por_defecto, 'reforma.imprevistos.por_defecto');

  const costeConImprevistos = costeEjecucion * (1 + pctImprevistos);

  desglose.push(
    linea(
      'Provision de imprevistos',
      traza({
        valor: costeConImprevistos - costeEjecucion,
        fuente: 'config/reforma.json',
        fecha_dato: fecha_calculo,
        metodo: `${(pctImprevistos * 100).toFixed(0)}% sobre el coste de ejecucion`,
        confianza: 'media',
        unidad: 'EUR',
      }),
      subeImprevistos
        ? edificioAntiguo
          ? `provision alta: edificio anterior a ${anioCorte}`
          : 'provision alta: no hay proyecto cerrado'
        : 'provision estandar',
    ),
  );

  // -------------------------------------------------------------------------
  // IVA: art. 91 LIVA. Se modelan los dos casos y se avisa de cual aplica.
  // -------------------------------------------------------------------------
  const { tipo, cumpleArt91, motivos } = resolverIvaReforma(ctx, costeConImprevistos, avisos);

  const tipoGeneral = requerido(
    conf.iva.tipo_general,
    'reforma.iva.tipo_general',
    'Tipo general de IVA para obras que no cumplen las condiciones del art. 91 LIVA.',
  );
  const tipoReducido = requerido(
    conf.iva.tipo_reducido_rehabilitacion,
    'reforma.iva.tipo_reducido_rehabilitacion',
    'Tipo reducido de IVA en obras de renovacion de vivienda (art. 91 LIVA).',
  );

  const costeReforma = costeConImprevistos * (1 + tipo);
  const costeAlternativo = costeConImprevistos * (1 + (cumpleArt91 ? tipoGeneral : tipoReducido));

  desglose.push(
    linea(
      `IVA de la obra (${(tipo * 100).toFixed(0)}%)`,
      traza({
        valor: costeReforma - costeConImprevistos,
        fuente: 'config/reforma.json',
        fecha_dato: fecha_calculo,
        metodo: cumpleArt91 ? 'tipo reducido, art. 91 LIVA' : 'tipo general',
        confianza: 'media',
        unidad: 'EUR',
        notas: motivos,
      }),
    ),
    linea(
      `Escenario alternativo con IVA al ${((cumpleArt91 ? tipoGeneral : tipoReducido) * 100).toFixed(0)}%`,
      traza({
        valor: costeAlternativo,
        fuente: 'config/reforma.json',
        fecha_dato: fecha_calculo,
        metodo: 'coste total de la reforma con el otro tipo de IVA',
        confianza: 'baja',
        unidad: 'EUR',
        notas: [
          `Diferencia de ${Math.abs(costeAlternativo - costeReforma).toFixed(0)} EUR frente al escenario aplicado.`,
        ],
      }),
    ),
    linea(
      'Coste total de la reforma',
      traza({
        valor: costeReforma,
        fuente: 'config/reforma.json',
        fecha_dato: fecha_calculo,
        metodo: 'ejecucion x (1 + imprevistos) x (1 + IVA)',
        confianza: 'media',
        unidad: 'EUR',
      }),
      `${costeEjecucion.toFixed(0)} x ${(1 + pctImprevistos).toFixed(2)} x ${(1 + tipo).toFixed(2)}`,
    ),
  );

  // -------------------------------------------------------------------------
  // Margen de seguridad y techo
  // -------------------------------------------------------------------------
  // El margen protege de que la OBRA se desvie, asi que escala con la obra y no
  // con el valor del inmueble (ver ADR-012). Calculado sobre el valor reformado,
  // un lavado de cara de 17.000 EUR cargaba 9.400 EUR de margen y una reforma
  // premium de 105.000 EUR cargaba los mismos 9.400.
  const pctMargen = leerValor(conf.margen_seguridad, 'reforma.margen_seguridad');
  const margen = costeReforma * pctMargen;

  desglose.push(
    linea(
      'Valor de mercado una vez reformado (ARV)',
      valorReformado,
      ctx.arvDerivado ? 'derivado de T1 con estado "reformado reciente"' : 'dato de mercado',
    ),
    linea(
      'Margen de seguridad',
      traza({
        valor: margen,
        fuente: 'config/reforma.json',
        fecha_dato: fecha_calculo,
        metodo: `${(pctMargen * 100).toFixed(0)}% del coste de obra`,
        confianza: 'media',
        unidad: 'EUR',
      }),
    ),
  );

  if (ctx.arvDerivado) {
    avisos.push(
      aviso(
        'atencion',
        'ARV_DERIVADO',
        'El valor una vez reformado es una derivada, no un dato observado',
        'No habia EUR/m2 de vivienda reformada para la zona, asi que el ARV se ha calculado aplicando el ' +
          'coeficiente de "reformado reciente" al mismo precio base. Es coherente, pero no es lo mismo que ' +
          'mirar a que se venden los pisos ya reformados de la calle.',
      ),
    );
  }

  const t3 = valorReformado.valor - costeReforma - margen;

  if (t3 <= 0) {
    avisos.push(
      aviso(
        'critico',
        'REFORMA_NO_RENTABLE',
        'La reforma se come el valor del inmueble',
        `El coste de la obra (${costeReforma.toFixed(0)} EUR) mas el margen de seguridad supera el valor de ` +
          `mercado una vez reformado (${valorReformado.valor.toFixed(0)} EUR). A este nivel de reforma no hay ` +
          'precio de compra que haga que la operacion salga.',
      ),
    );
  }

  return {
    techo: {
      id: 'T3',
      nombre: 'Techo de reforma',
      aplica: true,
      motivo_no_aplica: null,
      valor: traza({
        valor: t3,
        fuente: 'config/reforma.json + valor reformado',
        fecha_dato: fecha_calculo,
        metodo: 'valor reformado - coste de reforma - margen de seguridad',
        confianza: valorReformado.confianza,
        unidad: 'EUR',
        notas: [
          `Coste de reforma: ${costeReforma.toFixed(0)} EUR (${(costeReforma / m2).toFixed(0)} EUR/m2 util).`,
        ],
      }),
      rango: null,
      desglose,
      avisos,
    },
    costeReforma,
  };
}

/**
 * Tipo de IVA de la obra segun el art. 91 LIVA.
 *
 * Tres condiciones: antiguedad minima de la vivienda, destinatario particular, y
 * limite del coste frente al valor catastral. Si alguna no se puede comprobar,
 * se aplica el tipo general (el mas caro) y se avisa: en un techo de precio,
 * equivocarse por optimismo es lo que lleva a ofrecer de mas.
 */
function resolverIvaReforma(
  ctx: ContextoT3,
  costeSinIva: number,
  avisos: Aviso[],
): { tipo: number; cumpleArt91: boolean; motivos: string[] } {
  const { property, config, fecha_calculo, reforma } = ctx;
  const conf = config.reforma;
  const motivos: string[] = [];
  let cumple = true;

  // (1) Antiguedad minima de la vivienda
  const minAnios = leerValor(conf.iva.antiguedad_minima_anios, 'reforma.iva.antiguedad_minima_anios');
  if (property.anio_construccion === null) {
    cumple = false;
    motivos.push('No hay ano de construccion para comprobar la antiguedad minima.');
  } else {
    const edad = anioDe(fecha_calculo) - property.anio_construccion;
    if (edad < minAnios) {
      cumple = false;
      motivos.push(`La vivienda tiene ${edad} anos, por debajo del minimo de ${minAnios}.`);
    } else {
      motivos.push(`Antiguedad de ${edad} anos: cumple el minimo de ${minAnios}.`);
    }
  }

  // (2) Destinatario particular
  if (reforma !== null && !reforma.destinatario_particular) {
    cumple = false;
    motivos.push('El destinatario de la obra no actua como particular.');
  }

  // (3) Limite del coste frente al valor catastral
  const multiplicador = conf.iva.condicion_coste_vs_valor_catastral.multiplicador_valor_catastral;
  if (multiplicador === null) {
    motivos.push('No se ha comprobado el limite de coste frente al valor catastral: falta el multiplicador.');
    avisos.push(
      aviso(
        'atencion',
        'LIMITE_IVA_SIN_COMPROBAR',
        'No se ha verificado el limite de coste del art. 91 LIVA',
        'reforma.iva.condicion_coste_vs_valor_catastral.multiplicador_valor_catastral sigue a null, asi que ' +
          'esa condicion no se ha evaluado. Confirma la redaccion vigente del articulo antes de dar por ' +
          'bueno el tipo reducido.',
        'Art. 91 de la Ley 37/1992 del IVA',
      ),
    );
  } else if (property.valor_catastral === null) {
    cumple = false;
    motivos.push('No hay valor catastral para comprobar el limite de coste.');
    avisos.push(
      aviso(
        'atencion',
        'SIN_VALOR_CATASTRAL',
        'Falta el valor catastral',
        'Sin el valor catastral no se puede comprobar si la obra entra en el tipo reducido de IVA. ' +
          'Se ha aplicado el tipo general, que encarece la reforma. Lo tienes en el recibo del IBI.',
      ),
    );
  } else {
    const limite = property.valor_catastral * multiplicador;
    if (costeSinIva > limite) {
      cumple = false;
      motivos.push(
        `El coste de la obra (${costeSinIva.toFixed(0)} EUR) supera el limite de ${limite.toFixed(0)} EUR.`,
      );
    } else {
      motivos.push(`El coste esta por debajo del limite de ${limite.toFixed(0)} EUR.`);
    }
  }

  if (!conf.iva.verificado) {
    avisos.push(
      aviso(
        'critico',
        'IVA_REFORMA_SIN_VERIFICAR',
        'Los tipos de IVA de la reforma no estan verificados',
        'reforma.iva sigue con verificado: false. Confirma los tipos y la redaccion vigente del art. 91 LIVA.',
        'Art. 91 de la Ley 37/1992 del IVA',
      ),
    );
  }

  const tipo = cumple
    ? requerido(
        conf.iva.tipo_reducido_rehabilitacion,
        'reforma.iva.tipo_reducido_rehabilitacion',
        'Tipo reducido de IVA en obras de renovacion de vivienda.',
      )
    : requerido(conf.iva.tipo_general, 'reforma.iva.tipo_general', 'Tipo general de IVA.');

  return { tipo, cumpleArt91: cumple, motivos };
}
