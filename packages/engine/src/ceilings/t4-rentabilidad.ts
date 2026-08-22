import type { EngineConfig } from '@vp/config/schemas';
import { leerValor, requerido } from '@vp/config/values';

import { calcularGastosCompra } from '../costs/gastos-compra';
import { InputInvalidoError } from '../errors';
import { cuotaFrances, mayorQueCumple } from '../math/finance';
import { aviso, linea, traza } from '../trace';
import type {
  Aviso,
  BuyerProfile,
  DesgloseLinea,
  InversionInput,
  MarketData,
  MetricasInversion,
  PropertyInput,
  Techo,
  TrazedValue,
} from '../types';

/**
 * T4 - Techo de rentabilidad. Solo en modo inversor.
 *
 * Dos ramas muy distintas:
 *
 *   Alquiler:  el precio que hace que la operacion rinda la rentabilidad neta
 *              objetivo, una vez descontados todos los gastos recurrentes y el
 *              IRPF.
 *   Flipping:  ARV x factor - coste de reforma. El complementario del factor
 *              cubre gastos de compra, financieros, fiscales, de
 *              comercializacion y el margen del inversor.
 */

export interface ContextoT4 {
  fecha_calculo: string;
  property: PropertyInput;
  buyer: BuyerProfile;
  market: MarketData;
  config: EngineConfig;
  inversion: InversionInput | null;
  /** Coste de reforma que sale de T3, si hay reforma prevista. */
  costeReforma: number | null;
  /** Valor de mercado una vez reformado. Imprescindible en flipping. */
  valorReformado: TrazedValue | null;
}

export interface ResultadoT4 {
  techo: Techo;
  metricas: MetricasInversion | null;
}

export function calcularT4(ctx: ContextoT4): ResultadoT4 {
  const { buyer } = ctx;

  if (buyer.objetivo === 'residencia') {
    return {
      techo: noAplica('Solo aplica en modo inversor. El objetivo declarado es residencia.'),
      metricas: null,
    };
  }

  if (ctx.inversion === null) {
    return {
      techo: noAplica(
        'El objetivo es de inversion pero no se han dado los datos de la operacion ' +
          '(gestion, IBI, comunidad, rentabilidad objetivo).',
      ),
      metricas: null,
    };
  }

  return buyer.objetivo === 'inversion_flipping' ? calcularFlipping(ctx) : calcularAlquiler(ctx);
}

// ---------------------------------------------------------------------------
// Alquiler (buy & hold)
// ---------------------------------------------------------------------------

interface GastosAnuales {
  ibi: number;
  comunidad: number;
  seguro: number;
  mantenimiento: number;
  gestion: number;
  irpf: number;
  total: number;
}

