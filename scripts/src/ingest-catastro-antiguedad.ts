/**
 * CLI: pnpm ingest:antiguedad <codigoCatastro> [--municipio="Nombre"]
 *
 * Calcula la antiguedad media del parque residencial de un municipio a partir
 * del dataset INSPIRE de edificios del Catastro, y la desglosa por codigo
 * postal si esta tambien el dataset de direcciones.
 *
 * Para que sirve: es la referencia contra la que T1 deprecia por antiguedad.
 * Sin ella habria que depreciar contra obra nueva, y eso cuenta dos veces la
 * antiguedad porque el EUR/m2 de la zona ya la lleva dentro. Es el parametro
 * que mas movia el resultado mientras estuvo sin fijar.
 *
 * Dos reglas que hay que respetar al usar el resultado:
 *
 *   1. La media va ponderada por NUMERO DE VIVIENDAS, no por edificios. El
 *      precio de referencia es por vivienda, asi que un bloque de 40 pisos de
 *      1970 pesa cuarenta veces mas que un unifamiliar del mismo ano.
 *   2. La edad tiene que describir la MISMA poblacion que el precio. Con precio
 *      municipal, edad municipal. La edad por codigo postal solo se usa cuando
 *      el precio tambien sea por codigo postal (Notariado); mezclar ambitos es
 *      peor que no afinar.
 */
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ANIO_ACTUAL = new Date().getFullYear();
/** MITMA separa "hasta 5 anos" de "mas de 5 anos". */
const ANIOS_OBRA_RECIENTE = 5;

/** Viviendas por ano de construccion. */
type PorAnio = Map<number, number>;

interface Agregado {
  municipio: PorAnio;
  porCodigoPostal: Map<string, PorAnio>;
  edificios: number;
  leidos: number;
  sinCodigoPostal: number;
  descartes: Map<string, number>;
}

function sumar(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}

function acumular(m: PorAnio, anio: number, n: number): void {
  m.set(anio, (m.get(anio) ?? 0) + n);
}

// ---------------------------------------------------------------------------
// Direcciones: referencia catastral -> codigo postal
// ---------------------------------------------------------------------------

const RE_AD_LOCALID = /<base:localId>([^<]*)</;
const RE_AD_POSTAL = /ES\.SDGC\.PD\.\d+\.\d+\.(\d{5})/;

/**
 * El localId de una direccion es "12.900.1.10.2003206YK5320S": el ultimo
 * segmento es la referencia catastral, que es lo que identifica al edificio.
 * El codigo postal viaja en el componente PostalDescriptor.
 */
async function cargarCodigosPostales(ruta: string): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const lector = createInterface({ input: createReadStream(ruta, { encoding: 'utf8' }) });

  let bloque: string | null = null;
  const procesar = (b: string): void => {
    const localId = RE_AD_LOCALID.exec(b)?.[1];
    const cp = RE_AD_POSTAL.exec(b)?.[1];
    if (localId === undefined || cp === undefined) return;
    const rc = localId.split('.').pop();
    if (rc !== undefined && rc.length >= 14) mapa.set(rc, cp);
  };

  for await (const linea of lector) {
    if (linea.includes('<AD:Address ')) {
      if (bloque !== null) procesar(bloque);
      bloque = linea;
    } else if (bloque !== null) {
      if (!linea.includes('gml:pos')) bloque += linea;
    }
  }
  if (bloque !== null) procesar(bloque);
  return mapa;
}

// ---------------------------------------------------------------------------
// Edificios
// ---------------------------------------------------------------------------

const RE_ANIO = /:beginning>(\d{4})/;
const RE_USO = /:currentUse>([^<]*)</;
const RE_CONDICION = /:conditionOfConstruction>([^<]*)</;
const RE_VIVIENDAS = /:numberOfDwellings>(\d+)</;
const RE_BU_LOCALID = /<base:localId>([^<]*)</;

function procesarEdificio(bloque: string, ac: Agregado, cps: Map<string, string> | null): void {
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

  acumular(ac.municipio, anio, viviendas);
  ac.edificios += 1;

  if (cps === null) return;
  const rc = RE_BU_LOCALID.exec(bloque)?.[1];
  const cp = rc === undefined ? undefined : cps.get(rc);
  if (cp === undefined) {
    ac.sinCodigoPostal += viviendas;
    return;
  }
  let porAnio = ac.porCodigoPostal.get(cp);
  if (porAnio === undefined) {
    porAnio = new Map();
    ac.porCodigoPostal.set(cp, porAnio);
  }
  acumular(porAnio, anio, viviendas);
}

/**
 * Recorre el GML por lineas. Son mas de 100 MB, asi que no se carga entero: se
 * acumula un edificio cada vez y se descarta la geometria, que es la mayor
 * parte del fichero y aqui no aporta nada.
 */
