/**
 * CLI: pnpm ficha <referencia catastral>
 *      pnpm ficha --lat=39.9837 --lon=-0.0493
 *
 * Criterio de aceptacion de la Fase 2: una referencia catastral por CLI y sale
 * la ficha del inmueble.
 *
 * Hace tres cosas ademas de imprimir la ficha:
 *
 *   1. Separa la superficie de la VIVIENDA de la de anejos y comunes (ADR-022),
 *      que es la unica que debe llegar a T1.
 *   2. Dice que campos de PropertyInput quedan por rellenar a mano, porque el
 *      Catastro no los publica. Sin ellos el motor no puede calcular T1.
 *   3. Da los pasos para consultar el valor de referencia, que exige certificado
 *      o Cl@ve y por tanto no se puede automatizar.
 */

import { loadConfig } from '@vp/config';
import {
  CatastroAdapter,
  ConsultaInvalidaError,
  SinDatoError,
  SourceUnavailableError,
  ValorReferenciaManualAdapter,
  fichaAPropertyInput,
} from '@vp/adapters';
import type { FichaCatastral, ListadoParcela } from '@vp/adapters';

const ANCHO = 78;

function titulo(texto: string): void {
  console.log(`\n${'='.repeat(ANCHO)}`);
  console.log(texto);
  console.log('='.repeat(ANCHO));
}

function seccion(texto: string): void {
  console.log(`\n${'-'.repeat(ANCHO)}`);
  console.log(texto);
  console.log('-'.repeat(ANCHO));
}

function fila(etiqueta: string, valor: string | number | null | undefined): void {
  const v = valor === null || valor === undefined || valor === '' ? '(no consta)' : String(valor);
  console.log(`  ${etiqueta.padEnd(26)} ${v}`);
}

function m2(v: number | null): string {
  return v === null ? '(no consta)' : `${v} m2`;
}

function uso(): void {
  console.log(`
Uso:
  pnpm ficha <referencia catastral>       20 caracteres (inmueble) o 14 (parcela)
  pnpm ficha --lat=<lat> --lon=<lon>      busca la parcela en unas coordenadas

Ejemplos:
  pnpm ficha 2004930YK5320S0009RH
  pnpm ficha 2004930YK5320S
  pnpm ficha --lat=39.98374 --lon=-0.04927
`);
}

// ---------------------------------------------------------------------------

function imprimirParcela(p: ListadoParcela): void {
  titulo(`PARCELA ${p.referencia_parcela} - ${p.total} inmuebles`);
  console.log(
    '\nEsta referencia es de parcela, no de inmueble. Estos son los inmuebles que\n' +
      'contiene; vuelve a lanzar el comando con la referencia de 20 caracteres del\n' +
      'que te interese.\n',
  );

  const residenciales = p.inmuebles.filter((i) => (i.uso_principal ?? '').toLowerCase().includes('residencial'));
  const resto = p.inmuebles.filter((i) => !residenciales.includes(i));

  const linea = (i: (typeof p.inmuebles)[number]): void => {
    const sitio = [
      i.escalera === null ? null : `Es ${i.escalera}`,
      i.planta === null ? null : `Pl ${i.planta}`,
      i.puerta === null ? null : `Pt ${i.puerta}`,
    ]
      .filter((x) => x !== null)
      .join(' ');
    console.log(
      `  ${i.referencia_catastral}  ${sitio.padEnd(18)} ` +
        `${String(i.superficie_total_m2 ?? '?').padStart(5)} m2  ` +
        `${(i.uso_principal ?? '?').padEnd(24)} ` +
        `${i.participacion === null ? '' : `${(i.participacion * 100).toFixed(2)}%`}`,
    );
  };

  if (residenciales.length > 0) {
    console.log(`Residencial (${residenciales.length}):`);
    residenciales.forEach(linea);
  }
  if (resto.length > 0) {
    console.log(`\nOtros usos (${resto.length}):`);
    resto.forEach(linea);
  }

  console.log(
    '\nOjo: los m2 de esta lista son el TOTAL que el Catastro imputa a cada\n' +
      'inmueble, con anejos y elementos comunes incluidos. La superficie de la\n' +
      'vivienda sale al consultar su referencia de 20 caracteres.',
  );
}

