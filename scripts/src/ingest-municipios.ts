/**
 * CLI: pnpm ingest:municipios
 *
 * Puebla la tabla municipios con el callejero oficial del INE: codigo de 5
 * digitos, nombre, provincia y comunidad autonoma.
 *
 * Es la primera ingesta porque todo lo demas se cruza por aqui. MITMA publica
 * su serie por NOMBRE de municipio, no por codigo; sin este diccionario no hay
 * forma de llevar un EUR/m2 a la tabla de precios ni de cruzarlo con la ficha
 * catastral, que si da codigo INE.
 *
 * Fuente: API del INE (wstempus).
 *
 *   VALORES_VARIABLE/70              comunidades autonomas
 *   VALORES_VARIABLE/115             provincias
 *   VALORES_HIJOS/115/{idProvincia}  municipios de esa provincia
 *
 * Por que provincia a provincia y no de una vez: VALORES_VARIABLE/19 devuelve
 * los municipios de toda Espana, pero el servidor CORTA la respuesta alrededor
 * de los 256 KB y el JSON llega partido a mitad de registro. Comprobado el
 * 2026-08-23: se queda en 2.829 de 8.142. Pedirlos por provincia da respuestas
 * de 15 KB que llegan enteras.
 */

import { createHash } from 'node:crypto';

import { crearDb, fuentesDatos, municipios } from '@vp/db';
import { nombreDeLaBase, requiereDatabaseUrl } from '@vp/db/env';
import { sql } from 'drizzle-orm';

const BASE_INE = 'https://servicios.ine.es/wstempus/js/ES';
const TIMEOUT_MS = 30_000;

/** Id de la variable "Municipios" en el wstempus. */
const VARIABLE_MUNICIPIOS = 19;

interface ValorIne {
  Id: number;
  FK_Variable: number;
  Nombre: string;
  Codigo?: string;
  FK_JerarquiaPadres?: number[];
}

async function pedir(ruta: string): Promise<ValorIne[]> {
  const url = `${BASE_INE}/${ruta}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`INE devuelve HTTP ${res.status} en ${url}`);
  }
  const texto = await res.text();
  try {
    return JSON.parse(texto) as ValorIne[];
  } catch {
    // Es exactamente el sintoma del corte por tamano: se para y se avisa en
    // lugar de quedarse con los municipios que hayan cabido.
    throw new Error(
      `La respuesta de ${url} no es JSON valido (${texto.length} bytes). ` +
        'Si termina a mitad de registro, el INE ha cortado la respuesta.',
    );
  }
}

interface FilaMunicipio {
  codigoIne: string;
  nombre: string;
  codigoProvincia: string;
  provincia: string;
  ccaa: string;
}

export async function descargarMunicipios(): Promise<{
  filas: FilaMunicipio[];
  avisos: string[];
}> {
  const avisos: string[] = [];

  const ccaas = await pedir('VALORES_VARIABLE/70');
  const provincias = (await pedir('VALORES_VARIABLE/115')).filter(
    (p) => p.Codigo !== undefined && p.Codigo.length === 2 && p.Codigo !== '00',
  );
  if (provincias.length !== 52) {
    avisos.push(`El INE ha devuelto ${provincias.length} provincias y se esperaban 52.`);
  }

  const ccaaPorId = new Map(ccaas.map((c) => [c.Id, c]));
  const filas: FilaMunicipio[] = [];
  const vistos = new Map<string, string>();

  for (const p of provincias) {
    const padre = (p.FK_JerarquiaPadres ?? [])
      .map((id) => ccaaPorId.get(id))
      .find((c) => c !== undefined && c.Codigo !== undefined && c.Codigo !== '00');
    if (padre === undefined) {
      avisos.push(`La provincia ${p.Nombre} no resuelve su CCAA en la variable 70.`);
      continue;
    }

    const hijos = await pedir(`VALORES_HIJOS/115/${p.Id}`);
    // Los hijos mezclan municipios (variable 19) y comarcas (variable 953).
    const muns = hijos.filter(
      (h) => h.FK_Variable === VARIABLE_MUNICIPIOS && h.Codigo !== undefined && h.Codigo.length === 5,
    );

    for (const m of muns) {
      const codigo = m.Codigo as string;
      if (!codigo.startsWith(p.Codigo as string)) {
        avisos.push(`${m.Nombre} (${codigo}) aparece bajo ${p.Nombre} pero su codigo es de otra provincia.`);
        continue;
      }
      const yaVisto = vistos.get(codigo);
      if (yaVisto !== undefined) {
        avisos.push(`Codigo repetido ${codigo}: "${yaVisto}" y "${m.Nombre}".`);
        continue;
      }
      vistos.set(codigo, m.Nombre);
      filas.push({
        codigoIne: codigo,
        nombre: m.Nombre,
        codigoProvincia: p.Codigo as string,
        provincia: p.Nombre,
        ccaa: padre.Nombre,
      });
    }
  }

  return { filas, avisos };
}

async function main(): Promise<void> {
  const url = requiereDatabaseUrl();
  console.log(`Base: ${nombreDeLaBase(url)}`);
  console.log('Descargando el callejero del INE, provincia a provincia...');

  const { filas, avisos } = await descargarMunicipios();
  console.log(`  ${filas.length} municipios en 52 provincias.`);

  for (const a of avisos) console.log(`  AVISO: ${a}`);

  if (filas.length < 8000) {
    console.error(
      `Solo ${filas.length} municipios. Espana tiene algo mas de 8.100, asi que ` +
        'falta algo. No se escribe nada.',
    );
    process.exit(2);
  }

  // El checksum permite ver de un vistazo si una reingesta traia lo mismo.
  const checksum = createHash('sha256')
    .update(filas.map((f) => `${f.codigoIne}|${f.nombre}`).join('\n'))
    .digest('hex');

  const db = crearDb(url);

  const [fuente] = await db
    .insert(fuentesDatos)
    .values({
      fuente: 'ine',
      origen: 'api',
      url: `${BASE_INE}/VALORES_HIJOS/115/{idProvincia}`,
      periodo: null,
      checksum,
      filasImportadas: filas.length,
      notas:
        'Callejero de municipios del INE (variables 70, 115 y 19). Pedido por provincia ' +
        'porque VALORES_VARIABLE/19 corta la respuesta alrededor de 256 KB.',
    })
    .returning();

  if (fuente === undefined) throw new Error('No se ha podido crear la fila de fuentes_datos.');

  // Upsert: el callejero cambia poco pero cambia (fusiones, cambios de nombre).
  // Se conserva poblacion y tiene_dato_mitma_municipal, que los pone otra ingesta.
  let escritos = 0;
  const LOTE = 500;
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    await db
      .insert(municipios)
      .values(lote)
      .onConflictDoUpdate({
        target: municipios.codigoIne,
        set: {
          nombre: sql`excluded.nombre`,
          codigoProvincia: sql`excluded.codigo_provincia`,
          provincia: sql`excluded.provincia`,
          ccaa: sql`excluded.ccaa`,
        },
      });
    escritos += lote.length;
  }

  console.log(`\n${escritos} municipios escritos. fuentes_datos id=${fuente.id}, checksum ${checksum.slice(0, 12)}.`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error('\nFallo la ingesta de municipios:', e instanceof Error ? e.message : e);
  process.exit(1);
});
