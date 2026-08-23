/**
 * Lee las dos series de valor tasado de vivienda libre de MITMA.
 *
 *   35103500  Tabla 4: municipios de mas de 25.000 habitantes, por trimestre.
 *             Una hoja por trimestre, desde T1A2005.
 *   35101000  Tabla 1: nacional, CCAA y provincias, por trimestre.
 *             Una hoja cada cuatro anos.
 *
 * Todo lo de aqui es puro: recibe un libro ya abierto y devuelve filas. La
 * descarga y la escritura en base viven en el script de ingesta.
 *
 * IMPORTANTE sobre la superficie: la metodologia de MITMA dice que su EUR/m2 es
 * el "cociente entre el valor de tasacion y la superficie construida". Es
 * construida SIN comunes, la misma base que el elemento VIVIENDA del Catastro.
 */

import type { LibroXls, ValorCelda } from '../xls/biff8';

/** Lo que MITMA escribe cuando la muestra no es representativa. */
const NO_REPRESENTATIVO = 'n.r';

export interface FilaMunicipalMitma {
  /** Provincia arrastrada de la columna. Solo orientativa: ver emparejar-municipios.ts. */
  provinciaArrastrada: string | null;
  municipio: string;
  eurM2HastaCincoAnios: number | null;
  eurM2MasDeCincoAnios: number | null;
  eurM2Total: number | null;
  tasacionesHastaCincoAnios: number | null;
  tasacionesMasDeCincoAnios: number | null;
}

export interface FilaTerritorialMitma {
  nombre: string;
  /** Ultimo trimestre con dato de la hoja, en formato 2026Q1. */
  periodo: string;
  eurM2: number;
}

function texto(v: ValorCelda | undefined): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** Un numero de celda, o null si MITMA ha puesto "n.r" o esta vacia. */
function numero(v: ValorCelda | undefined): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim().toLowerCase().startsWith(NO_REPRESENTATIVO)) return null;
  return null;
}

/**
 * "T1A2026" -> "2026Q1". Las pestanas a veces traen espacios de sobra.
 *
 * Se usa el formato ISO-ish porque ordena bien como texto, que es como se
 * guarda en la columna periodo.
 */
export function periodoDeHoja(nombreHoja: string): string {
  const m = /^T(\d)A(\d{4})$/.exec(nombreHoja.trim());
  if (m === null) {
    throw new Error(`El nombre de hoja "${nombreHoja}" no tiene la forma T<n>A<aaaa>.`);
  }
  return `${m[2]}Q${m[1]}`;
}

/** Fecha de cierre del trimestre. Es la fecha_dato que viaja al informe. */
export function fechaCierreTrimestre(periodo: string): string {
  const m = /^(\d{4})Q(\d)$/.exec(periodo);
  if (m === null) throw new Error(`Periodo "${periodo}" mal formado.`);
  const anio = Number(m[1]);
  const trimestre = Number(m[2]);
  const finales = ['03-31', '06-30', '09-30', '12-31'];
  return `${anio}-${finales[trimestre - 1] ?? '12-31'}`;
}

/** La ultima hoja trimestral del libro municipal, que es la mas reciente. */
export function ultimaHojaTrimestral(libro: LibroXls): string {
  const trimestrales = libro.hojas.filter((h) => /^T\d A?\d{4}$|^T\dA\d{4}\s*$/.test(h.trim()));
  const ultima = trimestrales[trimestrales.length - 1];
  if (ultima === undefined) {
    throw new Error(
      `El libro no tiene ninguna hoja con forma de trimestre. Las que hay: ${libro.hojas.join(', ')}`,
    );
  }
  return ultima;
}

/**
 * Filas de la tabla municipal.
 *
 * Columnas observadas en el fichero real (indice 0 = columna A, que va vacia):
 *   1 provincia   2 municipio   3 hasta 5 anos   4 mas de 5 anos   5 total
 *   7 tasaciones hasta 5   8 tasaciones mas de 5
 *
 * No se dan por supuestas: se localizan leyendo la fila de cabecera.
 */
export function leerTablaMunicipal(libro: LibroXls, nombreHoja: string): FilaMunicipalMitma[] {
  const hoja = libro.hoja(nombreHoja);

  const filaCabecera = hoja.filas.findIndex(
    (f) => f !== undefined && f.some((c) => texto(c)?.toLowerCase() === 'municipio'),
  );
  if (filaCabecera < 0) {
    throw new Error(`La hoja ${nombreHoja} no tiene una fila de cabecera con "Municipio".`);
  }
  const cabecera = hoja.filas[filaCabecera] ?? [];
  const colProvincia = cabecera.findIndex((c) => texto(c)?.toLowerCase() === 'provincia');
  const colMunicipio = cabecera.findIndex((c) => texto(c)?.toLowerCase() === 'municipio');
  if (colProvincia < 0 || colMunicipio < 0) {
    throw new Error(`La hoja ${nombreHoja} no trae las columnas de provincia y municipio.`);
  }

  // Las columnas de valor van justo detras de la de municipio, en el orden que
  // declara la cabecera de dos pisos: hasta 5, mas de 5, total.
  const base = colMunicipio + 1;

  const filas: FilaMunicipalMitma[] = [];
  let provincia: string | null = null;

  for (let i = filaCabecera + 1; i < hoja.filas.length; i += 1) {
    const f = hoja.filas[i];
    if (f === undefined) continue;

    const p = texto(f[colProvincia]);
    if (p !== null) provincia = p;

    const municipio = texto(f[colMunicipio]);
    if (municipio === null) continue;

    // Una fila de datos tiene al menos el total. Sin el es un pie de tabla.
    const total = numero(f[base + 2]);
    const masDeCinco = numero(f[base + 1]);
    if (total === null && masDeCinco === null) continue;

    filas.push({
      provinciaArrastrada: provincia,
      municipio,
      eurM2HastaCincoAnios: numero(f[base]),
      eurM2MasDeCincoAnios: masDeCinco,
      eurM2Total: total,
      tasacionesHastaCincoAnios: numero(f[base + 4]),
      tasacionesMasDeCincoAnios: numero(f[base + 5]),
    });
  }

  return filas;
}

