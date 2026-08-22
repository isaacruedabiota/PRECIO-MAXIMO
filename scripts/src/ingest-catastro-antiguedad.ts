/**
 * CLI: pnpm ingest:antiguedad <codigoCatastro> [--municipio="Nombre"]
 *
 * Calcula la antiguedad media del parque residencial de un municipio a partir
 * del dataset INSPIRE de edificios del Catastro.
 *
 * Para que sirve: es la referencia contra la que T1 deprecia por antiguedad.
 * Sin ella habria que depreciar contra obra nueva, y eso cuenta dos veces la
 * antiguedad porque el EUR/m2 de la zona ya la lleva dentro. Es el parametro
 * que mas movia el resultado mientras estuvo sin fijar.
 *
 * La media va ponderada por NUMERO DE VIVIENDAS, no por edificios: el precio de
 * referencia es por vivienda, asi que un bloque de 40 pisos de 1970 pesa
 * cuarenta veces mas que un unifamiliar del mismo ano.
 *
 * Se calculan dos cifras: la del parque completo y la del parque construido
 * hace mas de cinco anos, que es la que describe la serie de MITMA de "vivienda
 * de mas de 5 anos" que alimenta T1. Hay que usar la que case con el precio.
 */
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ANIO_ACTUAL = new Date().getFullYear();
/** MITMA separa "hasta 5 anos" de "mas de 5 anos". */
const ANIOS_OBRA_RECIENTE = 5;

interface Agregado {
  viviendas: Map<number, number>;
  edificios: number;
  leidos: number;
  descartes: Map<string, number>;
}

function sumar(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}

const RE_ANIO = /:beginning>(\d{4})/;
const RE_USO = /:currentUse>([^<]*)</;
const RE_CONDICION = /:conditionOfConstruction>([^<]*)</;
const RE_VIVIENDAS = /:numberOfDwellings>(\d+)</;

function procesarBloque(bloque: string, ac: Agregado): void {
  ac.leidos += 1;

  const anio = Number(RE_ANIO.exec(bloque)?.[1] ?? Number.NaN);
  const uso = RE_USO.exec(bloque)?.[1]?.trim() ?? '';
  const condicion = RE_CONDICION.exec(bloque)?.[1]?.trim() ?? '';
  const viviendas = Number(RE_VIVIENDAS.exec(bloque)?.[1] ?? 0);

  if (!Number.isFinite(anio) || anio < 1500 || anio > ANIO_ACTUAL) {
    sumar(ac.descartes, 'ano invalido o ausente');
    return;
  }
  if (!uso.startsWith('1_residential')) {
    sumar(ac.descartes, 'uso no residencial');
    return;
  }
  // Ruinas y edificios derruidos no forman parte del parque que se compra.
  if (condicion !== 'functional') {
    sumar(ac.descartes, `condicion ${condicion || 'sin declarar'}`);
    return;
  }
  if (viviendas <= 0) {
    sumar(ac.descartes, 'sin viviendas declaradas');
    return;
  }

  ac.viviendas.set(anio, (ac.viviendas.get(anio) ?? 0) + viviendas);
  ac.edificios += 1;
}

/**
 * Recorre el GML por lineas. Son mas de 100 MB, asi que no se carga entero: se
 * acumula un edificio cada vez y se descarta la geometria, que es la mayor
 * parte del fichero y aqui no aporta nada.
 */
async function recorrer(ruta: string): Promise<Agregado> {
  const ac: Agregado = { viviendas: new Map(), edificios: 0, leidos: 0, descartes: new Map() };
  const lector = createInterface({ input: createReadStream(ruta, { encoding: 'utf8' }) });

  let bloque: string | null = null;
  for await (const linea of lector) {
    if (linea.includes('<bu-ext2d:Building ')) {
      if (bloque !== null) procesarBloque(bloque, ac);
      bloque = linea;
    } else if (bloque !== null) {
      if (!linea.includes('gml:posList') && !linea.includes('Corner')) bloque += linea;
    }
  }
  if (bloque !== null) procesarBloque(bloque, ac);
  return ac;
}

interface Estadisticos {
  viviendas_computadas: number;
  anio_medio_ponderado: number;
  anio_mediano: number;
  edad_media_anios: number;
  edad_mediana_anios: number;
}

function estadisticos(viviendas: Map<number, number>, anioCorte: number | null): Estadisticos {
  const entradas = [...viviendas.entries()]
    .filter(([anio]) => anioCorte === null || anio < anioCorte)
    .sort((a, b) => a[0] - b[0]);

  const total = entradas.reduce((s, [, n]) => s + n, 0);
  if (total === 0 || entradas[0] === undefined) {
    throw new Error('No hay viviendas que computar con ese criterio.');
  }

  const media = entradas.reduce((s, [anio, n]) => s + anio * n, 0) / total;

  let acumulado = 0;
  let mediana = entradas[0][0];
  for (const [anio, n] of entradas) {
    acumulado += n;
    if (acumulado >= total / 2) {
      mediana = anio;
      break;
    }
  }

  const r2 = (x: number): number => Math.round(x * 100) / 100;
  return {
    viviendas_computadas: total,
    anio_medio_ponderado: r2(media),
    anio_mediano: mediana,
    edad_media_anios: r2(ANIO_ACTUAL - media),
    edad_mediana_anios: ANIO_ACTUAL - mediana,
  };
}

