/**
 * Captura una respuesta real de una fuente y la guarda en fixtures/.
 *
 * Es la primera herramienta de la Fase 2, y va antes que cualquier adaptador:
 * la regla del proyecto es programar contra respuestas reales capturadas, nunca
 * contra un esquema supuesto.
 *
 *   pnpm capture:fixture catastro dnprc --rc=2004930YK5320S0009RH
 *   pnpm capture:fixture catastro rccoor --lat=39.98 --lon=-0.05
 *   pnpm capture:fixture --lista
 *
 * Junto al cuerpo guarda un <fichero>.meta.json con URL, metodo, parametros,
 * codigo de estado, content-type y momento de captura. Un fixture sin esos
 * metadatos no permite detectar que la fuente ha cambiado, que es justo para lo
 * que existe.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');
const FIXTURES = join(RAIZ, 'fixtures');

const TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Recetas
// ---------------------------------------------------------------------------

type Args = Record<string, string>;

interface Receta {
  fuente: string;
  caso: string;
  descripcion: string;
  requiere: readonly string[];
  /** Sin extension: la pone el formato. */
  nombre: (a: Args) => string;
  url: (a: Args) => string;
  formato: 'json' | 'xml';
  notas?: readonly string[];
}

/**
 * Base de los servicios libres del Catastro. El brief apuntaba a
 * catastro.hacienda.gob.es; ese host no resuelve. El que responde es
 * ovc.catastro.meh.es, comprobado el 2026-08-22.
 */
const OVC = 'https://ovc.catastro.meh.es/OVCServWeb';
const OVC_LOC = 'https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC';

const RECETAS: readonly Receta[] = [
  {
    fuente: 'catastro',
    caso: 'dnprc',
    descripcion: 'Ficha de inmueble o listado de la parcela, por referencia catastral',
    requiere: ['rc'],
    nombre: (a) => `consulta-dnprc-${(a['rc'] ?? '').toLowerCase()}`,
    url: (a) =>
      `${OVC}/OVCWcfCallejero/COVCCallejero.svc/json/Consulta_DNPRC` +
      `?Provincia=&Municipio=&RefCat=${enc(a['rc'])}`,
    formato: 'json',
    notas: [
      'El parametro es RefCat, no RC como decia el brief.',
      'Con RC de 14 caracteres devuelve lrcdnp (listado de la parcela); con 20, bico (ficha).',
      'Datos no protegidos: no incluye titularidad.',
    ],
  },
  {
    fuente: 'catastro',
    caso: 'dnploc',
    descripcion: 'Inmuebles de una direccion (via, numero)',
    requiere: ['provincia', 'municipio', 'sigla', 'calle', 'numero'],
    nombre: (a) =>
      `consulta-dnploc-${slug(a['municipio'] ?? '')}-${slug(a['calle'] ?? '')}-${a['numero'] ?? ''}`,
    url: (a) =>
      `${OVC}/OVCWcfCallejero/COVCCallejero.svc/json/Consulta_DNPLOC` +
      `?Provincia=${enc(a['provincia'])}&Municipio=${enc(a['municipio'])}` +
      `&Sigla=${enc(a['sigla'])}&Calle=${enc(a['calle'])}&Numero=${enc(a['numero'])}` +
      `&Bloque=${enc(a['bloque'])}&Escalera=${enc(a['escalera'])}` +
      `&Planta=${enc(a['planta'])}&Puerta=${enc(a['puerta'])}`,
    formato: 'json',
  },
  {
    fuente: 'catastro',
    caso: 'rccoor',
    descripcion: 'Referencia catastral en unas coordenadas',
    requiere: ['lat', 'lon'],
    // Con las coordenadas en el nombre saldria algo como
    // "consulta-rccoor-39.98374409339--0.049271893410002". Se pide una
    // etiqueta para que el fichero sea legible y se pueda volver a capturar
    // con el mismo nombre.
    nombre: (a) => `consulta-rccoor-${slug(a['etiqueta'] ?? `${a['lat']}-${a['lon']}`)}`,
    url: (a) =>
      `${OVC_LOC}/OVCCoordenadas.asmx/Consulta_RCCOOR` +
      `?SRS=${enc(a['srs'] ?? 'EPSG:4326')}` +
      `&Coordenada_X=${enc(a['lon'])}&Coordenada_Y=${enc(a['lat'])}`,
    formato: 'xml',
    notas: [
      'La interfaz REST/JSON de este servicio (CoordenadasDistancia.svc) devuelve una',
      'pagina HTML de error. La que responde es la fachada HttpGet del .asmx, en XML.',
      'Coordenada_X es la longitud y Coordenada_Y la latitud.',
    ],
  },
  {
    fuente: 'ine',
    caso: 'valores-variable',
    descripcion: 'Valores de una variable del INE (70 = CCAA, 115 = provincias)',
    requiere: ['id'],
    nombre: (a) => `valores-variable-${a['id']}`,
    url: (a) => `https://servicios.ine.es/wstempus/js/ES/VALORES_VARIABLE/${enc(a['id'])}`,
    formato: 'json',
    notas: [
      'En la variable 115 (provincias) el primer elemento de FK_JerarquiaPadres es el',
      'Id de su CCAA en la variable 70. De ahi sale la correspondencia provincia -> CCAA.',
    ],
  },
  {
    fuente: 'catastro',
    caso: 'cpmrc',
    descripcion: 'Coordenadas de una referencia catastral',
    requiere: ['rc'],
    nombre: (a) => `consulta-cpmrc-${(a['rc'] ?? '').toLowerCase()}`,
    url: (a) =>
      `${OVC_LOC}/OVCCoordenadas.asmx/Consulta_CPMRC` +
      `?Provincia=&Municipio=&SRS=${enc(a['srs'] ?? 'EPSG:4326')}&RC=${enc(a['rc'])}`,
    formato: 'xml',
  },
];

