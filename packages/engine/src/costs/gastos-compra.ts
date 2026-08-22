import type { EngineConfig, ItpCcaa, TipoReducido } from '@vp/config/schemas';
import { MissingConfigError, leerValor, requerido } from '@vp/config/values';

import { aviso } from '../trace';
import type { Aviso, BuyerProfile, PropertyInput } from '../types';
import { arancelEscalado } from './arancel';

/**
 * Gastos de una compraventa, en funcion del precio.
 *
 * No es proporcional al precio: los aranceles van por tramos y la base
 * imponible del impuesto tiene un codo. De ahi que T2 se resuelva por
 * biseccion.
 */

export interface DesgloseGastos {
  /** Segunda mano. 0 en obra nueva. */
  itp: number;
  /** Obra nueva. 0 en segunda mano. */
  iva: number;
  ajd: number;
  notaria: number;
  registro: number;
  gestoria: number;
  tasacion: number;
  nota_simple: number;
  total: number;

  base_imponible_impuesto: number;
  /**
   * true si la base imponible la fija el valor de referencia catastral y no el
   * precio negociado. Consecuencia directa de la Ley 11/2021 y una de las cosas
   * que mas dinero descoloca en una compra: pagas impuesto sobre un valor
   * superior al que has pagado de verdad.
   */
  manda_valor_referencia: boolean;
  tipo_aplicado: number;
  modalidad: string;
}

export interface ContextoGastos {
  property: PropertyInput;
  buyer: BuyerProfile;
  config: EngineConfig;
}

/**
 * Base imponible del impuesto de transmisiones.
 *
 *   base = max(precio escriturado, valor de referencia catastral)
 *
 * Desde la Ley 11/2021 la base imponible en transmisiones de inmuebles es el
 * valor de referencia del Catastro, salvo que el precio escriturado sea
 * superior. Si el valor de referencia esta por encima del precio que negocias,
 * pagas ITP sobre el valor de referencia.
 */
export function baseImponibleITP(
  precio: number,
  valorReferencia: number | null,
): { base: number; mandaValorReferencia: boolean } {
  if (valorReferencia === null) {
    return { base: precio, mandaValorReferencia: false };
  }
  return valorReferencia > precio
    ? { base: valorReferencia, mandaValorReferencia: true }
    : { base: precio, mandaValorReferencia: false };
}

interface TipoResuelto {
  tipo: number;
  modalidad: string;
  avisos: readonly Aviso[];
}

function bloqueCcaa(config: EngineConfig, ccaa: string): ItpCcaa {
  const bloque = config.itp.ccaa.find((c) => c.ccaa === ccaa);
  if (bloque === undefined) {
    throw new MissingConfigError(
      `itp.ccaa[ccaa="${ccaa}"]`,
      `No hay bloque de ITP para esta comunidad. Comunidades configuradas: ` +
        `${config.itp.ccaa.map((c) => c.ccaa).join(', ')}.`,
    );
  }
  return bloque;
}

/**
 * Resuelve el tipo de ITP aplicable al perfil del comprador.
 *
 * Ante la duda se aplica el tipo menos favorable. Un techo de precio calculado
 * sobre una bonificacion que luego no te conceden te lleva a ofrecer de mas, y
 * eso es un error caro; al reves solo deja margen de sobra. Cada descarte por
 * falta de dato deja aviso para que se pueda comprobar.
 */
