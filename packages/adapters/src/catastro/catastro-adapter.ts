/**
 * Adaptador del Catastro contra los servicios libres de la Oficina Virtual.
 *
 * Endpoints comprobados con peticion real el 2026-08-22 y guardados en
 * fixtures/catastro/. Dos correcciones al brief:
 *
 *   - El host es ovc.catastro.meh.es. catastro.hacienda.gob.es sirve el portal
 *     y el INSPIRE, pero no resuelve para ovc: los servicios web siguen en meh.
 *   - El parametro de Consulta_DNPRC es RefCat, no RC.
 *
 * Toda la traduccion vive en parsear-dnprc.ts y parsear-coordenadas.ts, que son
 * puros. Aqui solo hay HTTP.
 */

import { SourceUnavailableError, ConsultaInvalidaError } from '../ports';
import type {
  CatastroPort,
  CoordenadasCatastro,
  Procedencia,
  Respuesta,
  ResultadoCatastro,
} from '../ports';
import { parsearCoordenadas } from './parsear-coordenadas';
import { FUENTE_CATASTRO, parsearDnprc } from './parsear-dnprc';
import type { RespuestaDnprc } from './respuesta-dnprc';

const BASE_CALLEJERO =
  'https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCallejero.svc/json';
const BASE_LOCALIZACION =
  'https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx';

const LONGITUD_PARCELA = 14;
const LONGITUD_INMUEBLE = 20;

export interface OpcionesCatastro {
  /** Milisegundos. Por defecto 20.000. */
  timeoutMs?: number;
  /** Inyectable para tests. Por defecto el fetch global. */
  fetchImpl?: typeof fetch;
  /** Inyectable para tests: momento de la peticion. */
  ahora?: () => Date;
}

/**
 * Normaliza una referencia catastral: sin espacios, en mayusculas.
 * Valida la longitud aqui para no gastar una peticion en algo que el servicio
 * va a rechazar, y para dar un mensaje mejor que el suyo.
 */
export function normalizarRc(rc: string): string {
  const limpia = rc.replace(/[\s.-]/g, '').toUpperCase();
  if (limpia.length !== LONGITUD_PARCELA && limpia.length !== LONGITUD_INMUEBLE) {
    throw new ConsultaInvalidaError(
      FUENTE_CATASTRO,
      'longitud',
      `"${rc}" tiene ${limpia.length} caracteres. Una referencia catastral tiene ` +
        `${LONGITUD_PARCELA} (parcela) o ${LONGITUD_INMUEBLE} (inmueble).`,
    );
  }
  return limpia;
}

export class CatastroAdapter implements CatastroPort {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly ahora: () => Date;

  constructor(opciones: OpcionesCatastro = {}) {
    this.timeoutMs = opciones.timeoutMs ?? 20_000;
    this.fetchImpl = opciones.fetchImpl ?? fetch;
    this.ahora = opciones.ahora ?? ((): Date => new Date());
  }

  async consultar(rc: string): Promise<Respuesta<ResultadoCatastro>> {
    const referencia = normalizarRc(rc);
    const url =
      `${BASE_CALLEJERO}/Consulta_DNPRC` +
      `?Provincia=&Municipio=&RefCat=${encodeURIComponent(referencia)}`;

    const cuerpo = await this.pedir(url, 'application/json');

    let cruda: RespuestaDnprc;
    try {
      cruda = JSON.parse(cuerpo) as RespuestaDnprc;
    } catch {
      throw new SourceUnavailableError(
        FUENTE_CATASTRO,
        'la respuesta no es JSON valido',
        url,
      );
    }

    return {
      datos: parsearDnprc(cruda, `referencia ${referencia}`),
      procedencia: this.procedencia(url),
    };
  }

  async coordenadasDe(referenciaParcela: string): Promise<Respuesta<CoordenadasCatastro>> {
    const referencia = normalizarRc(referenciaParcela);
    if (referencia.length !== LONGITUD_PARCELA) {
      // El servicio devuelve el error 18 con una de 20. Se evita el viaje.
      throw new ConsultaInvalidaError(
        FUENTE_CATASTRO,
        '18',
        `Consulta_CPMRC solo acepta referencias de ${LONGITUD_PARCELA} caracteres. ` +
          `Las coordenadas son de la parcela: usa ${referencia.slice(0, LONGITUD_PARCELA)}.`,
      );
    }

    const url =
      `${BASE_LOCALIZACION}/Consulta_CPMRC` +
      `?Provincia=&Municipio=&SRS=EPSG:4326&RC=${encodeURIComponent(referencia)}`;
    const cuerpo = await this.pedir(url, 'application/xml');

    return {
      datos: parsearCoordenadas(cuerpo, `referencia ${referencia}`),
      procedencia: this.procedencia(url),
    };
  }

  async porCoordenadas(lat: number, lon: number): Promise<Respuesta<CoordenadasCatastro>> {
    // Coordenada_X es la longitud y Coordenada_Y la latitud. Cambiarlas de sitio
    // devuelve "no hay referencia disponible" en lugar de un error claro.
    const url =
      `${BASE_LOCALIZACION}/Consulta_RCCOOR` +
      `?SRS=EPSG:4326&Coordenada_X=${encodeURIComponent(String(lon))}` +
      `&Coordenada_Y=${encodeURIComponent(String(lat))}`;
    const cuerpo = await this.pedir(url, 'application/xml');

    return {
      datos: parsearCoordenadas(cuerpo, `coordenadas ${lat}, ${lon}`),
      procedencia: this.procedencia(url),
    };
  }

  // -------------------------------------------------------------------------

  private async pedir(url: string, accept: string): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { Accept: accept },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new SourceUnavailableError(FUENTE_CATASTRO, (e as Error).message, url);
    }

    if (!res.ok) {
      throw new SourceUnavailableError(FUENTE_CATASTRO, `HTTP ${res.status}`, url);
    }

    const cuerpo = await res.text();

    // La Oficina Virtual responde 200 con una pagina HTML cuando rechaza la
    // peticion. Tragarla y seguir seria justo lo que prohibe la regla 5.
    if (/^\s*<(!doctype\s+html|html)\b/i.test(cuerpo)) {
      throw new SourceUnavailableError(
        FUENTE_CATASTRO,
        'el servicio ha devuelto una pagina HTML de error en lugar de datos',
        url,
      );
    }

    return cuerpo;
  }

  private procedencia(url: string): Procedencia {
    const ahora = this.ahora().toISOString();
    return {
      fuente: FUENTE_CATASTRO,
      url,
      // El Catastro no fecha la respuesta. Lo unico honesto que se puede decir
      // es cuando se consulto: la vigencia del dato no la publica.
      fecha_dato: ahora.slice(0, 10),
      obtenido_en: ahora,
      desde_cache: false,
    };
  }
}
