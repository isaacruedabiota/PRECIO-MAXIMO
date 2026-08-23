/**
 * Traduce la respuesta cruda de Consulta_DNPRC al modelo del proyecto.
 *
 * Es una funcion pura y sin red: se prueba entera contra los fixtures de
 * fixtures/catastro/. Toda la fontaneria HTTP vive en catastro-adapter.ts.
 */

import { ConsultaInvalidaError, SinDatoError } from '../ports';
import type {
  AnejoCatastral,
  FichaCatastral,
  InmuebleDeParcela,
  ResultadoCatastro,
  SuperficiesCatastrales,
} from '../ports';
import type {
  BicoCrudo,
  ConstruccionCruda,
  DireccionUrbanaCruda,
  ErrorCrudo,
  InmuebleParcelaCrudo,
  RcCruda,
  RespuestaDnprc,
} from './respuesta-dnprc';

export const FUENTE_CATASTRO = 'Catastro - Oficina Virtual (Consulta_DNPRC)';

/**
 * Codigos de error del servicio que significan "la pregunta esta mal", frente a
 * "no hay dato". Comprobado: el 4 lo devuelve una referencia mal formada.
 */
const CODIGOS_CONSULTA_INVALIDA = new Set(['4', '17', '18', '75']);

/** El elemento constructivo que es la vivienda propiamente dicha. */
const LCD_VIVIENDA = 'VIVIENDA';
/** El elemento que recoge la parte proporcional de zonas comunes. */
const LCD_COMUNES = 'ELEMENTOS COMUNES';

// ---------------------------------------------------------------------------
// Utilidades de lectura
// ---------------------------------------------------------------------------

function lista<T>(v: readonly T[] | T | undefined): readonly T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? (v as readonly T[]) : [v as T];
}