export function resolverTipoITP(
  ctx: ContextoGastos,
  baseImponible: number,
): TipoResuelto {
  const { property, buyer, config } = ctx;
  const bloque = bloqueCcaa(config, property.localizacion.ccaa);
  const avisos: Aviso[] = [];
  const rutaCcaa = `itp.ccaa[ccaa="${bloque.ccaa}"]`;

  const aplicables: { tipo: number; nombre: string }[] = [];

  for (const [i, reducido] of bloque.tipos_reducidos.entries()) {
    const ruta = `${rutaCcaa}.tipos_reducidos[${i}]`;

    // El codigo puede llevar sufijo de tramo de valor (p. ej. _alto_valor):
    // la modalidad de fondo es la misma y lo que cambia es el tipo.
    const modalidad = reducido.codigo.replace(/_alto_valor$/, '');

    let cumplePerfil: boolean;
    switch (modalidad) {
      case 'joven_primera_vivienda': {
        if (!buyer.primera_vivienda_habitual) {
          cumplePerfil = false;
          break;
        }
        const limiteEdad = requerido(
          reducido.limite_edad,
          `${ruta}.limite_edad`,
          `Sin la edad limite no se puede decidir si a un comprador de ${buyer.edad} anos le aplica ` +
            `"${reducido.nombre}". Varia por comunidad: hay que mirarla en el boletin autonomico.`,
        );
        cumplePerfil = buyer.edad < limiteEdad;
        break;
      }
      case 'familia_numerosa':
        cumplePerfil = buyer.familia_numerosa !== 'no';
        break;
      case 'discapacidad':
        cumplePerfil = buyer.discapacidad_reconocida;
        break;
      case 'vpo':
        cumplePerfil = property.es_vpo === true;
        break;
      default:
        cumplePerfil = false;
    }

    if (!cumplePerfil) continue;

    // Tramo de valor del inmueble. Las bonificaciones suelen partirse en dos
    // por valor, y los dos tramos son excluyentes.
    if (reducido.limite_valor_inmueble !== null && baseImponible > reducido.limite_valor_inmueble) continue;
    if (reducido.valor_inmueble_desde !== null && baseImponible <= reducido.valor_inmueble_desde) continue;

    // Limite de renta, que depende del regimen de declaracion y, en familia
    // numerosa, tambien de la categoria.
    const limite = limiteDeRenta(reducido, buyer);
    if (limite !== null) {
      if (buyer.base_imponible_irpf_anual === null) {
        avisos.push(
          aviso(
            'critico',
            'BONIFICACION_SIN_COMPROBAR_RENTA',
            `Puede que te aplique "${reducido.nombre}"`,
            `Esa modalidad exige una base liquidable de IRPF no superior a ${limite} EUR en tributacion ` +
              `${buyer.tributacion_irpf}, y no has indicado la tuya. Se ha calculado con el tipo menos ` +
              'favorable. Si cumples, tu techo real es mas alto: rellena tu base imponible.',
          ),
        );
        continue;
      }
      if (buyer.base_imponible_irpf_anual > limite) continue;
    }

    const tipo = requerido(
      reducido.tipo,
      `${ruta}.tipo`,
      `La modalidad "${reducido.nombre}" aplica a este comprador pero su tipo sigue a null. ` +
        'config:seed no lo siembra: es un dato oficial que hay que contrastar en el boletin autonomico.',
    );
    aplicables.push({ tipo, nombre: reducido.nombre });

    if (!reducido.verificado) {
      avisos.push(
        aviso(
          'critico',
          'TIPO_ITP_SIN_VERIFICAR',
          `El tipo de "${reducido.nombre}" no esta verificado`,
          `Se ha aplicado un ${(tipo * 100).toFixed(2)}% sin contrastar contra el boletin oficial. ` +
            'En un piso de 200.000 EUR, un punto de diferencia son 2.000 EUR.',
          'Ley 11/2021 y normativa autonomica del ITPAJD',
        ),
      );
    }
  }

  if (aplicables.length > 0) {
    // El comprador puede acogerse a la mas favorable de las que cumple.
    const mejor = aplicables.reduce((a, b) => (b.tipo < a.tipo ? b : a));
    return { tipo: mejor.tipo, modalidad: mejor.nombre, avisos };
  }

  const general = tipoGeneralPorValor(bloque, baseImponible, rutaCcaa);

  if (!bloque.verificado) {
    avisos.push(
      aviso(
        'critico',
        'TIPO_ITP_SIN_VERIFICAR',
        'El tipo general de ITP no esta verificado',
        `Se ha aplicado el ${(general * 100).toFixed(2)}% de ${bloque.ccaa} sin contrastar contra el ` +
          'boletin oficial.',
        'Ley 11/2021 y normativa autonomica del ITPAJD',
      ),
    );
  }

  return { tipo: general, modalidad: `Tipo general de ${bloque.ccaa}`, avisos };
}

