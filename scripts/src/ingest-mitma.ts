/**
 * CLI: pnpm ingest:mitma [--offline] [--hoja=T1A2026]
 *
 * Ingesta de la estadistica de valor tasado de vivienda libre de MITMA:
 *
 *   35103500  municipios de mas de 25.000 habitantes (Tabla 4)
 *   35101000  nacional, CCAA y provincias (Tabla 1)
 *
 * Los XLS son BIFF8 de verdad (OLE2), asi que se leen con el lector propio de
 * @vp/adapters. Ver la cabecera de packages/adapters/src/xls/biff8.ts para el
 * porque de no usar libreria.
 *
 * El municipio se resuelve por NOMBRE contra el callejero del INE, no por la
 * columna de provincia del XLS: esa columna se arrastra hacia abajo y el
 * fichero real tiene filas fuera de su bloque (Almunecar, que es de Granada,
 * aparece al final del de Cordoba). Lo que no se resuelve NO se inventa: se
 * lista y se cuenta, y si son demasiados la ingesta para.
 *
 * --offline usa los XLS ya descargados en fixtures/mitma/ en vez de bajarlos.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  IndiceMunicipios,
  abrirXls,
  fechaCierreTrimestre,
  leerTablaMunicipal,
  leerTablaTerritorial,
  periodoDeHoja,
  ultimaHojaTrimestral,
  variantesDelNombre,
} from '@vp/adapters';
import type { AliasMunicipio, MunicipioIne } from '@vp/adapters';
import { loadConfig } from '@vp/config';
import { crearDb, fuentesDatos, mitmaPrecios, municipios } from '@vp/db';
import { nombreDeLaBase, requiereDatabaseUrl } from '@vp/db/env';
import { eq, inArray, sql } from 'drizzle-orm';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR_FIXTURES = join(RAIZ, 'fixtures', 'mitma');

const URL_MUNICIPAL = 'https://apps.fomento.gob.es/boletinonline2/sedal/35103500.XLS';
const URL_PROVINCIAL = 'https://apps.fomento.gob.es/boletinonline2/sedal/35101000.XLS';

/**
 * Si no casan mas de estos, algo ha cambiado de fondo (nuevo formato, nuevo
 * callejero) y es mejor parar que meter medio fichero.
 */
const MAXIMO_SIN_CASAR = 15;

interface Opciones {
  offline: boolean;
  hoja: string | null;
}

function leerOpciones(): Opciones {
  const argv = process.argv.slice(2);
  const hoja = argv.find((a) => a.startsWith('--hoja='));
  return {
    offline: argv.includes('--offline'),
    hoja: hoja === undefined ? null : hoja.slice('--hoja='.length),
  };
}

