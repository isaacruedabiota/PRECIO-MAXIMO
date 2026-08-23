/**
 * CLI: pnpm ingest:ine [--trimestres=40]
 *
 * Ingesta del IPV (Indice de Precios de Vivienda) del INE por CCAA.
 *
 * Para que sirve: el dato de MITMA es de un trimestre concreto y el calculo se
 * hace hoy. El IPV es lo que permite traer ese EUR/m2 a fecha actual sin
 * inventarse una tasa de crecimiento.
 *
 * Tabla 80270: "Índices por CCAA: general, vivienda nueva y de segunda mano.
 * Trimestrales". Son 240 series, que salen de cruzar 20 territorios (nacional
 * mas 19 CCAA) por 3 tipos de vivienda por 4 medidas. Aqui se pivotan a una
 * fila por territorio, tipo y trimestre.
 *
 *   https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/80270?nult=N
 *
 * Se guardan varios trimestres y no solo el ultimo porque la variacion que
 * necesita el motor es ACUMULADA entre dos fechas, y para eso hace falta la
 * serie, no un punto.
 */

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fechaCierreTrimestre } from '@vp/adapters';
import { crearDb, fuentesDatos, ineIpv } from '@vp/db';
import { nombreDeLaBase, requiereDatabaseUrl } from '@vp/db/env';
import { sql } from 'drizzle-orm';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ID_TABLA = '80270';
const TRIMESTRES_POR_DEFECTO = 40;

interface DatoIne {
  Fecha: number;
  FK_Periodo: number;
  Anyo: number;
  Valor: number | null;
  Secreto: boolean;
}

interface SerieIne {
  COD: string;
  Nombre: string;
  Data: DatoIne[];
}

/** Los tres tipos de vivienda que publica la tabla, y su clave en la base. */
const SERIES: Readonly<Record<string, string>> = {
  general: 'general',
  'vivienda nueva': 'nueva',
  'vivienda segunda mano': 'segunda_mano',
};

/** Las tres medidas que se guardan. La cuarta ("en lo que va de ano") no se usa. */
type Medida = 'indice' | 'trimestral' | 'anual';

