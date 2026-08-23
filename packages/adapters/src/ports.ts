/**
 * Puertos de las fuentes de datos.
 *
 * Catastro y valor de referencia estan implementados (Fase 2). El resto siguen
 * siendo solo interfaces.
 *
 * Regla del proyecto para implementarlos: antes de escribir una
 * linea contra cualquiera de estas APIs hay que hacer una peticion real, guardar
 * la respuesta en fixtures/<fuente>/<caso>.json y programar contra esa respuesta.
 * Si un endpoint no responde o ha cambiado de dominio o de esquema, se para y se
 * avisa. No se mockea en silencio algo que parezca funcionar.
 */

import type {
  DatosAlquiler,
  PrecioM2Referencia,
  VariacionIPV,
} from '@vp/engine';

// ---------------------------------------------------------------------------
// Envoltorio comun
// ---------------------------------------------------------------------------

/** Metadatos de procedencia que todo adaptador debe devolver. */
export interface Procedencia {
  fuente: string;
  url: string | null;
  /** ISO. Fecha a la que se refiere el dato. */
  fecha_dato: string;
  /** ISO. Momento en que se obtuvo (o se leyo de cache). */
  obtenido_en: string;
  desde_cache: boolean;
}

export interface Respuesta<T> {
  datos: T;
  procedencia: Procedencia;
}

/** La fuente no responde, ha cambiado, o no cubre el ambito pedido. */
export class SourceUnavailableError extends Error {
  override readonly name = 'SourceUnavailableError';

  constructor(
    readonly fuente: string,
    readonly motivo: string,
    readonly url?: string,
  ) {
    super(`Fuente "${fuente}" no disponible: ${motivo}${url ? ` (${url})` : ''}`);
  }
}

/** La fuente responde pero no tiene dato para lo que se le pide. */
export class SinDatoError extends Error {
  override readonly name = 'SinDatoError';

  constructor(
    readonly fuente: string,
    readonly consulta: string,
  ) {
    super(`Fuente "${fuente}" sin dato para: ${consulta}`);
  }
}

/**
 * La fuente responde correctamente y rechaza la consulta: referencia mal
 * formada, parametro que falta. Es distinto de SinDatoError, donde la consulta
 * es valida pero no hay dato, y de SourceUnavailableError, donde el problema es
 * de la fuente. Aqui el error es de quien pregunta.
 */
export class ConsultaInvalidaError extends Error {
  override readonly name = 'ConsultaInvalidaError';

  constructor(
    readonly fuente: string,
    readonly codigo: string,
    readonly detalle: string,
  ) {
    super(`Fuente "${fuente}" rechaza la consulta [${codigo}]: ${detalle}`);
  }
}

// ---------------------------------------------------------------------------
// Catastro
// ---------------------------------------------------------------------------

/** Un anejo del inmueble: trastero, plaza de garaje, etc. */
export interface AnejoCatastral {
  /** Tal cual lo etiqueta el Catastro: 'ALMACEN', 'APARCAMIENTO', 'TERRAZA'... */
  tipo: string;
  superficie_m2: number;
  planta: string | null;
  puerta: string | null;
}

/**
 * Las superficies que publica el Catastro. Todas son CONSTRUIDAS: la superficie
 * util no es un dato catastral y no aparece por ningun lado (ADR-021).
 *
 * El reparto importa mucho. Ver ADR-022: el campo que parece "la superficie"
 * (debi.sfc) es en realidad la suma de vivienda + anejos + parte proporcional de
 * elementos comunes, y usarlo en T1 infla el techo de mercado.
 */
