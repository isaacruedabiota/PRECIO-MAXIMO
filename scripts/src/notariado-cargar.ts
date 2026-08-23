/**
 * CLI: pnpm notariado:cargar --cp=12100 --eur-m2=1610 --periodo=2025Q4 --base=construida
 *      pnpm notariado:cargar --csv=precios.csv
 *      pnpm notariado:cargar --instrucciones
 *
 * Carga a mano el EUR/m2 de escritura del Portal Estadistico del Notariado.
 *
 * Es el primer escalon de la cascada de T1 y el dato mas valioso que hay:
 * precio PAGADO, no de oferta ni de tasacion. Va a mano porque el portal exige
 * registro para las consultas detalladas y no publica API (ADR-031).
 *
 * --base es OBLIGATORIO y no tiene valor por defecto a proposito. El portal no
 * publica su metodologia de superficie en la pagina de consulta, y confundir
 * util con construida mueve la valoracion alrededor de un 25%. Si no sabes cual
 * es, no lo cargues.
 */

import { readFileSync } from 'node:fs';

import { INSTRUCCIONES_NOTARIADO, URL_NOTARIADO } from '@vp/adapters';
import { crearDb, fuentesDatos, notariadoPrecios } from '@vp/db';
import { nombreDeLaBase, requiereDatabaseUrl } from '@vp/db/env';
import { sql } from 'drizzle-orm';

const BASES = ['util', 'construida', 'construida_con_comunes'] as const;
type Base = (typeof BASES)[number];

interface Fila {
  cp: string;
  eurM2: number;
  periodo: string;
  base: Base;
  nTransacciones: number | null;
  p25: number | null;
  p75: number | null;
}

function fechaCierre(periodo: string): string {
  const m = /^(\d{4})Q([1-4])$/.exec(periodo);
  if (m === null) {
    throw new Error(`Periodo "${periodo}" mal formado. Se espera 2025Q4.`);
  }
  const finales = ['03-31', '06-30', '09-30', '12-31'];
  return `${m[1]}-${finales[Number(m[2]) - 1] ?? '12-31'}`;
}

/** exactOptionalPropertyTypes obliga a declarar el undefined, no solo a omitir. */
type FilaSuelta = { [K in keyof Fila]: Fila[K] | undefined };

function validar(f: FilaSuelta, donde: string): Fila {
  const faltan: string[] = [];
  if (f.cp === undefined || !/^\d{5}$/.test(f.cp)) faltan.push('cp (5 digitos)');
  if (f.eurM2 === undefined || !Number.isFinite(f.eurM2) || f.eurM2 <= 0) faltan.push('eur-m2');
  if (f.periodo === undefined || !/^\d{4}Q[1-4]$/.test(f.periodo)) faltan.push('periodo (2025Q4)');
  if (f.base === undefined || !BASES.includes(f.base)) {
    faltan.push(`base (${BASES.join(' | ')})`);
  }
  if (faltan.length > 0) {
    throw new Error(`${donde}: falta o esta mal ${faltan.join(', ')}`);
  }
  return {
    cp: f.cp as string,
    eurM2: f.eurM2 as number,
    periodo: f.periodo as string,
    base: f.base as Base,
    nTransacciones: f.nTransacciones ?? null,
    p25: f.p25 ?? null,
    p75: f.p75 ?? null,
  };
}

