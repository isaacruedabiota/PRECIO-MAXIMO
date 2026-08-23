/**
 * Implementaciones de MitmaPort, InePort y PrecioMercadoPort sobre la base.
 *
 * Aqui solo hay consultas. Toda la decision (que escalon de la cascada gana, y
 * como se acumula el IPV) vive en cascada.ts y variacion-ipv.ts, que son puros
 * y estan probados sin base.
 *
 * El Notariado es opcional en el constructor: solo tiene dato para los codigos
 * postales que se hayan cargado a mano (ADR-031). Cuando no lo tiene, la cascada
 * cae al escalon municipal y lo dice en la explicacion.
 */

import type { PrecioM2Referencia, TipoSuperficie, VariacionIPV } from '@vp/engine';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '@vp/db';
import { ineIpv, mitmaPrecios } from '@vp/db/schema';

import { SinDatoError } from '../ports';
import type {
  InePort,
  MitmaPort,
  NotariadoPort,
  PrecioMercadoPort,
  Procedencia,
  Respuesta,
} from '../ports';
import { resolverCascada } from './cascada';
import type { CandidatoPrecio } from './cascada';
import { trimestreDeFecha, variacionAcumulada } from './variacion-ipv';
import type { PuntoIpv } from './variacion-ipv';

export const FUENTE_MITMA = 'MITMA serie 35103500 (valor tasado de vivienda libre)';
export const FUENTE_IPV = 'INE, IPV tabla 80270';

const URL_MITMA = 'https://apps.fomento.gob.es/boletinonline2/sedal/35103500.XLS';

/**
 * Segmento de antiguedad por defecto.
 *
 * 'mas_de_5' y no 'total' por ADR-015: la edad de referencia del parque contra
 * la que T1 deprecia describe vivienda usada, asi que el precio tiene que
 * describir la misma poblacion. Mezclar el precio total (que incluye obra
 * nueva) con la edad media del parque cuenta la antiguedad dos veces.
 */
const SEGMENTO_POR_DEFECTO = 'mas_de_5';

function procedencia(fuente: string, url: string | null, fechaDato: string): Procedencia {
  return {
    fuente,
    url,
    fecha_dato: fechaDato,
    obtenido_en: new Date().toISOString(),
    desde_cache: true,
  };
}

// ---------------------------------------------------------------------------
// MITMA
// ---------------------------------------------------------------------------

export class MitmaDbAdapter implements MitmaPort {
  constructor(
    private readonly db: Db,
    private readonly segmento: string = SEGMENTO_POR_DEFECTO,
  ) {}

  async porMunicipio(codigoIne: string): Promise<Respuesta<PrecioM2Referencia>> {
    return this.buscar('municipio', codigoIne);
  }

  async porProvincia(codigoProvincia: string): Promise<Respuesta<PrecioM2Referencia>> {
    // La serie provincial solo publica el total: no viene desglosada por
    // antiguedad. Pedir 'mas_de_5' aqui devolveria vacio siempre.
    return this.buscar('provincia', codigoProvincia, 'total');
  }

  private async buscar(
    ambito: 'municipio' | 'provincia',
    codigo: string,
    segmento = this.segmento,
  ): Promise<Respuesta<PrecioM2Referencia>> {
    const filas = await this.db
      .select()
      .from(mitmaPrecios)
      .where(
        and(
          eq(mitmaPrecios.ambito, ambito),
          eq(mitmaPrecios.codigo, codigo),
          eq(mitmaPrecios.segmento, segmento),
        ),
      )
      .orderBy(desc(mitmaPrecios.periodo))
      .limit(1);

    const fila = filas[0];
    if (fila === undefined) {
      throw new SinDatoError(FUENTE_MITMA, `${ambito} ${codigo}, segmento ${segmento}`);
    }

    return {
      datos: {
        eur_m2: Number(fila.eurM2),
        ambito,
        fuente: `${FUENTE_MITMA}, ${fila.periodo}`,
        fuente_url: URL_MITMA,
        fecha_dato: fila.fechaDato,
        n_transacciones: fila.nTasaciones,
        // MITMA publica la media, no los cuartiles.
        p25: null,
        p75: null,
        base_superficie: fila.baseSuperficie as TipoSuperficie,
      },
      procedencia: procedencia(FUENTE_MITMA, URL_MITMA, fila.fechaDato),
    };
  }
}

// ---------------------------------------------------------------------------
// INE
// ---------------------------------------------------------------------------

export class IneDbAdapter implements InePort {
  constructor(
    private readonly db: Db,
    /** 'general', 'nueva' o 'segunda_mano'. */
    private readonly serie: string = 'segunda_mano',
  ) {}