async function obtenerXls(url: string, nombreFichero: string, offline: boolean): Promise<Buffer> {
  const ruta = join(DIR_FIXTURES, nombreFichero);

  if (offline) {
    if (!existsSync(ruta)) {
      throw new Error(`--offline pero no existe ${ruta}. Lanzalo sin --offline la primera vez.`);
    }
    console.log(`  ${nombreFichero}: desde fixtures (offline)`);
    return readFileSync(ruta);
  }

  console.log(`  ${nombreFichero}: descargando...`);
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    throw new Error(`MITMA devuelve HTTP ${res.status} en ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());

  // Un HTML de error pesa poco y no empieza por la firma de OLE2. Se para.
  if (buf.length < 10_000 || buf.readUInt32LE(0) !== 0xe011cfd0) {
    throw new Error(
      `Lo que ha devuelto ${url} no es un .xls (${buf.length} bytes). No se ingesta nada.`,
    );
  }

  // Se guarda para poder repetir la ingesta sin volver a bajarlo. El .gitignore
  // excluye los *.xls: lo que se versiona es el JSON derivado.
  writeFileSync(ruta, buf);
  return buf;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opciones = leerOpciones();
  const url = requiereDatabaseUrl();
  console.log(`Base: ${nombreDeLaBase(url)}`);

  const { config } = loadConfig();
  const alias = (
    (config as unknown as { fuentes?: { mitma?: { alias_municipios?: Record<string, AliasMunicipio> } } })
      .fuentes?.mitma?.alias_municipios ?? {}
  ) as Record<string, AliasMunicipio>;

  const db = crearDb(url);

  const callejero = (await db
    .select({
      codigoIne: municipios.codigoIne,
      nombre: municipios.nombre,
      provincia: municipios.provincia,
      codigoProvincia: municipios.codigoProvincia,
      ccaa: municipios.ccaa,
    })
    .from(municipios)) as (MunicipioIne & { codigoProvincia: string; ccaa: string })[];

  if (callejero.length === 0) {
    console.error('La tabla municipios esta vacia. Lanza antes: pnpm ingest:municipios');
    process.exit(2);
  }
  const indice = new IndiceMunicipios(callejero);
  console.log(`Callejero: ${indice.tamano} municipios.`);

  // --- Municipal ----------------------------------------------------------
  console.log('\nMITMA 35103500 (municipios):');
  const bufMunicipal = await obtenerXls(URL_MUNICIPAL, '35103500.XLS', opciones.offline);
  const libroMunicipal = abrirXls(bufMunicipal, '35103500.XLS');
  const hoja = opciones.hoja ?? ultimaHojaTrimestral(libroMunicipal);
  const periodo = periodoDeHoja(hoja);
  const fechaDato = fechaCierreTrimestre(periodo);
  const filas = leerTablaMunicipal(libroMunicipal, hoja);
  console.log(`  hoja ${hoja.trim()} -> periodo ${periodo} (${fechaDato}), ${filas.length} municipios`);

  const resueltos: {
    codigoIne: string;
    nombreMitma: string;
    fila: (typeof filas)[number];
    como: string;
  }[] = [];
  const sinCasar: string[] = [];
  const ambiguos: string[] = [];
  const provinciaCorregida: string[] = [];

  for (const f of filas) {
    const r = indice.emparejar(f.municipio, f.provinciaArrastrada, alias);
    if (r.estado === 'sin_casar') {
      sinCasar.push(`${f.municipio} [${f.provinciaArrastrada ?? '?'}]`);
      continue;
    }
    if (r.estado === 'ambiguo') {
      ambiguos.push(
        `${f.municipio} [${f.provinciaArrastrada ?? '?'}] -> ${r.candidatos.map((c) => `${c.codigoIne} ${c.provincia}`).join(', ')}`,
      );
      continue;
    }
    const delCallejero = indice.porCodigoIne(r.codigoIne);
    if (delCallejero === undefined) {
      sinCasar.push(`${f.municipio}: el alias apunta a ${r.codigoIne}, que no esta en el callejero`);
      continue;
    }
    // La provincia arrastrada del XLS puede mentir. Se deja constancia.
    if (
      f.provinciaArrastrada !== null &&
      !delCallejero.provincia.toLowerCase().includes(f.provinciaArrastrada.toLowerCase().split(' ')[0] ?? '')
    ) {
      provinciaCorregida.push(
        `${f.municipio}: el XLS lo pone bajo "${f.provinciaArrastrada}" y es de ${delCallejero.provincia} (${r.codigoIne})`,
      );
    }
    resueltos.push({ codigoIne: r.codigoIne, nombreMitma: f.municipio, fila: f, como: r.estado });
  }

  console.log(`  resueltos ${resueltos.length} de ${filas.length}`);
  const porComo = new Map<string, number>();
  for (const r of resueltos) porComo.set(r.como, (porComo.get(r.como) ?? 0) + 1);
  for (const [k, v] of porComo) console.log(`    ${k}: ${v}`);

  for (const p of provinciaCorregida) console.log(`  PROVINCIA CORREGIDA: ${p}`);
  for (const a of ambiguos) console.log(`  AMBIGUO (no se ingesta): ${a}`);
  for (const s of sinCasar) console.log(`  SIN CASAR (no se ingesta): ${s}`);

  const noResueltos = sinCasar.length + ambiguos.length;
  if (noResueltos > MAXIMO_SIN_CASAR) {
    console.error(
      `\n${noResueltos} municipios sin resolver, mas de los ${MAXIMO_SIN_CASAR} tolerados.\n` +
        'Probablemente ha cambiado el formato del XLS o el callejero. No se escribe nada.',
    );
    process.exit(2);
  }

  // --- Territorial --------------------------------------------------------
  console.log('\nMITMA 35101000 (provincias):');
  const bufProvincial = await obtenerXls(URL_PROVINCIAL, '35101000.XLS', opciones.offline);
  const libroProvincial = abrirXls(bufProvincial, '35101000.XLS');
  const hojaProvincial = libroProvincial.hojas[libroProvincial.hojas.length - 1] as string;
  const territorial = leerTablaTerritorial(libroProvincial, hojaProvincial);
  console.log(`  hoja ${hojaProvincial} -> periodo ${territorial.periodo}, ${territorial.filas.length} filas`);

  // Solo se guardan las provincias: nacional y CCAA no los consume el motor, y
  // guardarlos con ambito 'provincial' seria mentir sobre lo que son.
  // Se usa el mismo generador de variantes que para los municipios: MITMA
  // escribe "Balears (Illes)", "Coruna (A)" y "Alicante/Alacant" donde el INE
  // pone "Balears, Illes", "Coruna, A" y "Alicante/Alacant".
  const provinciasPorNombre = new Map<string, string>();
  for (const m of callejero) {
    for (const v of variantesDelNombre(m.provincia)) {
      provinciasPorNombre.set(v, m.codigoProvincia);
    }
  }

  // En las CCAA uniprovinciales MITMA solo pone la fila de la comunidad
  // ("Madrid (Comunidad de)", "Asturias (Principado de )"), y ahi comunidad y
  // provincia son el mismo territorio con el mismo EUR/m2. Sin esto se pierden
  // Madrid, Murcia, Navarra y Asturias, que no es poca cosa.
  const provinciasDeCcaa = new Map<string, Set<string>>();
  for (const m of callejero) {
    const y = provinciasDeCcaa.get(m.ccaa) ?? new Set<string>();
    y.add(m.codigoProvincia);
    provinciasDeCcaa.set(m.ccaa, y);
  }
  for (const [nombreCcaa, codigos] of provinciasDeCcaa) {
    if (codigos.size !== 1) continue;
    const unica = [...codigos][0] as string;
    for (const v of variantesDelNombre(nombreCcaa)) {
      if (!provinciasPorNombre.has(v)) provinciasPorNombre.set(v, unica);
    }
  }
  const provinciales: { codigo: string; eurM2: number }[] = [];
  const territorialesIgnorados: string[] = [];
  for (const f of territorial.filas) {
    const codigo = variantesDelNombre(f.nombre)
      .map((v) => provinciasPorNombre.get(v))
      .find((c) => c !== undefined);
    if (codigo === undefined) {
      // Las filas de CCAA y la nacional caen aqui a proposito.
      territorialesIgnorados.push(f.nombre.trim());
      continue;
    }
    provinciales.push({ codigo, eurM2: f.eurM2 });
  }

  // Con las uniprovinciales resueltas salen las 52. MITMA ademas trae una fila
  // "Ceuta y Melilla" agregada que NO se usa: ese dato no se reparte entre las dos.
  const ESPERADAS = 52;
  console.log(`  provincias reconocidas: ${provinciales.length} de ${ESPERADAS} posibles`);
  console.log(`  filas que no son provincia (nacional, CCAA y "Ceuta y Melilla"): ${territorialesIgnorados.length}`);

  if (provinciales.length < ESPERADAS) {
    console.error(
      `
Solo ${provinciales.length} provincias reconocidas de ${ESPERADAS}. No se escribe nada.
` +
        `Sin reconocer: ${territorialesIgnorados.join(", ")}`,
    );
    process.exit(2);
  }

  // --- Escritura ----------------------------------------------------------
  const [fuente] = await db
    .insert(fuentesDatos)
    .values({
      fuente: 'mitma',
      origen: 'descarga_batch',
      url: URL_MUNICIPAL,
      periodo,
      checksum: sha256(bufMunicipal),
      filasImportadas: resueltos.length * 3 + provinciales.length,
      notas:
        `Series 35103500 (hoja ${hoja.trim()}) y 35101000 (hoja ${hojaProvincial}). ` +
        `EUR/m2 sobre superficie construida. ${noResueltos} municipios sin resolver.`,
    })
    .returning();
  if (fuente === undefined) throw new Error('No se ha podido crear la fila de fuentes_datos.');

  const valores: (typeof mitmaPrecios.$inferInsert)[] = [];
  for (const r of resueltos) {
    const segmentos: [string, number | null, number | null][] = [
      ['hasta_5', r.fila.eurM2HastaCincoAnios, r.fila.tasacionesHastaCincoAnios],
      ['mas_de_5', r.fila.eurM2MasDeCincoAnios, r.fila.tasacionesMasDeCincoAnios],
      [
        'total',
        r.fila.eurM2Total,
        (r.fila.tasacionesHastaCincoAnios ?? 0) + (r.fila.tasacionesMasDeCincoAnios ?? 0) || null,
      ],
    ];
    for (const [segmento, eurM2, n] of segmentos) {
      // "n.r" (muestra no representativa) llega como null. No se guarda un cero.
      if (eurM2 === null) continue;
      valores.push({
        ambito: 'municipio',
        codigo: r.codigoIne,
        periodo,
        fechaDato,
        segmento,
        eurM2: eurM2.toFixed(2),
        nTasaciones: n,
        baseSuperficie: 'construida',
        fuenteId: fuente.id,
      });
    }
  }
  for (const p of provinciales) {
    valores.push({
      ambito: 'provincia',
      codigo: p.codigo,
      periodo: territorial.periodo,
      fechaDato: fechaCierreTrimestre(territorial.periodo),
      segmento: 'total',
      eurM2: p.eurM2.toFixed(2),
      nTasaciones: null,
      baseSuperficie: 'construida',
      fuenteId: fuente.id,
    });
  }

  const LOTE = 500;
  for (let i = 0; i < valores.length; i += LOTE) {
    await db
      .insert(mitmaPrecios)
      .values(valores.slice(i, i + LOTE))
      .onConflictDoUpdate({
        target: [mitmaPrecios.ambito, mitmaPrecios.codigo, mitmaPrecios.periodo, mitmaPrecios.segmento],
        set: {
          eurM2: sql`excluded.eur_m2`,
          nTasaciones: sql`excluded.n_tasaciones`,
          fechaDato: sql`excluded.fecha_dato`,
          fuenteId: sql`excluded.fuente_id`,
        },
      });
  }

  // Marca que municipios tienen dato municipal: es mas honesto que un umbral de
  // poblacion, porque es lo que MITMA publica de verdad.
  const conDato = [...new Set(resueltos.map((r) => r.codigoIne))];
  await db.update(municipios).set({ tieneDatoMitmaMunicipal: false }).where(eq(municipios.tieneDatoMitmaMunicipal, true));
  for (let i = 0; i < conDato.length; i += LOTE) {
    await db
      .update(municipios)
      .set({ tieneDatoMitmaMunicipal: true })
      .where(inArray(municipios.codigoIne, conDato.slice(i, i + LOTE)));
  }

  // Fixture derivado, que si se versiona: permite revisar en el diff que ha
  // cambiado entre trimestres sin abrir un XLS de 4 MB.
  const derivado = {
    serie_municipal: '35103500',
    serie_provincial: '35101000',
    periodo,
    unidad: 'EUR/m2',
    base_superficie: 'construida',
    municipios: resueltos.length,
    provincias: provinciales.length,
    sin_resolver: [...sinCasar, ...ambiguos],
    provincia_corregida: provinciaCorregida,
    datos: resueltos.map((r) => ({
      codigo_ine: r.codigoIne,
      nombre_mitma: r.nombreMitma,
      nombre_ine: indice.porCodigoIne(r.codigoIne)?.nombre ?? null,
      provincia: indice.porCodigoIne(r.codigoIne)?.provincia ?? null,
      eur_m2_hasta_5_anios: r.fila.eurM2HastaCincoAnios,
      eur_m2_mas_de_5_anios: r.fila.eurM2MasDeCincoAnios,
      eur_m2_total: r.fila.eurM2Total,
      tasaciones_hasta_5_anios: r.fila.tasacionesHastaCincoAnios,
      tasaciones_mas_de_5_anios: r.fila.tasacionesMasDeCincoAnios,
    })),
  };
  writeFileSync(
    join(DIR_FIXTURES, '35103500-municipios-ultimo-trimestre.json'),
    `${JSON.stringify(derivado, null, 2)}\n`,
    'utf8',
  );

  console.log(
    `\n${valores.length} precios escritos (${resueltos.length} municipios x segmento + ${provinciales.length} provincias).`,
  );
  console.log(`fuentes_datos id=${fuente.id}, periodo ${periodo}.`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error('\nFallo la ingesta de MITMA:', e instanceof Error ? e.message : e);
  process.exit(1);
});