function numeroOpcional(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** CSV con cabecera: cp,eur_m2,periodo,base,n_transacciones,p25,p75 */
function leerCsv(ruta: string): Fila[] {
  const lineas = readFileSync(ruta, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  const cabecera = (lineas.shift() ?? '').split(',').map((c) => c.trim().toLowerCase());
  const col = (nombre: string): number => cabecera.indexOf(nombre);

  return lineas.map((linea, i) => {
    const c = linea.split(',').map((x) => x.trim());
    const en = (nombre: string): string | undefined => {
      const j = col(nombre);
      return j < 0 ? undefined : c[j];
    };
    return validar(
      {
        cp: en('cp'),
        eurM2: numeroOpcional(en('eur_m2')) ?? undefined,
        periodo: en('periodo'),
        base: en('base') as Base | undefined,
        nTransacciones: numeroOpcional(en('n_transacciones')),
        p25: numeroOpcional(en('p25')),
        p75: numeroOpcional(en('p75')),
      },
      `${ruta} linea ${i + 2}`,
    );
  });
}

function flag(nombre: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${nombre}=`));
  return a === undefined ? undefined : a.slice(nombre.length + 3);
}

function imprimirInstrucciones(): void {
  console.log(`\nEl Portal Estadistico del Notariado no publica API y pide registro para las
consultas detalladas, asi que el dato se carga a mano:\n`);
  for (const p of INSTRUCCIONES_NOTARIADO) console.log(`  - ${p}`);
  console.log(`
Ejemplo:
  pnpm notariado:cargar --cp=12100 --eur-m2=1610 --periodo=2025Q4 --base=construida --n=42

O en lote, con un CSV de cabecera cp,eur_m2,periodo,base,n_transacciones,p25,p75:
  pnpm notariado:cargar --csv=precios.csv
`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--instrucciones') || process.argv.length <= 2) {
    imprimirInstrucciones();
    process.exit(process.argv.includes('--instrucciones') ? 0 : 1);
  }

  const csv = flag('csv');
  const filas =
    csv !== undefined
      ? leerCsv(csv)
      : [
          validar(
            {
              cp: flag('cp'),
              eurM2: numeroOpcional(flag('eur-m2')) ?? undefined,
              periodo: flag('periodo'),
              base: flag('base') as Base | undefined,
              nTransacciones: numeroOpcional(flag('n')),
              p25: numeroOpcional(flag('p25')),
              p75: numeroOpcional(flag('p75')),
            },
            'argumentos',
          ),
        ];

  const url = requiereDatabaseUrl();
  console.log(`Base: ${nombreDeLaBase(url)}`);
  const db = crearDb(url);

  const [fuente] = await db
    .insert(fuentesDatos)
    .values({
      fuente: 'notariado',
      // No es una descarga ni una API: lo teclea una persona que lo ha leido.
      origen: 'entrada_usuario',
      url: URL_NOTARIADO,
      periodo: filas[0]?.periodo ?? null,
      filasImportadas: filas.length,
      notas:
        'Carga manual desde el Portal Estadistico del Notariado. El portal exige registro ' +
        'para las consultas detalladas y no publica API (ADR-031).',
    })
    .returning();
  if (fuente === undefined) throw new Error('No se ha podido crear la fila de fuentes_datos.');

  await db
    .insert(notariadoPrecios)
    .values(
      filas.map((f) => ({
        cp: f.cp,
        periodo: f.periodo,
        fechaDato: fechaCierre(f.periodo),
        eurM2: f.eurM2.toFixed(2),
        nTransacciones: f.nTransacciones,
        p25: f.p25 === null ? null : f.p25.toFixed(2),
        p75: f.p75 === null ? null : f.p75.toFixed(2),
        baseSuperficie: f.base,
        fuenteId: fuente.id,
      })),
    )
    .onConflictDoUpdate({
      target: [notariadoPrecios.cp, notariadoPrecios.periodo],
      set: {
        eurM2: sql`excluded.eur_m2`,
        nTransacciones: sql`excluded.n_transacciones`,
        p25: sql`excluded.p25`,
        p75: sql`excluded.p75`,
        baseSuperficie: sql`excluded.base_superficie`,
        fechaDato: sql`excluded.fecha_dato`,
        fuenteId: sql`excluded.fuente_id`,
      },
    });

  for (const f of filas) {
    console.log(
      `  CP ${f.cp}  ${f.eurM2.toFixed(2)} EUR/m2 ${f.base}  ${f.periodo}` +
        `${f.nTransacciones === null ? '' : `  (${f.nTransacciones} compraventas)`}`,
    );
  }
  console.log(`\n${filas.length} precios cargados. fuentes_datos id=${fuente.id}.`);
  console.log(
    'A partir de ahora T1 usara este dato para esos codigos postales, por delante de MITMA.',
  );
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`);
  imprimirInstrucciones();
  process.exit(1);
});