/**
 * Tipo general aplicable segun el valor del inmueble.
 *
 * No es una escala progresiva: el tipo del tramo se aplica al total de la base.
 * En la Comunitat Valenciana, por ejemplo, es el 9 % hasta un millon de euros y
 * el 11 % por encima, sobre el importe entero.
 */
function tipoGeneralPorValor(bloque: ItpCcaa, baseImponible: number, rutaCcaa: string): number {
  const tramos = bloque.tipo_general.tramos;
  if (tramos.length === 0) {
    throw new MissingConfigError(
      `${rutaCcaa}.tipo_general.tramos`,
      'Tipo general de ITP de la comunidad. Es el dato mas caro de equivocar de toda la herramienta: ' +
        'un punto de error son 2.000 EUR en un piso de 200.000.',
    );
  }

  const tramo = tramos.find(
    (t) => baseImponible > t.desde && (t.hasta === null || baseImponible <= t.hasta),
  );

  if (tramo === undefined) {
    throw new MissingConfigError(
      `${rutaCcaa}.tipo_general.tramos`,
      `Ningun tramo cubre una base imponible de ${baseImponible.toFixed(0)} EUR. Los tramos configurados ` +
        `van de ${tramos[0]?.desde ?? '?'} en adelante y dejan un hueco.`,
    );
  }

  return tramo.tipo;
}

/**
 * Limite de base liquidable aplicable, resuelto por regimen de declaracion y,
 * en familia numerosa, por categoria.
 */
function limiteDeRenta(reducido: TipoReducido, buyer: BuyerProfile): number | null {
  const especial = (reducido as { limite_base_imponible_irpf_categoria_especial?: unknown })
    .limite_base_imponible_irpf_categoria_especial;

  const bloque =
    buyer.familia_numerosa === 'especial' && esLimiteRenta(especial)
      ? especial
      : reducido.limite_base_imponible_irpf;

  if (bloque === null || bloque === undefined) return null;
  return buyer.tributacion_irpf === 'conjunta' ? bloque.conjunta : bloque.individual;
}

function esLimiteRenta(v: unknown): v is { individual: number | null; conjunta: number | null } {
  return typeof v === 'object' && v !== null && 'individual' in v && 'conjunta' in v;
}

