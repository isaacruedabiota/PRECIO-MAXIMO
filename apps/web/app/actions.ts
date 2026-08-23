'use server';

/**
 * Acciones de servidor de la valoracion.
 *
 * Todo el I/O vive aqui: el Catastro, la base y la config. La pagina solo
 * presenta. Y el calculo lo hace el motor, que sigue siendo puro.
 *
 * El flujo es de dos pasos a proposito. Primero la referencia catastral, que
 * rellena sola media ficha; despues el formulario, que solo pregunta lo que el
 * Catastro no publica. Pedirlo todo de golpe haria teclear datos que ya
 * tenemos.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CatastroAdapter,
  ConsultaInvalidaError,
  ExpedienteIncompletoError,
  IneDbAdapter,
  MitmaDbAdapter,
  PrecioMercadoDbAdapter,
  SinDatoError,
  SinPrecioDeMercadoError,
  SourceUnavailableError,
  componerCalcInput,
  expedienteVacio,
} from '@vp/adapters';
import type { Expediente, FichaCatastral, ListadoParcela } from '@vp/adapters';
import { loadConfig } from '@vp/config';
import { MissingConfigError } from '@vp/config/values';
import { crearDb } from '@vp/db';
import { cargarEnv } from '@vp/db/env';
import { calcularPrecioMaximo } from '@vp/engine';
import type { AntiguedadParque, MaxPriceResult } from '@vp/engine';

export interface FichaEncontrada {
  estado: 'inmueble';
  ficha: FichaCatastral;
  /** Campos de PropertyInput que el Catastro no publica. */
  faltan: readonly string[];
  avisos: readonly string[];
  expediente: Expediente;
}

export interface ParcelaEncontrada {
  estado: 'parcela';
  parcela: ListadoParcela;
}

export interface ErrorDeBusqueda {
  estado: 'error';
  mensaje: string;
  /** Que puede hacer quien lo lee. Un error sin salida no ayuda. */
  sugerencia: string | null;
}

export type ResultadoBusqueda = FichaEncontrada | ParcelaEncontrada | ErrorDeBusqueda;

export type ResultadoCalculo =
  | { estado: 'ok'; resultado: MaxPriceResult; avisosEntrada: readonly string[] }
  | ErrorDeBusqueda;

/**
 * Antiguedad del parque desde el fixture que deja pnpm ingest:antiguedad.
 *
 * Todavia no esta en la base, asi que se lee del fichero. Si no esta, el motor
 * cae al respaldo global de config y avisa (ADR-015).
 */
function antiguedadParque(municipioCatastro: string): AntiguedadParque | null {
  // En desarrollo el cwd es apps/web y la raiz queda dos niveles arriba. En la
  // Pi el bundle standalone mueve las cosas, asi que se puede indicar con
  // VP_FIXTURES_DIR, igual que VP_CONFIG_DIR en ADR-006. Si no se encuentra, se
  // devuelve null y el motor avisa: no se inventa una antiguedad.
  const base =
    process.env['VP_FIXTURES_DIR'] ?? join(process.cwd(), '..', '..', 'fixtures');
  const ruta = join(base, 'catastro', `${municipioCatastro}-antiguedad-parque.json`);
  if (!existsSync(ruta)) return null;
  const j = JSON.parse(readFileSync(ruta, 'utf8')) as {
    municipio: string;
    fuente: string;
    url_atom: string;
    fecha_dataset_gml: string;
    parque_de_mas_de_5_anios: { viviendas_computadas: number; edad_media_anios: number };
  };
  return {
    edad_media_anios: j.parque_de_mas_de_5_anios.edad_media_anios,
    ambito: 'municipio',
    fuente: `${j.fuente} (${j.municipio})`,
    fuente_url: j.url_atom,
    fecha_dato: j.fecha_dataset_gml,
    n_viviendas: j.parque_de_mas_de_5_anios.viviendas_computadas,
  };
}

/** Traduce un fallo en algo que se pueda leer y, si se puede, arreglar. */
function comoError(e: unknown): ErrorDeBusqueda {
  if (e instanceof ConsultaInvalidaError) {
    return { estado: 'error', mensaje: e.detalle, sugerencia: null };
  }
  if (e instanceof ExpedienteIncompletoError) {
    return { estado: 'error', mensaje: e.message, sugerencia: null };
  }
  if (e instanceof SinPrecioDeMercadoError) {
    return {
      estado: 'error',
      mensaje: e.message,
      sugerencia: 'Falta ingestar los precios: pnpm ingest:municipios && pnpm ingest:mitma',
    };
  }
  if (e instanceof MissingConfigError) {
    return {
      estado: 'error',
      mensaje: `Falta un valor de configuracion: ${e.message}`,
      sugerencia: 'Revisalo con: pnpm config:check',
    };
  }
  if (e instanceof SinDatoError) {
    return { estado: 'error', mensaje: e.message, sugerencia: null };
  }
  if (e instanceof SourceUnavailableError) {
    return {
      estado: 'error',
      mensaje: e.message,
      sugerencia: 'La fuente no responde. No se inventa un dato: vuelve a intentarlo mas tarde.',
    };
  }
  return {
    estado: 'error',
    mensaje: e instanceof Error ? e.message : 'Error inesperado',
    sugerencia: null,
  };
}

/** Paso 1: la referencia catastral. */
export async function buscarFicha(referenciaCatastral: string): Promise<ResultadoBusqueda> {
  try {
    const { config } = loadConfig();
    const respuesta = await new CatastroAdapter().consultar(referenciaCatastral);

    if (respuesta.datos.tipo === 'parcela') {
      return { estado: 'parcela', parcela: respuesta.datos.parcela };
    }

    const ficha = respuesta.datos.ficha;
    const { fichaAPropertyInput } = await import('@vp/adapters');
    const puente = fichaAPropertyInput(ficha, config);

    return {
      estado: 'inmueble',
      ficha,
      faltan: puente.faltan,
      avisos: puente.avisos,
      expediente: expedienteVacio(ficha.referencia_catastral),
    };
  } catch (e) {
    return comoError(e);
  }
}

/** Paso 2: el expediente completo. */
export async function calcular(expediente: Expediente): Promise<ResultadoCalculo> {
  try {
    // Next carga el .env de apps/web, no el de la raiz del monorepo, asi que
    // sin esto DATABASE_URL no llega y la accion revienta en local. En la Pi la
    // cadena viene de /etc/vp/vp-web.env via systemd, y cargarEnv respeta el
    // entorno real por encima del fichero.
    cargarEnv();

    const { config } = loadConfig();
    const db = crearDb();
    const mitma = new MitmaDbAdapter(db);

    const { input, avisos } = await componerCalcInput(
      expediente,
      config,
      {
        catastro: new CatastroAdapter(),
        precios: new PrecioMercadoDbAdapter(mitma),
        ipv: new IneDbAdapter(db, 'segunda_mano'),
        antiguedadParque,
      },
      new Date().toISOString().slice(0, 10),
    );

    return { estado: 'ok', resultado: calcularPrecioMaximo(input), avisosEntrada: avisos };
  } catch (e) {
    return comoError(e);
  }
}