function texto(v: string | undefined): string | null {
  if (v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** El Catastro manda los numeros como cadena. Un no-numero es null, no un 0. */
function numero(v: string | undefined): number | null {
  const t = texto(v);
  if (t === null) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * La cuota de participacion viene en porcentaje y con coma decimal ("3,980000").
 * El modelo la quiere en tanto por uno. Comprobado sobre la parcela
 * 2004930YK5320S: las 27 cuotas suman 100,000000 exacto.
 */
function participacion(cpt: string | undefined): number | null {
  const n = numero(cpt);
  return n === null ? null : n / 100;
}

function montarRc(rc: RcCruda | undefined): string | null {
  if (rc === undefined) return null;
  const partes = [rc.pc1, rc.pc2, rc.car, rc.cc1, rc.cc2].map((p) => p ?? '');
  const s = partes.join('');
  return s === '' ? null : s;
}

function referenciaParcela(rc: RcCruda | undefined): string | null {
  if (rc === undefined) return null;
  const s = `${rc.pc1 ?? ''}${rc.pc2 ?? ''}`;
  return s === '' ? null : s;
}

/**
 * El Catastro da provincia y municipio por separado, en codigo INE de 2 y 3
 * digitos. Concatenados forman el codigo de municipio de 5 con el que se cruza
 * con MITMA. Comprobado: Castello de la Plana sale 12 + 040 = 12040.
 */
function municipioIne(cp: string | undefined, cm: string | undefined): string | null {
  const p = texto(cp);
  const m = texto(cm);
  if (p === null || m === null) return null;
  return `${p.padStart(2, '0')}${m.padStart(3, '0')}`;
}

/**
 * El literal de tipo de finca es la unica pista sobre la division horizontal, y
 * de ahi depende un bloqueante del motor. Solo se decide cuando el texto lo dice
 * sin ambiguedad; si no, null, que genera aviso y no bloqueo.
 *
 * El Catastro no es consistente con las tildes: dice "(division horizontal)" sin
 * tilde en 2004930YK5320S0009RH y "sin division horizontal" CON tilde en
 * 0000902YK5300S. Por eso se contemplan las dos grafias.
 */
export function leerDivisionHorizontal(ltp: string | null): boolean | null {
  if (ltp === null) return null;
  const t = ltp.toLowerCase();
  if (!t.includes('division horizontal') && !t.includes('división horizontal')) return null;
  return !t.includes('sin division horizontal') && !t.includes('sin división horizontal');
}

// ---------------------------------------------------------------------------
// Superficies
// ---------------------------------------------------------------------------

/**
 * Reparte el desglose constructivo en vivienda, comunes y anejos.
 *
 * ADR-022: debi.sfc NO es la superficie del piso. En el fixture del caso base
 * vale 155 m2 y se reparte en 101 de vivienda, 6 de trastero, 26 de garaje y 22
 * de elementos comunes. Llevar esos 155 a T1 como si fueran la superficie del
 * piso infla el techo de mercado un 53%.
 */
export function repartirSuperficies(
  total: number | null,
  lcons: readonly ConstruccionCruda[],
): SuperficiesCatastrales {
  let vivienda: number | null = null;
  let comunes: number | null = null;
  const anejos: AnejoCatastral[] = [];
  let sumaDesglose = 0;
  let hayDesglose = false;

  for (const c of lcons) {
    const m2 = numero(c.dfcons?.stl);
    if (m2 === null) continue;
    hayDesglose = true;
    sumaDesglose += m2;

    const etiqueta = (texto(c.lcd) ?? '').toUpperCase();
    const loint = c.dt?.lourb?.loint;

    if (etiqueta === LCD_VIVIENDA) {
      // Un inmueble puede tener mas de un elemento VIVIENDA (duplex contados
      // por planta): se acumulan en lugar de quedarse con el ultimo.
      vivienda = (vivienda ?? 0) + m2;
    } else if (etiqueta === LCD_COMUNES) {
      comunes = (comunes ?? 0) + m2;
    } else {
      anejos.push({
        tipo: etiqueta,
        superficie_m2: m2,
        planta: texto(loint?.pt),
        puerta: texto(loint?.pu),
      });
    }
  }

  const viviendaConComunes =
    vivienda === null ? null : vivienda + (comunes ?? 0);

  // Un metro de holgura absorbe el redondeo del Catastro sin tapar un desglose
  // que de verdad no cuadre.
  const cuadra =
    !hayDesglose || total === null ? false : Math.abs(sumaDesglose - total) <= 1;

  return {
    total_m2: total,
    vivienda_m2: vivienda,
    comunes_m2: comunes,
    vivienda_con_comunes_m2: viviendaConComunes,
    anejos,
    desglose_cuadra: cuadra,
  };
}

// ---------------------------------------------------------------------------
// Ficha
// ---------------------------------------------------------------------------

function direccionDe(
  urb: DireccionUrbanaCruda | undefined,
): Pick<
  FichaCatastral['direccion'],
  'tipo_via' | 'via' | 'numero' | 'escalera' | 'planta' | 'puerta' | 'codigo_postal'
> {
  return {
    tipo_via: texto(urb?.dir?.tv),
    via: texto(urb?.dir?.nv),
    numero: texto(urb?.dir?.pnp),
    escalera: texto(urb?.loint?.es),
    planta: texto(urb?.loint?.pt),
    puerta: texto(urb?.loint?.pu),
    codigo_postal: texto(urb?.dp),
  };
}

function parsearFicha(bico: BicoCrudo): FichaCatastral {
  const bi = bico.bi ?? {};
  const dt = bi.dt ?? {};
  const rc = montarRc(bi.idbi?.rc);
  if (rc === null) {
    throw new SinDatoError(FUENTE_CATASTRO, 'la respuesta no trae referencia catastral');
  }

  // Un inmueble urbano trae la direccion en locs.lous.lourb; uno rustico la trae
  // en locs.lors.lourb, y a veces solo tiene lorus (paraje, poligono, parcela).
  const urb = dt.locs?.lous?.lourb ?? dt.locs?.lors?.lourb;

  const clase = texto(bi.idbi?.cn);
  const tipoFinca = texto(bico.finca?.ltp);

  return {
    referencia_catastral: rc,
    referencia_parcela: referenciaParcela(bi.idbi?.rc) ?? rc.slice(0, 14),
    clase: clase === 'UR' ? 'urbana' : clase === 'RU' ? 'rustica' : null,
    uso_principal: texto(bi.debi?.luso),
    anio_construccion: numero(bi.debi?.ant),
    superficies: repartirSuperficies(numero(bi.debi?.sfc), lista(bico.lcons)),
    participacion: participacion(bi.debi?.cpt),
    finca: {
      tipo: tipoFinca,
      division_horizontal: leerDivisionHorizontal(tipoFinca),
      superficie_suelo_m2: numero(bico.finca?.dff?.ss),
      url_cartografia: texto(bico.finca?.infgraf?.igraf),
    },
    direccion: {
      literal: texto(bi.ldt),
      ...direccionDe(urb),
      municipio: texto(dt.nm),
      municipio_ine: municipioIne(dt.loine?.cp, dt.loine?.cm),
      municipio_catastro: texto(dt.cmc),
      provincia: texto(dt.np),
      codigo_provincia_ine: texto(dt.loine?.cp),
    },
  };
}

// ---------------------------------------------------------------------------
// Listado de parcela
// ---------------------------------------------------------------------------

function parsearInmuebleDeParcela(u: InmuebleParcelaCrudo): InmuebleDeParcela | null {
  const rc = montarRc(u.rc);
  if (rc === null) return null;
  const urb = u.dt?.locs?.lous?.lourb ?? u.dt?.locs?.lors?.lourb;
  return {
    referencia_catastral: rc,
    uso_principal: texto(u.debi?.luso),
    superficie_total_m2: numero(u.debi?.sfc),
    anio_construccion: numero(u.debi?.ant),
    participacion: participacion(u.debi?.cpt),
    escalera: texto(urb?.loint?.es),
    planta: texto(urb?.loint?.pt),
    puerta: texto(urb?.loint?.pu),
    direccion_literal: texto(u.ldt),
  };
}

// ---------------------------------------------------------------------------
// Entrada publica
// ---------------------------------------------------------------------------

function lanzarSiHayError(errores: readonly ErrorCrudo[], consulta: string): void {
  if (errores.length === 0) return;
  const primero = errores[0] ?? {};
  const cod = texto(primero.cod) ?? 'sin-codigo';
  const des = texto(primero.des) ?? 'sin descripcion';
  if (CODIGOS_CONSULTA_INVALIDA.has(cod)) {
    throw new ConsultaInvalidaError(FUENTE_CATASTRO, cod, des);
  }
  throw new SinDatoError(FUENTE_CATASTRO, `${consulta} [${cod}] ${des}`);
}

export function parsearDnprc(cruda: RespuestaDnprc, consulta: string): ResultadoCatastro {
  const r = cruda.consulta_dnprcResult;
  if (r === undefined) {
    // Ni resultado ni error: el esquema ha cambiado. Se para, no se adivina.
    throw new SinDatoError(
      FUENTE_CATASTRO,
      `${consulta}: la respuesta no trae consulta_dnprcResult`,
    );
  }

  lanzarSiHayError(lista(r.lerr), consulta);

  if (r.bico !== undefined) {
    return { tipo: 'inmueble', ficha: parsearFicha(r.bico) };
  }

  const filas = lista(r.lrcdnp?.rcdnp);
  if (filas.length > 0) {
    const inmuebles = filas
      .map(parsearInmuebleDeParcela)
      .filter((x): x is InmuebleDeParcela => x !== null);
    const primera = inmuebles[0]?.referencia_catastral ?? '';
    return {
      tipo: 'parcela',
      parcela: {
        referencia_parcela: primera.slice(0, 14),
        total: r.control?.cudnp ?? inmuebles.length,
        inmuebles,
      },
    };
  }

  throw new SinDatoError(FUENTE_CATASTRO, consulta);
}