  async variacionIPV(ccaa: string, desde: string, hasta: string): Promise<Respuesta<VariacionIPV>> {
    // El INE nombra las CCAA a su manera ("Madrid, Comunidad de") y la config
    // del ITP a la suya ("Comunidad de Madrid"), asi que se prueban las dos.
    const candidatos = [ccaa, ...variantesDeCcaa(ccaa)];
    const filas = await this.db
      .select({ periodo: ineIpv.periodo, indice: ineIpv.indice, ccaa: ineIpv.ccaa })
      .from(ineIpv)
      .where(and(inArray(ineIpv.ccaa, candidatos), eq(ineIpv.serie, this.serie)));

    if (filas.length === 0) {
      throw new SinDatoError(FUENTE_IPV, `IPV de "${ccaa}" (serie ${this.serie})`);
    }

    const puntos: PuntoIpv[] = filas.map((f) => ({ periodo: f.periodo, indice: f.indice }));
    const r = variacionAcumulada(ccaa, puntos, trimestreDeFecha(desde), trimestreDeFecha(hasta));

    return {
      datos: {
        ccaa,
        variacion_acumulada: r.variacion,
        desde: r.desde,
        hasta: r.hasta,
        fuente: `${FUENTE_IPV}, serie ${this.serie}`,
        id_tabla_ine: '80270',
      },
      procedencia: procedencia(FUENTE_IPV, 'https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/80270', hasta),
    };
  }
}

/** Formas alternativas del nombre de una CCAA, para cuadrar INE y config. */
function variantesDeCcaa(nombre: string): string[] {
  const salida = new Set<string>();
  const conComa = /^(.*),\s*(.+)$/.exec(nombre);
  if (conComa !== null) salida.add(`${conComa[2]} ${conComa[1]}`);
  // "Comunidad de Madrid" -> "Madrid, Comunidad de"
  const conPrefijo = /^((?:Comunidad|Comunitat|Principado|Region|Región|Islas|Illes)\b.*?)\s+(?:de\s+|del\s+)?(\S.*)$/i.exec(
    nombre,
  );
  if (conPrefijo !== null) salida.add(`${conPrefijo[2]}, ${conPrefijo[1]}`);
  salida.delete(nombre);
  return [...salida];
}

// ---------------------------------------------------------------------------
// Cascada
// ---------------------------------------------------------------------------

export class PrecioMercadoDbAdapter implements PrecioMercadoPort {
  constructor(
    private readonly mitma: MitmaPort,
    /**
     * null = sin Notariado. La cascada arranca entonces un escalon mas abajo, en
     * el valor tasado de MITMA, que es tasacion y no escritura. Se dice en la
     * explicacion para que no pase inadvertido.
     */
    private readonly notariado: NotariadoPort | null = null,
  ) {}

  async resolver(params: {
    codigo_postal: string;
    municipio_ine: string | null;
    codigo_provincia: string;
  }): Promise<Respuesta<PrecioM2Referencia>> {
    const candidatos: CandidatoPrecio[] = [];
    let ultimaProcedencia: Procedencia | null = null;

    // Escalon 1: Notariado por codigo postal. Precio de escritura.
    if (this.notariado !== null) {
      try {
        const r = await this.notariado.porCodigoPostal(params.codigo_postal);
        candidatos.push({ ...r.datos, descripcion: `Notariado (CP ${params.codigo_postal})` });
        ultimaProcedencia = r.procedencia;
      } catch (e) {
        if (!(e instanceof SinDatoError)) throw e;
        // Solo hay lo que se haya cargado a mano: no tenerlo es lo normal.
      }
    }

    if (params.municipio_ine !== null) {
      try {
        const r = await this.mitma.porMunicipio(params.municipio_ine);
        candidatos.push({ ...r.datos, descripcion: `MITMA municipal (${params.municipio_ine})` });
        ultimaProcedencia = r.procedencia;
      } catch (e) {
        if (!(e instanceof SinDatoError)) throw e;
        // MITMA solo publica municipios de mas de 25.000 habitantes: que no
        // haya dato municipal es lo normal en la mayoria de municipios.
      }
    }

    try {
      const r = await this.mitma.porProvincia(params.codigo_provincia);
      candidatos.push({ ...r.datos, descripcion: `MITMA provincial (${params.codigo_provincia})` });
      ultimaProcedencia ??= r.procedencia;
    } catch (e) {
      if (!(e instanceof SinDatoError)) throw e;
    }

    const consulta = `CP ${params.codigo_postal}, municipio ${params.municipio_ine ?? '?'}, provincia ${params.codigo_provincia}`;
    const { elegido, explicacion } = resolverCascada(candidatos, consulta);

    return {
      datos: {
        ...elegido,
        fuente: `${elegido.fuente} - ${explicacion}`,
      },
      procedencia:
        ultimaProcedencia ?? procedencia(FUENTE_MITMA, URL_MITMA, elegido.fecha_dato),
    };
  }
}
