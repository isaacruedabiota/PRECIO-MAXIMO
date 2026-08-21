/**
 * Puertos de las fuentes de datos.
 *
 * FASE 0: solo interfaces. Ninguna implementacion.
 *
 * Regla del proyecto para implementarlos (Fases 2 y 3): antes de escribir una
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

// ---------------------------------------------------------------------------
// Catastro
// ---------------------------------------------------------------------------

/** Ficha de inmueble segun los datos NO protegidos del Catastro. */
export interface FichaCatastral {
  referencia_catastral: string;
  /** El Catastro da construida, nunca util. Ojo al usarla en T1. */
  superficie_construida_m2: number | null;
  anio_construccion: number | null;
  uso_principal: string | null;
  /** Cuota de participacion en la comunidad, en tanto por uno. */
  participacion: number | null;
  direccion: {
    via: string | null;
    numero: string | null;
    escalera: string | null;
    planta: string | null;
    puerta: string | null;
    codigo_postal: string | null;
    municipio: string | null;
    provincia: string | null;
  };
  coordenadas: { lat: number; lon: number; srs: string } | null;
}

export interface CatastroPort {
  porReferenciaCatastral(rc: string): Promise<Respuesta<FichaCatastral>>;
  porCoordenadas(lat: number, lon: number): Promise<Respuesta<FichaCatastral>>;
}

// ---------------------------------------------------------------------------
// Valor de referencia del Catastro (base imponible del ITP)
// ---------------------------------------------------------------------------

/**
 * No se rodea la autenticacion. Si la sede exige certificado digital para un
 * inmueble ajeno, la implementacion sera 'manual': el usuario lo consulta y lo
 * introduce, y el adaptador solo guarda el dato con su fecha.
 */
export interface ValorReferenciaPort {
  readonly modo: 'manual' | 'automatico';
  /** Enlace directo a la sede y pasos, para el flujo manual. */
  instrucciones(rc: string): { url: string; pasos: readonly string[] };
  obtener(rc: string): Promise<Respuesta<{ valor_referencia_eur: number; ejercicio: number }>>;
}

// ---------------------------------------------------------------------------
// Precios de mercado (cascada de T1)
// ---------------------------------------------------------------------------

/** Notariado: EUR/m2 de escritura por codigo postal. El dato rey de T1. */
export interface NotariadoPort {
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