/** Gastos totales de compra para un precio dado. */
export function calcularGastosCompra(
  precio: number,
  ctx: ContextoGastos,
): { gastos: DesgloseGastos; avisos: readonly Aviso[] } {
  const { property, config } = ctx;
  const ar = config.aranceles;
  const avisos: Aviso[] = [];

  const { base, mandaValorReferencia } = baseImponibleITP(precio, property.valor_referencia_catastral);

  let itp = 0;
  let iva = 0;
  let ajd = 0;
  let tipoAplicado: number;
  let modalidad: string;

  if (property.es_obra_nueva) {
    // Primera transmision: IVA estatal + AJD autonomico, no ITP.
    const bloque = bloqueCcaa(config, property.localizacion.ccaa);
    const tipoIva = requerido(
      config.itp.obra_nueva.iva_vivienda,
      'itp.obra_nueva.iva_vivienda',
      'Tipo de IVA de vivienda de obra nueva.',
    );
    // El AJD reducido pide vivienda habitual a secas, no que sea la primera.
    const rutaAjd = `itp.ccaa[ccaa="${bloque.ccaa}"].tipo_ajd_obra_nueva`;
    const tipoAjd = ctx.buyer.sera_vivienda_habitual
      ? requerido(
          bloque.tipo_ajd_obra_nueva.vivienda_habitual,
          `${rutaAjd}.vivienda_habitual`,
          'Tipo de AJD para adquisicion de vivienda habitual.',
        )
      : requerido(
          bloque.tipo_ajd_obra_nueva.general,
          `${rutaAjd}.general`,
          'Tipo general de AJD de la comunidad.',
        );
    iva = precio * tipoIva;
    ajd = precio * tipoAjd;
    tipoAplicado = tipoIva + tipoAjd;
    modalidad = `Obra nueva: IVA ${(tipoIva * 100).toFixed(0)}% + AJD ${(tipoAjd * 100).toFixed(2)}%`;
  } else {
    const resuelto = resolverTipoITP(ctx, base);
    itp = base * resuelto.tipo;
    tipoAplicado = resuelto.tipo;
    modalidad = resuelto.modalidad;
    avisos.push(...resuelto.avisos);
  }

  if (mandaValorReferencia) {
    const exceso = base - precio;
    avisos.push(
      aviso(
        'critico',
        'VALOR_REFERENCIA_MANDA',
        'Pagaras impuesto sobre el valor de referencia, no sobre lo que pagas',
        `El valor de referencia del Catastro (${base.toFixed(0)} EUR) supera el precio de ` +
          `${precio.toFixed(0)} EUR en ${exceso.toFixed(0)} EUR. La base imponible del impuesto es el valor de ` +
          `referencia, asi que el sobrecoste fiscal es de ${(exceso * tipoAplicado).toFixed(0)} EUR. ` +
          'Bajar el precio negociado por debajo de este punto no reduce el impuesto.',
        'Ley 11/2021, art. 10 del texto refundido del ITPAJD',
      ),
    );
  } else if (property.valor_referencia_catastral === null) {
    avisos.push(
      aviso(
        'critico',
        'SIN_VALOR_REFERENCIA',
        'No se ha comprobado el valor de referencia del Catastro',
        'La base imponible del impuesto es el mayor entre el precio y el valor de referencia catastral. ' +
          'Sin ese dato el impuesto se ha calculado sobre el precio, y podria salir mas caro. ' +
          'Consultalo en la sede del Catastro e introducelo antes de hacer una oferta.',
        'Ley 11/2021, art. 10 del texto refundido del ITPAJD',
      ),
    );
  }

  const notaria =
    arancelEscalado(precio, ar.notaria, 'aranceles.notaria') +
    leerValor(ar.notaria.suplidos_y_copias, 'aranceles.notaria.suplidos_y_copias');
  const registro = arancelEscalado(precio, ar.registro, 'aranceles.registro');
  const gestoria = leerValor(ar.gestoria, 'aranceles.gestoria');
  const tasacion = leerValor(ar.tasacion, 'aranceles.tasacion');
  const notaSimple = leerValor(ar.nota_simple, 'aranceles.nota_simple');

  const hipotecaAlComprador = requerido(
    ar.gastos_hipoteca_a_cargo_del_comprador.aplica,
    'aranceles.gastos_hipoteca_a_cargo_del_comprador.aplica',
    'Desde la Ley 5/2019 los gastos de la hipoteca (notaria, registro, gestoria y AJD del prestamo) los ' +
      'paga el prestamista. Hay que confirmarlo y ponerlo en true o false: de ello dependen varios miles de euros.',
  );
  if (hipotecaAlComprador) {
    avisos.push(
      aviso(
        'atencion',
        'GASTOS_HIPOTECA_AL_COMPRADOR',
        'Los gastos de la hipoteca se te estan imputando a ti',
        'La configuracion dice que los gastos de constitucion de la hipoteca los asume el comprador. ' +
          'Desde la Ley 5/2019 de credito inmobiliario deberia asumirlos el prestamista: revisalo.',
        'Ley 5/2019 reguladora de los contratos de credito inmobiliario',
      ),
    );
  }

  const total = itp + iva + ajd + notaria + registro + gestoria + tasacion + notaSimple;

  return {
    gastos: {
      itp,
      iva,
      ajd,
      notaria,
      registro,
      gestoria,
      tasacion,
      nota_simple: notaSimple,
      total,
      base_imponible_impuesto: base,
      manda_valor_referencia: mandaValorReferencia,
      tipo_aplicado: tipoAplicado,
      modalidad,
    },
    avisos,
  };
}
