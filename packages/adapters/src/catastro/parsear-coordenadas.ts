/**
 * Lector de las respuestas de Consulta_CPMRC y Consulta_RCCOOR.
 *
 * Estos dos servicios NO tienen interfaz JSON. Comprobado el 2026-08-22: la
 * fachada REST/JSON (CoordenadasDistancia.svc/json) devuelve una pagina HTML de
 * error con cualquier combinacion de parametros; la unica que responde es la
 * fachada HttpGet del .asmx, que devuelve XML.
 *
 * No se anade un parser XML al proyecto por 30 lineas: la respuesta son 638
 * bytes, un solo espacio de nombres, sin atributos en los datos y con la forma
 * fijada en fixtures/catastro/consulta-cpmrc-2004930yk5320s.xml. Este lector es
 * deliberadamente estrecho y falla si no encuentra lo que espera, en vez de
 * devolver ceros. Si el Catastro cambia el formato, los tests contra el fixture
 * lo cantan.
 */

import { SinDatoError, ConsultaInvalidaError } from '../ports';
import type { CoordenadasCatastro } from '../ports';

export const FUENTE_COORDENADAS = 'Catastro - Oficina Virtual (Consulta_CPMRC / Consulta_RCCOOR)';

const CODIGOS_CONSULTA_INVALIDA = new Set(['18', '75', '17']);

/** Primer valor de una etiqueta simple, sin descender por el arbol. */
function etiqueta(xml: string, nombre: string): string | null {
  const m = new RegExp(`<${nombre}>([^<]*)</${nombre}>`).exec(xml);
  if (m === null) return null;
  const t = (m[1] ?? '').trim();
  return t === '' ? null : t;
}

function bloque(xml: string, nombre: string): string | null {
  const m = new RegExp(`<${nombre}>([\\s\\S]*?)</${nombre}>`).exec(xml);
  return m === null ? null : (m[1] ?? '');
}

function numero(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Devuelve las coordenadas del primer <coord>. Los dos servicios comparten la
 * misma forma de respuesta (consulta_coordenadas), por eso hay un solo lector.
 */
export function parsearCoordenadas(xml: string, consulta: string): CoordenadasCatastro {
  if (!xml.includes('<consulta_coordenadas')) {
    throw new SinDatoError(
      FUENTE_COORDENADAS,
      `${consulta}: la respuesta no es un consulta_coordenadas`,
    );
  }

  const err = bloque(xml, 'err');
  if (err !== null) {
    const cod = etiqueta(err, 'cod') ?? 'sin-codigo';
    const des = etiqueta(err, 'des') ?? 'sin descripcion';
    if (CODIGOS_CONSULTA_INVALIDA.has(cod)) {
      throw new ConsultaInvalidaError(FUENTE_COORDENADAS, cod, des);
    }
    throw new SinDatoError(FUENTE_COORDENADAS, `${consulta} [${cod}] ${des}`);
  }

  const coord = bloque(xml, 'coord');
  if (coord === null) {
    throw new SinDatoError(FUENTE_COORDENADAS, consulta);
  }

  const geo = bloque(coord, 'geo') ?? '';
  const lon = numero(etiqueta(geo, 'xcen'));
  const lat = numero(etiqueta(geo, 'ycen'));
  const srs = etiqueta(geo, 'srs');

  if (lon === null || lat === null || srs === null) {
    throw new SinDatoError(
      FUENTE_COORDENADAS,
      `${consulta}: el bloque geo no trae xcen, ycen y srs`,
    );
  }

  const pc = bloque(coord, 'pc') ?? '';
  const referencia = `${etiqueta(pc, 'pc1') ?? ''}${etiqueta(pc, 'pc2') ?? ''}`;
  if (referencia === '') {
    throw new SinDatoError(FUENTE_COORDENADAS, `${consulta}: sin referencia de parcela`);
  }

  return {
    lat,
    lon,
    srs,
    referencia_parcela: referencia,
    direccion_literal: etiqueta(coord, 'ldt'),
  };
}