async function recorrer(ruta: string, cps: Map<string, string> | null): Promise<Agregado> {
  const ac: Agregado = {
    municipio: new Map(),
    porCodigoPostal: new Map(),
    edificios: 0,
    leidos: 0,
    sinCodigoPostal: 0,
    descartes: new Map(),
  };
  const lector = createInterface({ input: createReadStream(ruta, { encoding: 'utf8' }) });

  let bloque: string | null = null;
  for await (const linea of lector) {
    if (linea.includes('<bu-ext2d:Building ')) {
      if (bloque !== null) procesarEdificio(bloque, ac, cps);
      bloque = linea;
    } else if (bloque !== null) {
      if (!linea.includes('gml:posList') && !linea.includes('Corner')) bloque += linea;
    }
  }
  if (bloque !== null) procesarEdificio(bloque, ac, cps);
  return ac;
}

// ---------------------------------------------------------------------------
// Estadisticos
// ---------------------------------------------------------------------------

interface Estadisticos {
  viviendas_computadas: number;
  anio_medio_ponderado: number;
  anio_mediano: number;
  edad_media_anios: number;
  edad_mediana_anios: number;
}

function estadisticos(viviendas: PorAnio, anioCorte: number | null): Estadisticos | null {
  const entradas = [...viviendas.entries()]
    .filter(([anio]) => anioCorte === null || anio < anioCorte)
    .sort((a, b) => a[0] - b[0]);

  const total = entradas.reduce((s, [, n]) => s + n, 0);
  if (total === 0 || entradas[0] === undefined) return null;

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

function exigir(e: Estadisticos | null, que: string): Estadisticos {
  if (e === null) throw new Error(`No hay viviendas que computar para ${que}.`);
  return e;
}

// ---------------------------------------------------------------------------

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

  // El desglose por codigo postal es opcional: sin el dataset de direcciones,
  // sale solo la cifra municipal.
  const ad = resolve(RAIZ, 'fixtures', 'catastro', `A.ES.SDGC.AD.${codigo}.gml`);
  let cps: Map<string, string> | null = null;
  if (existsSync(ad)) {
    console.log(`Leyendo direcciones de ${ad}...`);
    cps = await cargarCodigosPostales(ad);
    console.log(`  ${cps.size.toLocaleString('es-ES')} referencias catastrales con codigo postal`);
  } else {
    console.log(
      'Sin dataset de direcciones: no habra desglose por codigo postal.\n' +
        `  Descargalo de https://www.catastro.hacienda.gob.es/INSPIRE/Addresses/${provincia}/`,
    );
  }

  console.log(`Recorriendo ${gml}...`);
  const ac = await recorrer(gml, cps);

  const completo = exigir(estadisticos(ac.municipio, null), 'el municipio');
  const masDeCinco = exigir(
    estadisticos(ac.municipio, ANIO_ACTUAL - ANIOS_OBRA_RECIENTE),
    'el municipio',
  );

  const decadas = new Map<number, number>();
  for (const [anio, n] of ac.municipio) {
    const d = Math.floor(anio / 10) * 10;
    decadas.set(d, (decadas.get(d) ?? 0) + n);
  }

  const porCp: Record<string, unknown> = {};
  for (const [cp, porAnio] of [...ac.porCodigoPostal].sort((a, b) => a[0].localeCompare(b[0]))) {
    const todo = estadisticos(porAnio, null);
    const mas5 = estadisticos(porAnio, ANIO_ACTUAL - ANIOS_OBRA_RECIENTE);
    if (todo === null) continue;
    porCp[cp] = { parque_completo: todo, parque_de_mas_de_5_anios: mas5 };
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
    por_codigo_postal: {
      _doc:
        'USAR SOLO con un precio del mismo ambito. Con precio municipal (MITMA) hay que usar la cifra ' +
        'municipal: mezclar la edad de un barrio con el precio medio de la ciudad es peor que no afinar. ' +
        'Esto queda listo para cuando haya precios por codigo postal del Notariado.',
      viviendas_sin_codigo_postal: ac.sinCodigoPostal,
      ...porCp,
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
    `\nMUNICIPIO   parque completo ${completo.edad_media_anios} anos  |  mas de 5 anos ${masDeCinco.edad_media_anios} anos`,
  );

  if (Object.keys(porCp).length > 0) {
    console.log('\nPOR CODIGO POSTAL (edad media del parque de mas de 5 anos):');
    for (const [cp, datos] of Object.entries(porCp)) {
      const d = datos as { parque_de_mas_de_5_anios: Estadisticos | null };
      const e = d.parque_de_mas_de_5_anios;
      if (e === null) continue;
      const delta = e.edad_media_anios - masDeCinco.edad_media_anios;
      const signo = delta >= 0 ? '+' : '';
      console.log(
        `   ${cp}  ${String(e.edad_media_anios).padStart(6)} anos  ` +
          `(${signo}${delta.toFixed(1)} vs municipio)  ` +
          `${e.viviendas_computadas.toLocaleString('es-ES').padStart(8)} viviendas`,
      );
    }
    console.log(
      `   sin CP  ${ac.sinCodigoPostal.toLocaleString('es-ES')} viviendas sin direccion cruzada`,
    );
  }

  console.log(`\nEscrito en ${destino}`);
}

main().catch((error: unknown) => {
  console.error('Fallo la ingesta:', error);
  process.exit(1);
});