async function main(): Promise<void> {
  const codigo = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (codigo === undefined) {
    console.error('Uso: pnpm ingest:antiguedad <codigoCatastro>   (por ejemplo 12900)');
    process.exit(1);
  }
  const provincia = codigo.slice(0, 2);
  const municipio =
    process.argv.find((a) => a.startsWith('--municipio='))?.split('=')[1] ?? `Municipio ${codigo}`;

  const gml = resolve(RAIZ, 'fixtures', 'catastro', `A.ES.SDGC.BU.${codigo}.building.gml`);
  if (!existsSync(gml)) {
    console.error(
      `No esta el dataset de edificios de ${codigo}.\n\n` +
        'Busca el municipio en el ATOM provincial y descarga su zip:\n' +
        `  https://www.catastro.hacienda.gob.es/INSPIRE/buildings/${provincia}/ES.SDGC.bu.atom_${provincia}.xml\n\n` +
        'Luego extrae solo el fichero de edificios:\n' +
        `  cd fixtures/catastro && unzip -o bu-${codigo}.zip "A.ES.SDGC.BU.${codigo}.building.gml"\n\n` +
        'El GML no se versiona: pasa de 100 MB y se re-descarga del ATOM cuando haga falta.',
    );
    process.exit(1);
  }

  console.log(`Recorriendo ${gml}...`);
  const ac = await recorrer(gml);

  const completo = estadisticos(ac.viviendas, null);
  const masDeCinco = estadisticos(ac.viviendas, ANIO_ACTUAL - ANIOS_OBRA_RECIENTE);

  const decadas = new Map<number, number>();
  for (const [anio, n] of ac.viviendas) {
    const d = Math.floor(anio / 10) * 10;
    decadas.set(d, (decadas.get(d) ?? 0) + n);
  }

  const salida = {
    municipio,
    codigo_catastro: codigo,
    fuente: 'Catastro INSPIRE, dataset Buildings del municipio',
    url_atom: `https://www.catastro.hacienda.gob.es/INSPIRE/buildings/${provincia}/ES.SDGC.bu.atom_${provincia}.xml`,
    // Fecha del propio dataset del Catastro, no la de ejecucion. Es la que
    // viaja al informe como fecha_dato del coeficiente de antiguedad.
    fecha_dataset_gml: statSync(gml).mtime.toISOString().slice(0, 10),
    generado_en: `${new Date().toISOString().slice(0, 19)}Z`,
    criterio:
      'Edificios con currentUse que empieza por 1_residential, conditionOfConstruction functional y ' +
      'numberOfDwellings > 0. Ano de dateOfConstruction/beginning. Media ponderada por numero de viviendas.',
    anio_referencia: ANIO_ACTUAL,
    edificios_en_el_fichero: ac.leidos,
    edificios_computados: ac.edificios,
    parque_completo: completo,
    parque_de_mas_de_5_anios: {
      _doc:
        'Excluye lo construido en los ultimos 5 anos. Es el parque que describe la serie de MITMA de ' +
        'vivienda de mas de 5 anos, que es la que alimenta T1.',
      anio_corte: ANIO_ACTUAL - ANIOS_OBRA_RECIENTE,
      ...masDeCinco,
    },
    viviendas_por_decada: Object.fromEntries([...decadas].sort((a, b) => a[0] - b[0])),
    descartes: Object.fromEntries([...ac.descartes].sort((a, b) => b[1] - a[1])),
  };

  const destino = resolve(RAIZ, 'fixtures', 'catastro', `${codigo}-antiguedad-parque.json`);
  writeFileSync(destino, `${JSON.stringify(salida, null, 2)}\n`, 'utf8');

  console.log(`\nEdificios leidos:      ${ac.leidos.toLocaleString('es-ES')}`);
  console.log(`Edificios computados:  ${ac.edificios.toLocaleString('es-ES')}`);
  console.log(`Viviendas:             ${completo.viviendas_computadas.toLocaleString('es-ES')}`);
  console.log(
    `\nParque completo:          edad media ${completo.edad_media_anios} anos, mediana ${completo.edad_mediana_anios}`,
  );
  console.log(
    `Parque de mas de 5 anos:  edad media ${masDeCinco.edad_media_anios} anos, mediana ${masDeCinco.edad_mediana_anios}`,
  );
  console.log(`\nEscrito en ${destino}`);
}

main().catch((error: unknown) => {
  console.error('Fallo la ingesta:', error);
  process.exit(1);
});
