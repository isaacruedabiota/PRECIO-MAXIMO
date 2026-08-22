import type { EngineConfig } from '@vp/config/schemas';
import { leerValor } from '@vp/config/values';

import type { DesgloseGastos } from '../costs/gastos-compra';
import { calcularGastosCompra } from '../costs/gastos-compra';
import { capitalDesdeCuota, cuotaFrances, mayorQueCumple } from '../math/finance';
import { aviso, linea, traza } from '../trace';
import type { Aviso, BuyerProfile, DesgloseLinea, PropertyInput, Techo } from '../types';

/**
 * T2 - Techo financiero-fiscal.
 *
 * Responde a "hasta donde llegan mi ahorro y mi capacidad de pago, con todos
 * los impuestos y gastos dentro". Son dos restricciones independientes y manda
 * la menor:
 *
 *   (a) ahorro:  entrada + gastos(P) <= ahorro disponible
 *   (b) cuota:   cuota mensual <= ratio de esfuerzo x ingresos netos
 *
 * La restriccion de ahorro se resuelve por biseccion porque gastos(P) no es
 * lineal: los aranceles van por tramos y la base imponible del impuesto es
 * max(precio, valor de referencia catastral), que mete un codo en la funcion.
 */

export interface ContextoT2 {
  fecha_calculo: string;
  property: PropertyInput;
  buyer: BuyerProfile;
  config: EngineConfig;
}

export interface ResultadoT2 {
  techo: Techo;
  /** Gastos en el precio que marca el techo. Los reutiliza T4. */
  gastos: DesgloseGastos | null;
}

