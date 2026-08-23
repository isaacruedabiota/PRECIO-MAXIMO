/**
 * Variacion acumulada del IPV entre dos trimestres.
 *
 * El dato de MITMA es de un trimestre concreto y el calculo se hace hoy. Sin
 * esto habria que elegir entre usar un precio viejo como si fuera actual o
 * inventarse una tasa de crecimiento; el IPV es el numero oficial que cubre ese
 * hueco.
 *
 * Funcion pura: recibe la serie ya leida y no toca ni base ni red.
 */

/** Un punto de la serie: el indice del INE en un trimestre. */
export interface PuntoIpv {
  /** '2026Q1'. */
  periodo: string;
  indice: number;
}

export class SerieIpvInsuficienteError extends Error {
  override readonly name = 'SerieIpvInsuficienteError';

  constructor(
    readonly ccaa: string,
    readonly detalle: string,
  ) {
    super(`Serie de IPV insuficiente para "${ccaa}": ${detalle}`);
  }
}

/** '2026Q1' -> 8105, para poder ordenar y comparar trimestres. */
export function ordinalTrimestre(periodo: string): number {
  const m = /^(\d{4})Q([1-4])$/.exec(periodo);
  if (m === null) throw new Error(`Periodo "${periodo}" mal formado; se espera 2026Q1.`);
  return Number(m[1]) * 4 + (Number(m[2]) - 1);
}

/** Fecha ISO -> trimestre al que pertenece. */
export function trimestreDeFecha(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (m === null) throw new Error(`Fecha "${iso}" mal formada; se espera YYYY-MM-DD.`);
  return `${m[1]}Q${Math.floor((Number(m[2]) - 1) / 3) + 1}`;
}

export interface VariacionAcumulada {
  /** En tanto por uno: 0,043 son un 4,3%. */
  variacion: number;
  desde: string;
  hasta: string;
  indiceDesde: number;
  indiceHasta: number;
  /** Trimestres realmente usados, que pueden no ser los pedidos. */
  notas: readonly string[];
}

/**
 * Variacion entre dos trimestres, a partir de los indices.
 *
 * Si el trimestre de destino aun no esta publicado se usa el ultimo disponible
 * y se deja constancia en las notas: el IPV sale con un trimestre de retraso,
 * asi que pedir "hasta hoy" y encontrar solo hasta el trimestre anterior es lo
 * normal, no un error. Lo que NO se hace es extrapolar.
 *
 * El trimestre de origen, en cambio, tiene que existir: es el del dato de
 * MITMA que se esta actualizando, y sin el no hay nada que acumular.
 */
export function variacionAcumulada(
  ccaa: string,
  serie: readonly PuntoIpv[],
  desde: string,
  hasta: string,
): VariacionAcumulada {
  if (serie.length === 0) {
    throw new SerieIpvInsuficienteError(ccaa, 'no hay ningun indice cargado');
  }

  const ordenada = [...serie].sort(
    (a, b) => ordinalTrimestre(a.periodo) - ordinalTrimestre(b.periodo),
  );
  const porPeriodo = new Map(ordenada.map((p) => [p.periodo, p]));
  const notas: string[] = [];

  const origen = porPeriodo.get(desde);
  if (origen === undefined) {
    const primero = ordenada[0] as PuntoIpv;
    const ultimo = ordenada[ordenada.length - 1] as PuntoIpv;
    throw new SerieIpvInsuficienteError(
      ccaa,
      `falta el trimestre ${desde}. La serie cargada va de ${primero.periodo} a ${ultimo.periodo}.`,
    );
  }

  let destino = porPeriodo.get(hasta);
  if (destino === undefined) {
    const ultimo = ordenada[ordenada.length - 1] as PuntoIpv;
    if (ordinalTrimestre(ultimo.periodo) < ordinalTrimestre(hasta)) {
      destino = ultimo;
      notas.push(
        `El IPV de ${hasta} aun no esta publicado; se usa ${ultimo.periodo}, que es el ultimo disponible.`,
      );
    } else {
      throw new SerieIpvInsuficienteError(ccaa, `falta el trimestre ${hasta} dentro de la serie.`);
    }
  }

  if (origen.indice <= 0) {
    throw new SerieIpvInsuficienteError(ccaa, `el indice de ${desde} es ${origen.indice}`);
  }

  if (ordinalTrimestre(destino.periodo) < ordinalTrimestre(origen.periodo)) {
    notas.push(
      `El trimestre de destino (${destino.periodo}) es anterior al de origen (${origen.periodo}): la variacion sale negativa a proposito.`,
    );
  }

  return {
    variacion: destino.indice / origen.indice - 1,
    desde: origen.periodo,
    hasta: destino.periodo,
    indiceDesde: origen.indice,
    indiceHasta: destino.indice,
    notas,
  };
}