function medidaDe(texto: string): Medida | null {
  const t = normalizar(texto);
  if (t === 'indice') return 'indice';
  if (t === 'variacion trimestral') return 'trimestral';
  if (t === 'variacion anual') return 'anual';
  return null;
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Trimestre de un dato del INE.
 *
 * Se deriva de Fecha y NO de FK_Periodo, porque el significado de FK_Periodo no
 * esta documentado en la respuesta. Fecha marca el primer instante del
 * trimestre en hora de Madrid, asi que en UTC cae en el dia anterior: el primer
 * trimestre de 2026 viene como 2025-12-31T23:00Z. Sumar doce horas antes de
 * mirar el mes evita ese borde.
 *
 * Aun asi se comprueba contra Anyo y FK_Periodo: si dejaran de concordar seria
 * senal de que la tabla ha cambiado, y es mejor parar que guardar trimestres
 * corridos.
 */
export function trimestreDelDato(d: DatoIne): string {
  const desplazada = new Date(d.Fecha + 12 * 3600 * 1000);
  const anio = desplazada.getUTCFullYear();
  const trimestre = Math.floor(desplazada.getUTCMonth() / 3) + 1;

  if (anio !== d.Anyo) {
    throw new Error(
      `El INE da Anyo=${d.Anyo} y la fecha ${new Date(d.Fecha).toISOString()} cae en ${anio}.`,
    );
  }
  // Observado: FK_Periodo 19..22 son los cuatro trimestres.
  if (d.FK_Periodo - 18 !== trimestre) {
    throw new Error(
      `FK_Periodo=${d.FK_Periodo} no corresponde al trimestre ${trimestre} de ${anio}. ` +
        'La codificacion de periodos del INE ha cambiado.',
    );
  }
  return `${anio}Q${trimestre}`;
}

interface Fila {
  ccaa: string;
  serie: string;
  periodo: string;
  fechaDato: string;
  indice: number | null;
  variacionTrimestral: number | null;
  variacionAnual: number | null;
}

export function pivotar(series: readonly SerieIne[]): { filas: Fila[]; avisos: string[] } {
  const avisos: string[] = [];
  const acumulado = new Map<string, Fila>();

  for (const s of series) {
    // "Comunitat Valenciana. General. Índice. " -> tres trozos.
    const trozos = s.Nombre.split('.')
      .map((t) => t.trim())
      .filter((t) => t !== '');
    if (trozos.length < 3) {
      avisos.push(`Nombre de serie con forma inesperada: "${s.Nombre}"`);
      continue;
    }
    const territorio = trozos[0] as string;
    const serie = SERIES[normalizar(trozos[1] as string)];
    const medida = medidaDe(trozos[2] as string);
    if (serie === undefined || medida === null) continue;

    for (const d of s.Data) {
      if (d.Valor === null || d.Secreto) continue;
      const periodo = trimestreDelDato(d);
      const clave = `${territorio}|${serie}|${periodo}`;
      let fila = acumulado.get(clave);
      if (fila === undefined) {
        fila = {
          ccaa: territorio,
          serie,
          periodo,
          fechaDato: fechaCierreTrimestre(periodo),
          indice: null,
          variacionTrimestral: null,
          variacionAnual: null,
        };
        acumulado.set(clave, fila);
      }
      if (medida === 'indice') fila.indice = d.Valor;
      else if (medida === 'trimestral') fila.variacionTrimestral = d.Valor;
      else fila.variacionAnual = d.Valor;
    }
  }

  // El indice es lo unico imprescindible: sin el la fila no sirve para acumular.
  const filas = [...acumulado.values()];
  const sinIndice = filas.filter((f) => f.indice === null);
  if (sinIndice.length > 0) {
    avisos.push(`${sinIndice.length} combinaciones sin indice; no se guardan.`);
  }
  return { filas: filas.filter((f) => f.indice !== null), avisos };
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argTrimestres = process.argv.find((a) => a.startsWith('--trimestres='));
  const trimestres = argTrimestres === undefined
    ? TRIMESTRES_POR_DEFECTO
    : Number(argTrimestres.slice('--trimestres='.length));
  if (!Number.isInteger(trimestres) || trimestres < 1) {
    console.error('--trimestres tiene que ser un entero positivo.');
    process.exit(1);
  }

  const url = requiereDatabaseUrl();
  console.log(`Base: ${nombreDeLaBase(url)}`);

  const urlIne = `https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/${ID_TABLA}?nult=${trimestres}`;
  console.log(`Descargando IPV: ${urlIne}`);

  const res = await fetch(urlIne, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`El INE devuelve HTTP ${res.status}`);
  const texto = await res.text();

  let series: SerieIne[];
  try {
    series = JSON.parse(texto) as SerieIne[];
  } catch {
    throw new Error(
      `La respuesta del INE no es JSON valido (${texto.length} bytes). ` +
        'Si termina a mitad de registro, ha cortado por tamano: baja --trimestres.',
    );
  }
  console.log(`  ${series.length} series.`);

  const { filas, avisos } = pivotar(series);
  for (const a of avisos) console.log(`  AVISO: ${a}`);

  const territorios = new Set(filas.map((f) => f.ccaa));
  const periodos = [...new Set(filas.map((f) => f.periodo))].sort();
  console.log(
    `  ${filas.length} filas: ${territorios.size} territorios x 3 series x ${periodos.length} trimestres.`,
  );
  console.log(`  de ${periodos[0]} a ${periodos[periodos.length - 1]}`);

  // 19 CCAA + Ceuta + Melilla + Nacional. Menos de 20 significa que falta algo.
  if (territorios.size < 20) {
    console.error(`\nSolo ${territorios.size} territorios. Se esperaban al menos 20. No se escribe nada.`);
    process.exit(2);
  }

  const db = crearDb(url);
  const [fuente] = await db
    .insert(fuentesDatos)
    .values({
      fuente: 'ine',
      origen: 'api',
      url: urlIne,
      periodo: periodos[periodos.length - 1] ?? null,
      checksum: createHash('sha256').update(texto).digest('hex'),
      filasImportadas: filas.length,
      notas: `IPV tabla ${ID_TABLA}, ultimos ${trimestres} trimestres, general / nueva / segunda mano por CCAA.`,
    })
    .returning();
  if (fuente === undefined) throw new Error('No se ha podido crear la fila de fuentes_datos.');

  const LOTE = 500;
  for (let i = 0; i < filas.length; i += LOTE) {
    await db
      .insert(ineIpv)
      .values(
        filas.slice(i, i + LOTE).map((f) => ({
          ccaa: f.ccaa,
          serie: f.serie,
          periodo: f.periodo,
          fechaDato: f.fechaDato,
          indice: f.indice as number,
          variacionTrimestral: f.variacionTrimestral,
          variacionAnual: f.variacionAnual,
          idTablaIne: ID_TABLA,
          fuenteId: fuente.id,
        })),
      )
      .onConflictDoUpdate({
        target: [ineIpv.ccaa, ineIpv.serie, ineIpv.periodo],
        set: {
          indice: sql`excluded.indice`,
          variacionTrimestral: sql`excluded.variacion_trimestral`,
          variacionAnual: sql`excluded.variacion_anual`,
          fuenteId: sql`excluded.fuente_id`,
        },
      });
  }

  // Fixture derivado: el ultimo trimestre de cada territorio, para poder mirar
  // en el diff que ha cambiado sin bajarse un mega de JSON.
  const ultimo = periodos[periodos.length - 1];
  writeFileSync(
    join(RAIZ, 'fixtures', 'ine', `ipv-${ID_TABLA}-ultimo-trimestre.json`),
    `${JSON.stringify(
      {
        id_tabla: ID_TABLA,
        periodo: ultimo,
        trimestres_guardados: periodos.length,
        datos: filas
          .filter((f) => f.periodo === ultimo)
          .sort((a, b) => a.ccaa.localeCompare(b.ccaa) || a.serie.localeCompare(b.serie)),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(`\n${filas.length} filas escritas. fuentes_datos id=${fuente.id}, ultimo ${ultimo}.`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error('\nFallo la ingesta del INE:', e instanceof Error ? e.message : e);
  process.exit(1);
});