function calcularAlquiler(ctx: ContextoT4): ResultadoT4 {
  const { fecha_calculo, property, buyer, market, config, inversion } = ctx;
  const conf = config.rentabilidad.alquiler;
  const avisos: Aviso[] = [];
  const desglose: DesgloseLinea[] = [];

  if (inversion === null) throw new InputInvalidoError('inversion', 'Requerido en modo inversor.');
  if (market.alquiler === null) {
    return {
      techo: noAplica(
        'No hay renta de mercado para la zona. Sin ella no se puede calcular rentabilidad: ' +
          'consulta SERPAVI e introduce la renta a mano.',
      ),
      metricas: null,
    };
  }

  // -------------------------------------------------------------------------
  // Renta, con el limite de zona tensionada si aplica
  // -------------------------------------------------------------------------
  const datos = market.alquiler;
  let renta = datos.renta_mensual_estimada;

  if (datos.zona_tensionada === true) {
    if (conf.zona_tensionada.aplicar_limite_indice && datos.renta_maxima_indice !== null) {
      if (datos.renta_maxima_indice < renta) {
        avisos.push(
          aviso(
            'critico',
            'RENTA_LIMITADA_POR_ZONA_TENSIONADA',
            'El municipio esta declarado zona de mercado residencial tensionado',
            `La renta de mercado seria ${renta.toFixed(0)} EUR/mes, pero el indice de referencia limita los ` +
              `contratos nuevos a ${datos.renta_maxima_indice.toFixed(0)} EUR/mes. Se calcula con el limite: ` +
              'la diferencia no la puedes cobrar legalmente.',
            'Ley 12/2023 por el derecho a la vivienda',
          ),
        );
      }
      renta = Math.min(renta, datos.renta_maxima_indice);
    } else {
      avisos.push(
        aviso(
          'critico',
          'ZONA_TENSIONADA_SIN_LIMITE',
          'Zona tensionada y no se ha aplicado el limite del indice',
          'El municipio esta declarado zona tensionada pero no hay valor del indice de referencia, asi que ' +
            'se ha usado la renta de mercado entera. La rentabilidad real puede ser bastante menor.',
          'Ley 12/2023 por el derecho a la vivienda',
        ),
      );
    }
  } else if (datos.zona_tensionada === null) {
    avisos.push(
      aviso(
        'atencion',
        'ZONA_TENSIONADA_SIN_COMPROBAR',
        'No se ha comprobado si el municipio es zona tensionada',
        'Si lo fuera, el indice de referencia limitaria la renta de los contratos nuevos y tumbaria la ' +
          'rentabilidad de la operacion. Es un input, no un adorno.',
      ),
    );
  }

  const vacancia = leerValor(conf.tasa_vacancia, 'rentabilidad.alquiler.tasa_vacancia');
  const ingresosBrutos = renta * 12 * (1 - vacancia);

  // -------------------------------------------------------------------------
  // Gastos recurrentes. No se estiman a la ligera: omitir uno infla la
  // rentabilidad y con ella el precio que la herramienta recomienda pagar.
  // -------------------------------------------------------------------------
  const ibi = resolverIbi(inversion, property, config);
  const comunidad = resolverComunidad(inversion);
  const seguro = leerValor(conf.seguro_anual_eur, 'rentabilidad.alquiler.seguro_anual_eur');
  const pctMantenimiento = leerValor(
    conf.mantenimiento_pct_valor_anual,
    'rentabilidad.alquiler.mantenimiento_pct_valor_anual',
  );
  const pctGestion =
    inversion.gestion === 'agencia'
      ? leerValor(conf.gestion_agencia, 'rentabilidad.alquiler.gestion_agencia')
      : leerValor(conf.gestion_autogestion, 'rentabilidad.alquiler.gestion_autogestion');

  const reduccionIrpf = requerido(
    conf.irpf.reduccion_general,
    'rentabilidad.alquiler.irpf.reduccion_general',
    'Reduccion del rendimiento neto por arrendamiento de vivienda. La Ley 12/2023 sustituyo la reduccion ' +
      'unica anterior por varios porcentajes segun el caso: hay que confirmar cual aplica.',
  );
  const tipoMarginal = requerido(
    inversion.tipo_marginal_irpf ?? conf.irpf.tipo_marginal_estimado,
    'inversion.tipo_marginal_irpf',
    'Tipo marginal de IRPF del inversor. Sin el no se puede estimar el impuesto, y omitirlo hace que la ' +
      'operacion parezca mas rentable de lo que es.',
  );

  const gastosDe = (precio: number): GastosAnuales => {
    const mantenimiento = precio * pctMantenimiento;
    const gestion = ingresosBrutos * pctGestion;
    // Deducibles del rendimiento del capital inmobiliario que si modelamos.
    // Los intereses de la hipoteca tambien lo son y no se descuentan: eso deja
    // el IRPF estimado por lo alto, que es el lado seguro para un techo de precio.
    const deducibles = ibi + comunidad + seguro + mantenimiento + gestion;
    const rendimientoNeto = Math.max(0, ingresosBrutos - deducibles);
    const irpf = rendimientoNeto * (1 - reduccionIrpf) * tipoMarginal;

    const total = ibi + comunidad + seguro + mantenimiento + gestion + irpf;
    return { ibi, comunidad, seguro, mantenimiento, gestion, irpf, total };
  };

  const objetivo =
    inversion.rentabilidad_objetivo ??
    leerValor(conf.rentabilidad_neta_objetivo, 'rentabilidad.alquiler.rentabilidad_neta_objetivo');

  const costeReforma = ctx.costeReforma ?? 0;

  /**
   * Rentabilidad neta a un precio dado.
   *
   * El brief daba T4 = NOI / r - gastos - reforma, que es exacto cuando el NOI
   * no depende del precio. Aqui si depende, porque el mantenimiento va como
   * porcentaje del valor y los gastos de compra tienen tramos. Se resuelve por
   * biseccion, igual que T2; con mantenimiento a cero el resultado coincide con
   * la formula cerrada del brief.
   */
  const rentabilidadA = (precio: number): number => {
    const noi = ingresosBrutos - gastosDe(precio).total;
    const inversionTotal =
      precio + calcularGastosCompra(precio, { property, buyer, config }).gastos.total + costeReforma;
    return inversionTotal <= 0 ? 0 : noi / inversionTotal;
  };

  const solver = config.hipoteca.solver;
  const t4 = mayorQueCumple((p) => rentabilidadA(p) >= objetivo, {
    min: solver.precio_min_eur,
    max: solver.precio_max_eur,
    tolerancia: solver.tolerancia_eur,
    maxIteraciones: solver.max_iteraciones,
  });

  if (t4 <= 0) {
    return {
      techo: {
        id: 'T4',
        nombre: 'Techo de rentabilidad',
        aplica: true,
        motivo_no_aplica: null,
        valor: null,
        rango: null,
        desglose: [],
        avisos: [
          ...avisos,
          aviso(
            'critico',
            'RENTABILIDAD_INALCANZABLE',
            `Ni al precio minimo la operacion da el ${(objetivo * 100).toFixed(2)}% objetivo`,
            `Con ${renta.toFixed(0)} EUR/mes de renta y ${gastosDe(solver.precio_min_eur).total.toFixed(0)} EUR ` +
              'de gastos anuales, no hay precio de compra que alcance esa rentabilidad. O bajas el objetivo, ' +
              'o esta operacion no es para alquilar.',
          ),
        ],
      },
      metricas: null,
    };
  }

  const gastos = gastosDe(t4);
  const noi = ingresosBrutos - gastos.total;
  const gastosCompra = calcularGastosCompra(t4, { property, buyer, config }).gastos.total;
  const inversionTotal = t4 + gastosCompra + costeReforma;

  const traz = (valor: number, metodo: string, unidad: 'EUR' | 'porcentaje' | 'anios' = 'EUR') =>
    traza({
      valor,
      fuente: 'config/rentabilidad.json + input usuario',
      fecha_dato: fecha_calculo,
      metodo,
      confianza: 'media',
      unidad,
    });

  desglose.push(
    linea('Renta mensual aplicada', traz(renta, datos.fuente)),
    linea(
      'Ingresos brutos anuales',
      traz(ingresosBrutos, `${renta.toFixed(0)} x 12 x (1 - ${vacancia} de vacancia)`),
    ),
    linea('IBI', traz(gastos.ibi, inversion.ibi_anual_eur !== null ? 'recibo del IBI' : 'estimado sobre valor catastral')),
    linea('Comunidad', traz(gastos.comunidad, `${(gastos.comunidad / 12).toFixed(2)} EUR/mes`)),
    linea('Seguro', traz(gastos.seguro, 'importe anual configurado')),
    linea('Mantenimiento', traz(gastos.mantenimiento, `${(pctMantenimiento * 100).toFixed(2)}% del valor`)),
    linea(
      'Gestion',
      traz(gastos.gestion, inversion.gestion === 'agencia' ? `${(pctGestion * 100).toFixed(0)}% via agencia` : 'autogestion'),
    ),
    linea(
      'IRPF estimado',
      traz(
        gastos.irpf,
        `rendimiento neto x (1 - ${reduccionIrpf} de reduccion) x ${tipoMarginal} de tipo marginal`,
      ),
    ),
    linea('NOI anual', traz(noi, 'ingresos brutos - gastos anuales')),
    linea('Inversion total', traz(inversionTotal, 'precio + gastos de compra + reforma')),
  );

  if (!conf.irpf.verificado) {
    avisos.push(
      aviso(
        'critico',
        'IRPF_ALQUILER_SIN_VERIFICAR',
        'La reduccion de IRPF por arrendamiento no esta verificada',
        'La Ley 12/2023 sustituyo la reduccion unica del 60% por varios porcentajes segun el caso ' +
          '(zona tensionada, rebaja de renta, inquilino joven, rehabilitacion reciente). Confirma cual te ' +
          'aplica: cambia bastante el NOI.',
        'Ley 12/2023 y art. 23.2 LIRPF',
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Metricas de la operacion
  // -------------------------------------------------------------------------
  const ltv = buyer.hipoteca.ltv_max;
  const meses = Math.round(buyer.hipoteca.plazo_anios * 12);
  const cuotaAnual = cuotaFrances(t4 * ltv, buyer.hipoteca.tin_anual / 12, meses) * 12;
  const capitalPropio = (1 - ltv) * t4 + gastosCompra + costeReforma;
  const flujoCaja = noi - cuotaAnual;

  const metricas: MetricasInversion = {
    rentabilidad_bruta: traz((renta * 12) / inversionTotal, 'renta anual bruta / inversion total', 'porcentaje'),
    rentabilidad_neta: traz(noi / inversionTotal, 'NOI / inversion total', 'porcentaje'),
    cash_on_cash: traz(
      capitalPropio <= 0 ? 0 : flujoCaja / capitalPropio,
      'flujo de caja tras hipoteca / capital propio aportado',
      'porcentaje',
    ),
    anios_recuperacion: traz(
      flujoCaja <= 0 ? Number.POSITIVE_INFINITY : capitalPropio / flujoCaja,
      'capital propio / flujo de caja anual',
      'anios',
    ),
    noi_anual: traz(noi, 'ingresos brutos - gastos anuales'),
  };

  if (flujoCaja < 0) {
    avisos.push(
      aviso(
        'critico',
        'FLUJO_DE_CAJA_NEGATIVO',
        'La operacion no se paga sola',
        `El NOI anual (${noi.toFixed(0)} EUR) no cubre la cuota de hipoteca (${cuotaAnual.toFixed(0)} EUR). ` +
          `Tendrias que poner ${Math.abs(flujoCaja / 12).toFixed(0)} EUR de tu bolsillo cada mes.`,
      ),
    );
  }

  return {
    techo: {
      id: 'T4',
      nombre: 'Techo de rentabilidad',
      aplica: true,
      motivo_no_aplica: null,
      valor: traza({
        valor: t4,
        fuente: `${datos.fuente} + config/rentabilidad.json`,
        fecha_dato: datos.fecha_dato,
        metodo: `biseccion sobre rentabilidad neta objetivo del ${(objetivo * 100).toFixed(2)}%`,
        confianza: 'media',
        unidad: 'EUR',
        notas: [
          `NOI anual estimado: ${noi.toFixed(0)} EUR.`,
          `Rentabilidad bruta ${((renta * 12 * 100) / inversionTotal).toFixed(2)}%, neta ${((noi * 100) / inversionTotal).toFixed(2)}%.`,
        ],
      }),
      rango: null,
      desglose,
      avisos,
    },
    metricas,
  };
}

function resolverIbi(inversion: InversionInput, property: PropertyInput, config: EngineConfig): number {
  if (inversion.ibi_anual_eur !== null) return inversion.ibi_anual_eur;

  const pct = config.rentabilidad.gastos_recurrentes.ibi_pct_valor_catastral.valor;
  if (pct !== null && property.valor_catastral !== null) return property.valor_catastral * pct;

  throw new InputInvalidoError(
    'inversion.ibi_anual_eur',
    'Sin IBI del recibo y sin valor catastral no se puede estimar el gasto. Dejarlo fuera haria que la ' +
      'operacion pareciese mas rentable de lo que es, y el techo de precio saldria mas alto de lo debido. ' +
      'El importe esta en el recibo del IBI, y el valor catastral tambien.',
  );
}

function resolverComunidad(inversion: InversionInput): number {
  if (inversion.comunidad_mensual_eur !== null) return inversion.comunidad_mensual_eur * 12;

  throw new InputInvalidoError(
    'inversion.comunidad_mensual_eur',
    'La cuota de comunidad es un gasto recurrente que sale del acta o del propio anuncio. Omitirla infla ' +
      'la rentabilidad.',
  );
}

// ---------------------------------------------------------------------------
// Flipping
// ---------------------------------------------------------------------------

function calcularFlipping(ctx: ContextoT4): ResultadoT4 {
  const { fecha_calculo, config, valorReformado, costeReforma } = ctx;
  const conf = config.rentabilidad.flipping;
  const avisos: Aviso[] = [];
  const desglose: DesgloseLinea[] = [];

  if (valorReformado === null) {
    return {
      techo: noAplica('Sin valor de mercado una vez reformado (ARV) no se puede calcular una operacion de flipping.'),
      metricas: null,
    };
  }
  if (costeReforma === null) {
    return {
      techo: noAplica('Una operacion de flipping necesita una reforma prevista y no se ha descrito ninguna.'),
      metricas: null,
    };
  }

  const factor = leerValor(conf.factor_arv, 'rentabilidad.flipping.factor_arv');
  const arv = valorReformado.valor;
  const t4 = arv * factor - costeReforma;

  desglose.push(
    linea('Valor una vez reformado (ARV)', valorReformado),
    linea(
      `ARV x ${factor}`,
      traza({
        valor: arv * factor,
        fuente: 'config/rentabilidad.json',
        fecha_dato: fecha_calculo,
        metodo: `factor de flipping ${factor}`,
        confianza: 'media',
        unidad: 'EUR',
      }),
    ),
    linea(
      'Coste de reforma',
      traza({
        valor: costeReforma,
        fuente: 'T3',
        fecha_dato: fecha_calculo,
        metodo: 'coste de obra con imprevistos e IVA',
        confianza: 'media',
        unidad: 'EUR',
      }),
    ),
  );

  // El complementario del factor no es un numero magico: se desglosa para poder
  // explicarlo, y se comprueba que cuadre.
  const complementario = 1 - factor;
  let sumaDesglose = 0;

  for (const [concepto, entrada] of Object.entries(conf.desglose_del_complementario)) {
    if (concepto.startsWith('_') || typeof entrada === 'string') continue;
    const pct = entrada.valor;
    if (pct === null) continue;
    sumaDesglose += pct;
    desglose.push(
      linea(
        `Del ${(complementario * 100).toFixed(0)}%: ${concepto.replace(/_/g, ' ')}`,
        traza({
          valor: arv * pct,
          fuente: 'config/rentabilidad.json',
          fecha_dato: fecha_calculo,
          metodo: `${(pct * 100).toFixed(1)}% del ARV`,
          confianza: 'baja',
          unidad: 'EUR',
        }),
      ),
    );
  }

  if (Math.abs(sumaDesglose - complementario) > 0.005) {
    avisos.push(
      aviso(
        'atencion',
        'DESGLOSE_FLIPPING_NO_CUADRA',
        'El desglose del margen de flipping no suma',
        `factor_arv es ${factor}, luego el complementario es ${(complementario * 100).toFixed(1)}%, pero las ` +
          `partidas del desglose suman ${(sumaDesglose * 100).toFixed(1)}%. Uno de los dos esta mal, y el ` +
          'desglose es lo unico que permite defender de donde sale ese porcentaje.',
      ),
    );
  }

  if (t4 <= 0) {
    avisos.push(
      aviso(
        'critico',
        'FLIPPING_SIN_RECORRIDO',
        'La operacion de flipping no deja margen',
        `El ARV por el factor (${(arv * factor).toFixed(0)} EUR) no cubre el coste de reforma ` +
          `(${costeReforma.toFixed(0)} EUR). No hay precio de compra que haga viable la operacion.`,
      ),
    );
  }

  return {
    techo: {
      id: 'T4',
      nombre: 'Techo de rentabilidad (flipping)',
      aplica: true,
      motivo_no_aplica: null,
      valor: traza({
        valor: t4,
        fuente: 'config/rentabilidad.json + ARV',
        fecha_dato: valorReformado.fecha_dato,
        metodo: `ARV x ${factor} - coste de reforma`,
        confianza: valorReformado.confianza,
        unidad: 'EUR',
        notas: [
          `El ${(complementario * 100).toFixed(0)}% que no se paga cubre gastos de compra, financieros, ` +
            'fiscales, de comercializacion y el margen del inversor.',
        ],
      }),
      rango: null,
      desglose,
      avisos,
    },
    metricas: null,
  };
}

// ---------------------------------------------------------------------------

function noAplica(motivo: string): Techo {
  return {
    id: 'T4',
    nombre: 'Techo de rentabilidad',
    aplica: false,
    motivo_no_aplica: motivo,
    valor: null,
    rango: null,
    desglose: [],
    avisos: [],
  };
}