/**
 * Filas de la tabla territorial (nacional, CCAA y provincias).
 *
 * La hoja pone cuatro anos en columnas, con un bloque de cuatro trimestres por
 * ano. Se devuelve el ULTIMO trimestre que tenga dato, que es el vigente.
 *
 * Distinguir provincia de CCAA por la sangria del texto seria fragil: se
 * resuelve fuera, comparando el nombre con el callejero del INE.
 */
export function leerTablaTerritorial(
  libro: LibroXls,
  nombreHoja: string,
): { filas: FilaTerritorialMitma[]; periodo: string } {
  const hoja = libro.hoja(nombreHoja);

  // Fila con los anos: celdas del tipo "Año 2023".
  const filaAnios = hoja.filas.findIndex(
    (f) => f !== undefined && f.some((c) => /^A\S*o\s+\d{4}$/.test(texto(c) ?? '')),
  );
  if (filaAnios < 0) {
    throw new Error(`La hoja ${nombreHoja} no tiene la fila de anos ("Año NNNN").`);
  }

  // Cada "Año NNNN" abre un bloque, pero el ultimo ano puede tener menos de
  // cuatro trimestres publicados y detras van dos columnas de "Variación"
  // (trimestral y anual) que son PORCENTAJES. Contar cuatro columnas por ano a
  // ciegas hace que se lea la variacion como si fuera un EUR/m2: en el fichero
  // real eso daba un "TOTAL NACIONAL = 13,9". Asi que se usa la fila de
  // trimestres para saber que columnas son trimestres de verdad.
  const anios: { anio: number; desde: number }[] = [];
  (hoja.filas[filaAnios] ?? []).forEach((c, indice) => {
    const m = /^A\S*o\s+(\d{4})$/.exec(texto(c) ?? '');
    if (m !== null) anios.push({ anio: Number(m[1]), desde: indice });
  });

  const filaTrimestres = hoja.filas.findIndex(
    (f, i) => i > filaAnios && f !== undefined && f.some((c) => /^[1-4]\S?\s*$/.test(texto(c) ?? '')),
  );
  if (filaTrimestres < 0) {
    throw new Error(`La hoja ${nombreHoja} no tiene la fila de trimestres ("1º", "2º"...).`);
  }
  const primeraFilaDatos = filaTrimestres + 1;

  // Columna -> periodo, solo para las que la cabecera marca como trimestre.
  const columnas: { columna: number; periodo: string }[] = [];
  (hoja.filas[filaTrimestres] ?? []).forEach((c, indice) => {
    const m = /^([1-4])\S?\s*$/.exec(texto(c) ?? '');
    if (m === null) return;
    // El trimestre pertenece al ultimo "Año" que quede a su izquierda.
    const bloque = [...anios].reverse().find((a) => a.desde <= indice);
    if (bloque === undefined) return;
    columnas.push({ columna: indice, periodo: `${bloque.anio}Q${m[1]}` });
  });

  // El trimestre vigente es la columna de trimestre mas a la derecha con datos.
  let mejor: { columna: number; periodo: string } | null = null;
  for (const c of columnas) {
    const tieneDato = hoja.filas
      .slice(primeraFilaDatos)
      .some((f) => f !== undefined && typeof f[c.columna] === 'number');
    if (tieneDato) mejor = c;
  }
  if (mejor === null) {
    throw new Error(`La hoja ${nombreHoja} no tiene ninguna columna de trimestre con datos.`);
  }

  // El nombre del territorio esta en la primera columna de texto de la fila.
  const filas: FilaTerritorialMitma[] = [];
  for (let i = primeraFilaDatos; i < hoja.filas.length; i += 1) {
    const f = hoja.filas[i];
    if (f === undefined) continue;
    const nombre = f.slice(0, mejor.columna).map(texto).find((t) => t !== null && t !== undefined);
    const valor = f[mejor.columna];
    if (nombre === null || nombre === undefined || typeof valor !== 'number') continue;
    filas.push({ nombre, periodo: mejor.periodo, eurM2: valor });
  }

  return { filas, periodo: mejor.periodo };
}