export interface SuperficiesCatastrales {
  /** debi.sfc. Total imputado al inmueble. NO es la superficie del piso. */
  total_m2: number | null;
  /** Elemento VIVIENDA de lcons: construida, sin comunes y sin anejos. */
  vivienda_m2: number | null;
  /** Parte proporcional de elementos comunes. */
  comunes_m2: number | null;
  /** vivienda + comunes. Equivale al TipoSuperficie 'construida_con_comunes'. */
  vivienda_con_comunes_m2: number | null;
  anejos: readonly AnejoCatastral[];
  /**
   * false si la suma del desglose no cuadra con total_m2. Cuando no cuadra hay
   * que mirar la ficha a mano en lugar de fiarse del reparto.
   */
  desglose_cuadra: boolean;
}

/** Ficha de inmueble segun los datos NO protegidos del Catastro. */
export interface FichaCatastral {
  /** 20 caracteres. */
  referencia_catastral: string;
  /** Los 14 primeros: identifican la parcela. */
  referencia_parcela: string;
  clase: 'urbana' | 'rustica' | null;
  uso_principal: string | null;
  anio_construccion: number | null;
  superficies: SuperficiesCatastrales;
  /**
   * Cuota de participacion en la comunidad, en TANTO POR UNO. El Catastro la
   * publica en porcentaje (cpt); el adaptador divide entre 100.
   */
  participacion: number | null;
  finca: {
    /** Literal del Catastro, p.ej. "Parcela con varios inmuebles (division horizontal)". */
    tipo: string | null;
    /** null = el literal no permite decidirlo. Un null avisa, no bloquea. */
    division_horizontal: boolean | null;
    superficie_suelo_m2: number | null;
    url_cartografia: string | null;
  };
  direccion: {
    literal: string | null;
    tipo_via: string | null;
    via: string | null;
    numero: string | null;
    escalera: string | null;
    planta: string | null;
    puerta: string | null;
    codigo_postal: string | null;
    municipio: string | null;
    /** 5 digitos (2 de provincia + 3 de municipio). La clave para cruzar con MITMA. */
    municipio_ine: string | null;
    /**
     * Codigo de municipio del CATASTRO (cmc), que no es el del INE. Castello de
     * la Plana es 900 en el Catastro y 040 en el INE. Con el se nombran los
     * datasets INSPIRE: provincia + cmc = 12900.
     */
    municipio_catastro: string | null;
    provincia: string | null;
    codigo_provincia_ine: string | null;
  };
}

/** Una linea del listado de inmuebles de una parcela. */
export interface InmuebleDeParcela {
  referencia_catastral: string;
  uso_principal: string | null;
  /** debi.sfc: total del inmueble, con anejos y comunes. */
  superficie_total_m2: number | null;
  anio_construccion: number | null;
  /** En tanto por uno. */
  participacion: number | null;
  escalera: string | null;
  planta: string | null;
  puerta: string | null;
  direccion_literal: string | null;
}

export interface ListadoParcela {
  referencia_parcela: string;
  total: number;
  inmuebles: readonly InmuebleDeParcela[];
}

/**
 * Una referencia de 14 caracteres puede designar una parcela con muchos
 * inmuebles o una finca unica. El Catastro devuelve una cosa u otra segun el
 * caso, asi que el adaptador no puede prometer siempre una ficha.
 */
export type ResultadoCatastro =
  | { tipo: 'inmueble'; ficha: FichaCatastral }
  | { tipo: 'parcela'; parcela: ListadoParcela };

export interface CoordenadasCatastro {
  lat: number;
  lon: number;
  srs: string;
  /** Las coordenadas son de la parcela, no del inmueble concreto. */
  referencia_parcela: string;
  direccion_literal: string | null;
}

export interface CatastroPort {
  /** Referencia de 20 caracteres (inmueble) o de 14 (parcela). */
  consultar(rc: string): Promise<Respuesta<ResultadoCatastro>>;
  /** Solo acepta referencia de parcela: el servicio rechaza las de 20. */
  coordenadasDe(referenciaParcela: string): Promise<Respuesta<CoordenadasCatastro>>;
  porCoordenadas(lat: number, lon: number): Promise<Respuesta<CoordenadasCatastro>>;
}