function imprimirFicha(f: FichaCatastral, coordenadas: string | null): void {
  titulo(`INMUEBLE ${f.referencia_catastral}`);

  seccion('IDENTIFICACION');
  fila('Direccion', f.direccion.literal);
  fila('Codigo postal', f.direccion.codigo_postal);
  fila('Municipio', `${f.direccion.municipio ?? '?'} (INE ${f.direccion.municipio_ine ?? '?'})`);
  fila('Provincia', `${f.direccion.provincia ?? '?'} (INE ${f.direccion.codigo_provincia_ine ?? '?'})`);
  fila('Clase', f.clase);
  fila('Uso principal', f.uso_principal);
  fila('Ano de construccion', f.anio_construccion);
  fila('Participacion', f.participacion === null ? null : `${(f.participacion * 100).toFixed(4)} %`);
  if (coordenadas !== null) fila('Coordenadas', coordenadas);

  seccion('SUPERFICIES  (todas CONSTRUIDAS: la util no es dato catastral)');
  const s = f.superficies;
  fila('Vivienda', m2(s.vivienda_m2));
  fila('  + elementos comunes', m2(s.comunes_m2));
  fila('  = con comunes', m2(s.vivienda_con_comunes_m2));
  for (const a of s.anejos) {
    fila(`  Anejo ${a.tipo.toLowerCase()}`, `${a.superficie_m2} m2 (planta ${a.planta ?? '?'})`);
  }
  fila('Total imputado (sfc)', m2(s.total_m2));
  if (s.vivienda_m2 !== null && s.total_m2 !== null && s.total_m2 !== s.vivienda_m2) {
    const dif = ((s.total_m2 / s.vivienda_m2 - 1) * 100).toFixed(0);
    console.log(
      `\n  Usar el total (${s.total_m2} m2) como superficie del piso inflaria T1 un ${dif}%.\n` +
        `  A T1 va la de la vivienda: ${s.vivienda_m2} m2.`,
    );
  }
  if (!s.desglose_cuadra && s.anejos.length > 0) {
    console.log('\n  AVISO: el desglose no cuadra con el total. Comprueba la ficha en la sede.');
  }

  seccion('FINCA');
  fila('Tipo', f.finca.tipo);
  fila(
    'Division horizontal',
    f.finca.division_horizontal === null ? '(no se puede decidir)' : f.finca.division_horizontal ? 'si' : 'NO',
  );
  fila('Superficie de suelo', m2(f.finca.superficie_suelo_m2));
  fila('Cartografia', f.finca.url_cartografia);

  if (f.finca.division_horizontal === false) {
    console.log(
      '\n  BLOQUEANTE: sin division horizontal no hay finca registral independiente.\n' +
        '  El motor no dara precio hasta aclararlo con la nota simple del Registro.',
    );
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = new Map<string, string>();
  const posicionales: string[] = [];
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, ...r] = a.slice(2).split('=');
      flags.set(k ?? '', r.join('=') || 'true');
    } else {
      posicionales.push(a);
    }
  }

  const lat = flags.get('lat');
  const lon = flags.get('lon');
  const catastro = new CatastroAdapter();

  let referencia = posicionales[0];

  if (referencia === undefined && lat !== undefined && lon !== undefined) {
    const c = await catastro.porCoordenadas(Number(lat), Number(lon));
    console.log(
      `\nEn ${lat}, ${lon} esta la parcela ${c.datos.referencia_parcela}` +
        `${c.datos.direccion_literal === null ? '' : ` (${c.datos.direccion_literal})`}.`,
    );
    referencia = c.datos.referencia_parcela;
  }

  if (referencia === undefined) {
    uso();
    process.exit(1);
    return;
  }

  const respuesta = await catastro.consultar(referencia);

  if (respuesta.datos.tipo === 'parcela') {
    imprimirParcela(respuesta.datos.parcela);
    console.log(`\nFuente: ${respuesta.procedencia.fuente}`);
    console.log(`Consultado: ${respuesta.procedencia.obtenido_en}`);
    return;
  }

  const ficha = respuesta.datos.ficha;

  // Las coordenadas son de la parcela, asi que se piden aparte y sin romper la
  // ficha si el servicio de localizacion no responde.
  let coordenadas: string | null;
  try {
    const c = await catastro.coordenadasDe(ficha.referencia_parcela);
    coordenadas = `${c.datos.lat.toFixed(6)}, ${c.datos.lon.toFixed(6)} (${c.datos.srs})`;
  } catch (e) {
    coordenadas = `(no disponibles: ${(e as Error).message})`;
  }

  imprimirFicha(ficha, coordenadas);

  // --- Puente al motor ----------------------------------------------------
  const { config } = loadConfig();
  const puente = fichaAPropertyInput(ficha, config);

  seccion('LO QUE FALTA PARA CALCULAR');
  console.log(
    '  El Catastro describe el inmueble, pero no dice nada de lo que mas mueve\n' +
      '  T1. Estos campos los tienes que aportar tu:\n',
  );
  for (const c of puente.faltan) console.log(`    - ${c}`);

  if (puente.avisos.length > 0) {
    seccion('AVISOS');
    for (const a of puente.avisos) console.log(`  - ${a}`);
  }

  // --- Valor de referencia ------------------------------------------------
  const vr = new ValorReferenciaManualAdapter();
  seccion('VALOR DE REFERENCIA  (base imponible del ITP, Ley 11/2021)');
  console.log('  No es automatizable: la sede exige certificado, DNIe o Cl@ve.\n');
  for (const paso of vr.instrucciones(ficha.referencia_catastral).pasos) {
    console.log(`    - ${paso}`);
  }

  console.log(`\nFuente: ${respuesta.procedencia.fuente}`);
  console.log(`URL:    ${respuesta.procedencia.url ?? '?'}`);
  console.log(`Consultado: ${respuesta.procedencia.obtenido_en}`);
}

main().catch((e: unknown) => {
  if (e instanceof ConsultaInvalidaError) {
    console.error(`\nLa consulta no es valida: ${e.detalle}`);
    uso();
    process.exit(1);
  }
  if (e instanceof SinDatoError) {
    console.error(`\nEl Catastro no tiene dato: ${e.consulta}`);
    process.exit(3);
  }
  if (e instanceof SourceUnavailableError) {
    console.error(`\n${e.message}`);
    console.error('Se para y se avisa: no se inventa una ficha.');
    process.exit(2);
  }
  console.error(e);
  process.exit(1);
});