function enc(v: string | undefined): string {
  return encodeURIComponent(v ?? '');
}

function slug(v: string): string {
  return v
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parsearArgs(argv: readonly string[]): { posicionales: string[]; flags: Args } {
  const posicionales: string[] = [];
  const flags: Args = {};
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, ...resto] = a.slice(2).split('=');
      flags[k ?? ''] = resto.join('=') || 'true';
    } else {
      posicionales.push(a);
    }
  }
  return { posicionales, flags };
}

function listar(): void {
  console.log('\nRecetas disponibles:\n');
  for (const r of RECETAS) {
    const req = r.requiere.map((x) => `--${x}=`).join(' ');
    console.log(`  ${r.fuente} ${r.caso}`);
    console.log(`      ${r.descripcion}`);
    console.log(`      pnpm capture:fixture ${r.fuente} ${r.caso} ${req}\n`);
  }
}

async function main(): Promise<void> {
  const { posicionales, flags } = parsearArgs(process.argv.slice(2));

  if (posicionales.length < 2) {
    listar();
    process.exit(flags['lista'] === undefined ? 1 : 0);
  }

  const [fuente, caso] = posicionales;
  const receta = RECETAS.find((r) => r.fuente === fuente && r.caso === caso);
  if (receta === undefined) {
    console.error(`No hay receta para "${fuente} ${caso}".`);
    listar();
    process.exit(1);
    return;
  }

  const faltan = receta.requiere.filter((k) => flags[k] === undefined || flags[k] === '');
  if (faltan.length > 0) {
    console.error(`Faltan parametros: ${faltan.map((f) => `--${f}`).join(', ')}`);
    process.exit(1);
  }

  const url = receta.url(flags);
  const capturado_en = new Date().toISOString();

  console.log(`GET ${url}`);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: receta.formato === 'json' ? 'application/json' : 'application/xml' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    console.error(`\nLa fuente no responde: ${(e as Error).message}`);
    console.error('No se guarda nada. Si el endpoint ha cambiado, se para y se avisa.');
    process.exit(2);
    return;
  }

  const cuerpo = await res.text();
  const contentType = res.headers.get('content-type');

  if (!res.ok) {
    console.error(`\nHTTP ${res.status}. No se guarda el fixture.`);
    console.error(cuerpo.slice(0, 500));
    process.exit(2);
  }

  // Una pagina HTML donde se esperaba JSON o XML significa que el endpoint ha
  // cambiado o rechaza la peticion, aunque devuelva 200. Guardarlo seria peor
  // que no guardar nada: el adaptador se programaria contra basura.
  if (/^\s*<(!doctype\s+html|html)\b/i.test(cuerpo)) {
    console.error(`\nLa respuesta es HTML, no ${receta.formato.toUpperCase()}. No se guarda.`);
    console.error('El endpoint ha cambiado o rechaza la peticion. Ver fixtures/README.md.');
    process.exit(2);
  }

  const dir = join(FIXTURES, receta.fuente);
  mkdirSync(dir, { recursive: true });

  const base = receta.nombre(flags);
  const ficheroCuerpo = join(dir, `${base}.${receta.formato}`);
  const ficheroMeta = join(dir, `${base}.meta.json`);

  const cuerpoFormateado = receta.formato === 'json' ? intentarFormatearJson(cuerpo) : cuerpo;
  writeFileSync(ficheroCuerpo, cuerpoFormateado, 'utf8');

  const parametros: Args = {};
  for (const k of Object.keys(flags)) {
    if (k !== 'notas') parametros[k] = flags[k] ?? '';
  }

  const meta = {
    url,
    metodo: 'GET',
    parametros,
    codigo_estado: res.status,
    content_type: contentType,
    bytes: Buffer.byteLength(cuerpoFormateado, 'utf8'),
    capturado_en,
    descripcion: receta.descripcion,
    notas: [...(receta.notas ?? []), ...(flags['notas'] !== undefined ? [flags['notas']] : [])],
  };
  writeFileSync(ficheroMeta, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  const rel = (p: string): string => p.slice(RAIZ.length + 1).replace(/\\/g, '/');
  console.log(`\nHTTP ${res.status} ${contentType ?? ''}`);
  console.log(`  ${rel(ficheroCuerpo)}  (${meta.bytes} bytes)`);
  console.log(`  ${rel(ficheroMeta)}`);
}

function intentarFormatearJson(texto: string): string {
  try {
    return `${JSON.stringify(JSON.parse(texto), null, 2)}\n`;
  } catch {
    return texto;
  }
}

void main();