export function calcularT2(ctx: ContextoT2): ResultadoT2 {
  const { fecha_calculo, buyer, config } = ctx;
  const avisos: Aviso[] = [];
  const desglose: DesgloseLinea[] = [];
  const hip = config.hipoteca;

  // -------------------------------------------------------------------------
  // Parametros del prestamo
  // -------------------------------------------------------------------------
  const topeLtv = leerValor(hip.ltv.tope_absoluto, 'hipoteca.ltv.tope_absoluto');
  let ltv = buyer.hipoteca.ltv_max;
  if (ltv > topeLtv) {
    avisos.push(
      aviso(
        'atencion',
        'LTV_TOPADO',
        'El LTV solicitado supera el tope de la herramienta',
        `Has pedido financiar el ${(buyer.hipoteca.ltv_max * 100).toFixed(0)}% y se ha limitado al ` +
          `${(topeLtv * 100).toFixed(0)}%. Por encima del 80% la banca suele exigir garantia adicional.`,
      ),
    );
    ltv = topeLtv;
  }

  const plazoMaximo = leerValor(hip.plazo.anios_maximo, 'hipoteca.plazo.anios_maximo');
  const edadLimite = leerValor(hip.plazo.edad_limite_vencimiento, 'hipoteca.plazo.edad_limite_vencimiento');
  const plazoPorEdad = edadLimite - buyer.edad;

  const plazoAnios = Math.min(buyer.hipoteca.plazo_anios, plazoMaximo, plazoPorEdad);

  if (plazoAnios <= 0) {
    return {
      techo: techoNulo(
        'Con la edad del comprador y el limite de vencimiento configurado no queda plazo de amortizacion.',
      ),
      gastos: null,
    };
  }
  if (plazoAnios < buyer.hipoteca.plazo_anios) {
    avisos.push(
      aviso(
        'atencion',
        'PLAZO_RECORTADO',
        `El plazo se ha recortado a ${plazoAnios} anos`,
        `Pedias ${buyer.hipoteca.plazo_anios} anos. El limite lo marca ` +
          (plazoPorEdad < plazoMaximo
            ? `la edad de vencimiento (${edadLimite} anos)`
            : `el plazo maximo configurado (${plazoMaximo} anos)`) +
          '. Menos plazo es mas cuota, y por tanto menos techo.',
      ),
    );
  }

  const meses = Math.round(plazoAnios * 12);
  const tipoMensual = buyer.hipoteca.tin_anual / 12;

  // -------------------------------------------------------------------------
  // (a) Restriccion de ahorro
  // -------------------------------------------------------------------------
  const solver = hip.solver;
  const gastosDe = (p: number): number => calcularGastosCompra(p, ctx).gastos.total;
  const cabeEnElAhorro = (p: number): boolean => (1 - ltv) * p + gastosDe(p) <= buyer.ahorro_disponible;

  const precioPorAhorro = mayorQueCumple(cabeEnElAhorro, {
    min: solver.precio_min_eur,
    max: solver.precio_max_eur,
    tolerancia: solver.tolerancia_eur,
    maxIteraciones: solver.max_iteraciones,
  });

  if (precioPorAhorro <= 0) {
    return {
      techo: techoNulo(
        `Con ${buyer.ahorro_disponible.toFixed(0)} EUR de ahorro no se cubre la entrada mas los gastos ` +
          `ni del precio minimo contemplado (${solver.precio_min_eur} EUR).`,
      ),
      gastos: null,
    };
  }

  // -------------------------------------------------------------------------
  // (b) Restriccion de cuota
  // -------------------------------------------------------------------------
  const ratioEsfuerzo = leerValor(hip.ratio_esfuerzo.por_defecto, 'hipoteca.ratio_esfuerzo.por_defecto');
  const cuotaMaxima = ratioEsfuerzo * buyer.ingresos_netos_mensuales - buyer.deudas_mensuales_actuales;

  if (cuotaMaxima <= 0) {
    return {
      techo: techoNulo(
        `Las deudas mensuales actuales (${buyer.deudas_mensuales_actuales} EUR) se comen entera la cuota ` +
          `que permite un esfuerzo del ${(ratioEsfuerzo * 100).toFixed(0)}% sobre ` +
          `${buyer.ingresos_netos_mensuales} EUR de ingresos netos.`,
      ),
      gastos: null,
    };
  }

  const capitalMaximo = capitalDesdeCuota(cuotaMaxima, tipoMensual, meses);
  const precioPorCuota = capitalMaximo / ltv;

  // -------------------------------------------------------------------------
  // El techo es el menor de los dos
  // -------------------------------------------------------------------------
  const limitante = precioPorAhorro <= precioPorCuota ? 'ahorro' : 'cuota';
  const t2 = Math.min(precioPorAhorro, precioPorCuota);

  const { gastos, avisos: avisosGastos } = calcularGastosCompra(t2, ctx);
  avisos.push(...avisosGastos);

  desglose.push(
    linea(
      'Techo por ahorro disponible',
      traza({
        valor: precioPorAhorro,
        fuente: 'input usuario',
        fecha_dato: fecha_calculo,
        metodo: 'biseccion',
        confianza: 'alta',
        unidad: 'EUR',
      }),
      `${buyer.ahorro_disponible} >= ${((1 - ltv) * 100).toFixed(0)}% x P + gastos(P)`,
    ),
    linea(
      'Techo por capacidad de pago',
      traza({
        valor: precioPorCuota,
        fuente: 'input usuario',
        fecha_dato: fecha_calculo,
        metodo: 'sistema frances invertido',
        confianza: 'alta',
        unidad: 'EUR',
      }),
      `cuota max ${cuotaMaxima.toFixed(2)} EUR a ${plazoAnios} anos al ` +
        `${(buyer.hipoteca.tin_anual * 100).toFixed(2)}% -> capital ${capitalMaximo.toFixed(0)} / LTV ${ltv}`,
    ),
    linea(
      'Impuesto de transmisiones',
      traza({
        valor: gastos.itp + gastos.iva + gastos.ajd,
        fuente: `config/itp.json - ${gastos.modalidad}`,
        fecha_dato: fecha_calculo,
        metodo: `${(gastos.tipo_aplicado * 100).toFixed(2)}% sobre ${gastos.base_imponible_impuesto.toFixed(0)} EUR`,
        confianza: 'media',
        unidad: 'EUR',
        notas: gastos.manda_valor_referencia
          ? ['La base imponible es el valor de referencia catastral, no el precio.']
          : [],
      }),
    ),
    linea(
      'Notaria',
      traza({
        valor: gastos.notaria,
        fuente: 'config/aranceles.json',
        fecha_dato: fecha_calculo,
        metodo: 'arancel escalado',
        confianza: 'media',
        unidad: 'EUR',
      }),
    ),
    linea(
      'Registro de la propiedad',
      traza({
        valor: gastos.registro,
        fuente: 'config/aranceles.json',
        fecha_dato: fecha_calculo,
        metodo: 'arancel escalado',
        confianza: 'media',
        unidad: 'EUR',
      }),
    ),
    linea(
      'Gestoria, tasacion y nota simple',
      traza({
        valor: gastos.gestoria + gastos.tasacion + gastos.nota_simple,
        fuente: 'config/aranceles.json',
        fecha_dato: fecha_calculo,
        metodo: 'importes fijos configurables',
        confianza: 'media',
        unidad: 'EUR',
      }),
    ),
    linea(
      'Gastos totales de compra',
      traza({
        valor: gastos.total,
        fuente: 'suma de partidas',
        fecha_dato: fecha_calculo,
        metodo: 'impuesto + aranceles + fijos',
        confianza: 'media',
        unidad: 'EUR',
      }),
      `${((gastos.total / t2) * 100).toFixed(2)}% del precio`,
    ),
  );

  // -------------------------------------------------------------------------
  // Escenario de estres (solo tipo variable o mixto)
  // -------------------------------------------------------------------------
  if (buyer.hipoteca.tipo === 'variable' || buyer.hipoteca.tipo === 'mixto') {
    const incremento = leerValor(hip.escenario_estres.incremento_euribor_pp, 'hipoteca.escenario_estres.incremento_euribor_pp');
    const umbral = leerValor(
      hip.ratio_esfuerzo.umbral_alerta_escenario_estres,
      'hipoteca.ratio_esfuerzo.umbral_alerta_escenario_estres',
    );

    const tipoEstresado = (buyer.hipoteca.tin_anual + incremento) / 12;
    const cuotaEstresada = cuotaFrances(t2 * ltv, tipoEstresado, meses);
    const esfuerzoEstresado =
      (cuotaEstresada + buyer.deudas_mensuales_actuales) / buyer.ingresos_netos_mensuales;

    desglose.push(
      linea(
        'Cuota en escenario de estres',
        traza({
          valor: cuotaEstresada,
          fuente: 'config/hipoteca.json',
          fecha_dato: fecha_calculo,
          metodo: `euribor +${(incremento * 100).toFixed(0)} pp`,
          confianza: 'media',
          unidad: 'EUR',
        }),
        `esfuerzo ${(esfuerzoEstresado * 100).toFixed(1)}%`,
      ),
    );

    if (esfuerzoEstresado > umbral) {
      avisos.push(
        aviso(
          'critico',
          'ESFUERZO_ESTRESADO_EXCESIVO',
          `Si el euribor sube ${(incremento * 100).toFixed(0)} puntos, la cuota se come el ${(esfuerzoEstresado * 100).toFixed(0)}% de tus ingresos`,
          `La cuota pasaria de ${cuotaFrances(t2 * ltv, tipoMensual, meses).toFixed(0)} a ` +
            `${cuotaEstresada.toFixed(0)} EUR al mes, por encima del umbral del ` +
            `${(umbral * 100).toFixed(0)}%. Con tipo variable esto no es un escenario remoto. ` +
            'Valora un tipo fijo, mas plazo, o directamente un precio mas bajo.',
        ),
      );
    }
  }

  return {
    techo: {
      id: 'T2',
      nombre: 'Techo financiero-fiscal',
      aplica: true,
      motivo_no_aplica: null,
      valor: traza({
        valor: t2,
        fuente: 'input usuario + config/itp.json + config/aranceles.json',
        fecha_dato: fecha_calculo,
        metodo: `min(ahorro, cuota); manda la restriccion de ${limitante}`,
        confianza: 'media',
        unidad: 'EUR',
        notas: [
          `Limita la restriccion de ${limitante}.`,
          `Gastos de compra estimados: ${gastos.total.toFixed(0)} EUR (${((gastos.total / t2) * 100).toFixed(1)}%).`,
        ],
      }),
      rango: null,
      desglose,
      avisos,
    },
    gastos,
  };
}

function techoNulo(motivo: string): Techo {
  return {
    id: 'T2',
    nombre: 'Techo financiero-fiscal',
    aplica: true,
    motivo_no_aplica: null,
    valor: null,
    rango: null,
    desglose: [],
    avisos: [
      aviso(
        'critico',
        'SIN_CAPACIDAD_DE_COMPRA',
        'No hay capacidad de compra con estos parametros',
        motivo,
      ),
    ],
  };
}