// ---------------------------------------------------------------------------
// Valor de referencia del Catastro (base imponible del ITP)
// ---------------------------------------------------------------------------

/**
 * COMPROBADO el 2026-08-22: la sede exige certificado electronico, DNIe o
 * Cl@ve para consultar el valor de referencia, incluso el de un inmueble
 * propio. No se rodea la autenticacion. La implementacion es manual: el
 * adaptador da el enlace y los pasos, y el usuario introduce la cifra que lee.
 */
export interface ValorReferenciaPort {
  readonly modo: 'manual' | 'automatico';
  /** Enlace directo a la sede y pasos, para el flujo manual. */
  instrucciones(rc: string): { url: string; pasos: readonly string[] };
  /**
   * En modo manual el unico argumento util es el que aporta el usuario. Sin el,
   * lanza en lugar de devolver un cero que parezca un dato.
   */
  obtener(
    rc: string,
    aportadoPorElUsuario?: { valor_referencia_eur: number; ejercicio: number; consultado_en: string },
  ): Promise<Respuesta<{ valor_referencia_eur: number; ejercicio: number }>>;
}

// ---------------------------------------------------------------------------
// Precios de mercado (cascada de T1)
// ---------------------------------------------------------------------------

/**
 * Notariado: EUR/m2 de escritura por codigo postal. El dato rey de T1, porque es
 * precio PAGADO y no de oferta ni de tasacion.
 *
 * COMPROBADO el 2026-08-23: el portal exige registro para las consultas
 * detalladas y no tiene API documentada, asi que el modo es manual. Ver
 * ADR-031.
 */
export interface NotariadoPort {
  readonly modo: "manual" | "automatico";
  /** Enlace y pasos para consultarlo a mano. */
  instrucciones(): { url: string; pasos: readonly string[] };
  porCodigoPostal(cp: string): Promise<Respuesta<PrecioM2Referencia>>;
}

/** MITMA serie 35103500: valor tasado de vivienda libre. Ingesta batch. */
export interface MitmaPort {
  porMunicipio(codigoIne: string): Promise<Respuesta<PrecioM2Referencia>>;
  porProvincia(codigoProvincia: string): Promise<Respuesta<PrecioM2Referencia>>;
}

/** INE: IPV por CCAA, para actualizar el dato base a fecha de hoy. */
export interface InePort {
  variacionIPV(ccaa: string, desde: string, hasta: string): Promise<Respuesta<VariacionIPV>>;
}

/**
 * Resuelve la cascada Notariado -> MITMA municipal -> MITMA provincial y deja
 * constancia de en que escalon se ha parado. La confianza de T1 depende de eso.
 */
export interface PrecioMercadoPort {
  resolver(params: {
    codigo_postal: string;
    municipio_ine: string | null;
    codigo_provincia: string;
  }): Promise<Respuesta<PrecioM2Referencia>>;
}

// ---------------------------------------------------------------------------
// Resto de fuentes
// ---------------------------------------------------------------------------

export interface GeocodingPort {
  inverso(lat: number, lon: number): Promise<Respuesta<{
    via: string | null;
    numero: string | null;
    codigo_postal: string | null;
    municipio: string | null;
    provincia: string | null;
  }>>;
}

export interface CeePort {
  porReferenciaCatastral(rc: string, ccaa: string): Promise<Respuesta<{
    letra_consumo: string;
    letra_emisiones: string | null;
    fecha_registro: string;
    numero_registro: string;
  }>>;
}

export interface SerpaviPort {
  rentaReferencia(params: {
    codigo_postal: string;
    municipio_ine: string | null;
    superficie_util_m2: number;
  }): Promise<Respuesta<DatosAlquiler>>;
}

export interface ZonasTensionadasPort {
  estaTensionado(municipioIne: string): Promise<Respuesta<{ tensionado: boolean; declarado_desde: string | null }>>;
}

export interface EuriborPort {
  ultimo12m(): Promise<Respuesta<{ valor: number; periodo: string }>>;
}
