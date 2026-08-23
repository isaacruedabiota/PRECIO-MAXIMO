/**
 * CLI: pnpm valorar <expediente.json>
 *      pnpm valorar --plantilla <RC> > expediente.json
 *
 * Ata la cadena entera: ficha del Catastro, precio de la base, IPV, motor, y
 * el desglose trazable de los cuatro techos.
 *
 * Existe antes que la web a proposito. Los problemas de cableado (la CCAA que
 * no resuelve, el municipio que no cruza, el trimestre que falta) salen aqui,
 * donde el mensaje de error se lee entero, y no dentro de un formulario.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CatastroAdapter,
  ExpedienteIncompletoError,
  IneDbAdapter,
  MitmaDbAdapter,
  PrecioMercadoDbAdapter,
  SinDatoError,
  SinPrecioDeMercadoError,
  SourceUnavailableError,
  componerCalcInput,
  expedienteVacio,
} from '@vp/adapters';
import type { Expediente } from '@vp/adapters';
import { loadConfig } from '@vp/config';
import { MissingConfigError } from '@vp/config/values';
import { calcularPrecioMaximo } from '@vp/engine';
import type { AntiguedadParque, MaxPriceResult, TechoId, TrazedValue } from '@vp/engine';
import { crearDb } from '@vp/db';
import { nombreDeLaBase, requiereDatabaseUrl } from '@vp/db/env';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ANCHO = 78;

const eur = (n: number): string => `${Math.round(n).toLocaleString('es-ES')} EUR`;

function titulo(t: string): void {
  console.log(`\n${'='.repeat(ANCHO)}`);
  console.log(t);
  console.log('='.repeat(ANCHO));
}

function seccion(t: string): void {
  console.log(`\n${'-'.repeat(ANCHO)}`);
  console.log(t);
  console.log('-'.repeat(ANCHO));
}

/**
 * Antiguedad del parque, del fixture que deja pnpm ingest:antiguedad.
 *
 * Se lee aqui y no dentro del adaptador porque cada consumidor la tiene en un
 * sitio distinto: la CLI en un fichero, la web acabara leyendola de la base.
 */
function antiguedadDelFixture(municipioCatastro: string): AntiguedadParque | null {
  const ruta = resolve(RAIZ, 'fixtures', 'catastro', `${municipioCatastro}-antiguedad-parque.json`);
  if (!existsSync(ruta)) return null;
  const j = JSON.parse(readFileSync(ruta, 'utf8')) as {
    municipio: string;
    fuente: string;
    url_atom: string;
    fecha_dataset_gml: string;
    parque_de_mas_de_5_anios: { viviendas_computadas: number; edad_media_anios: number };
  };
  return {
    edad_media_anios: j.parque_de_mas_de_5_anios.edad_media_anios,
    ambito: 'municipio',
    fuente: `${j.fuente} (${j.municipio})`,
    fuente_url: j.url_atom,
    fecha_dato: j.fecha_dataset_gml,
    n_viviendas: j.parque_de_mas_de_5_anios.viviendas_computadas,
  };
}

function uso(): void {
  console.log(`
Uso:
  pnpm valorar --plantilla <RC> > expediente.json   crea un expediente vacio
  pnpm valorar expediente.json                      valora

El expediente es lo que el Catastro NO publica: ascensor, orientacion, estado,
certificado energetico, precio pedido y el perfil del comprador. Rellenalo y
vuelve a lanzarlo.
`);
}

function imprimirTrazado(t: TrazedValue, sangria = '  '): void {
  console.log(
    `${sangria}${String(Math.round(t.valor)).padStart(10)} ${t.unidad.padEnd(10)} ` +
      `${t.fuente} (${t.fecha_dato}, confianza ${t.confianza})`,
  );
  for (const n of t.notas ?? []) console.log(`${sangria}    - ${n}`);
}

function imprimirResultado(r: MaxPriceResult, detalle: boolean): void {
  if (r.bloqueantes.length > 0) {
    titulo('CALCULO BLOQUEADO');
    for (const b of r.bloqueantes) {
      console.log(`\n  [${b.codigo}] ${b.titulo}`);
      console.log(`  ${b.detalle}`);
      console.log(`  Como verificarlo: ${b.como_verificar}`);
    }
    console.log(
      '\nUn bloqueante no descuenta: para el calculo. Dar un precio aqui seria dar\n' +
        'un numero falso con apariencia de rigor.',
    );
    return;
  }

  seccion('LOS CUATRO TECHOS');
  const orden: TechoId[] = ['T1', 'T2', 'T3', 'T4'];
  for (const id of orden) {
    const techo = r.techos[id];
    const marca = r.techo_limitante === id ? ' <-- MANDA' : '';
    if (!techo.aplica) {
      console.log(`  ${id} ${techo.nombre.padEnd(28)} no aplica: ${techo.motivo_no_aplica ?? ''}`);
      continue;
    }
    const v = techo.valor;
    console.log(
      `  ${id} ${techo.nombre.padEnd(28)} ${(v === null ? '-' : eur(v.valor)).padStart(14)}${marca}`,
    );
    if (techo.rango !== null) {
      console.log(`     rango ${eur(techo.rango.min)} - ${eur(techo.rango.max)}`);
    }
    if (detalle) {
      for (const linea of techo.desglose) {
        const v = linea.valor;
        console.log(
          `       ${linea.concepto.padEnd(38)} ${String(
            v.unidad === 'coeficiente' ? v.valor.toFixed(4) : Math.round(v.valor),
          ).padStart(12)} ${v.unidad}`,
        );
        if (linea.formula !== undefined) console.log(`         = ${linea.formula}`);
      }
    }
    for (const a of techo.avisos) console.log(`     [${a.nivel}] ${a.titulo}`);
  }

  if (r.descuentos_riesgo.length > 0) {
    seccion('DESCUENTOS POR RIESGO');
    for (const d of r.descuentos_riesgo) {
      console.log(`  ${d.concepto.padEnd(40)} -${eur(d.importe.valor)}`);
      console.log(`     ${d.justificacion}`);
    }
  }

  seccion('RESULTADO');
  if (r.minimo_techos !== null) {
    console.log(`  Minimo de los techos      ${eur(r.minimo_techos.valor).padStart(14)}`);
  }
  const descuentos = r.descuentos_riesgo.reduce((s, d) => s + d.importe.valor, 0);
  if (descuentos > 0) console.log(`  Descuentos por riesgo     ${`-${eur(descuentos)}`.padStart(14)}`);
  if (r.precio_maximo !== null) {
    console.log(`  PRECIO MAXIMO             ${eur(r.precio_maximo.valor).padStart(14)}`);
    imprimirTrazado(r.precio_maximo, '     ');
  }
  if (r.precio_entrada_negociacion !== null) {
    console.log(
      `  Entrada en negociacion    ${`${eur(r.precio_entrada_negociacion.min)} - ${eur(r.precio_entrada_negociacion.max)}`.padStart(14)}`,
    );
  }
  if (r.comparativa_precio_pedido !== null) {
    const c = r.comparativa_precio_pedido;
    console.log(
      `\n  Precio pedido: ${eur(c.precio_pedido)} -> ${c.veredicto.replace(/_/g, ' ')} ` +
        `(${c.diferencia_pct > 0 ? '+' : ''}${(c.diferencia_pct * 100).toFixed(1)}%, ${eur(c.diferencia_eur)})`,
    );
  }

  if (r.metricas_inversion !== null) {
    seccion('METRICAS DE INVERSION');
    const m = r.metricas_inversion;
    for (const [k, v] of Object.entries(m)) {
      console.log(`  ${k.replace(/_/g, ' ').padEnd(24)} ${v.valor.toFixed(2)} ${v.unidad}`);
    }
  }

  seccion('ARGUMENTARIO PARA NEGOCIAR');
  for (const p of r.argumentario) {
    console.log(`\n  ${p.titular}${p.impacto_eur === null ? '' : `  (${eur(p.impacto_eur)})`}`);
    console.log(`  ${p.detalle}`);
    for (const t of p.respaldo) imprimirTrazado(t, '     ');
  }

  if (r.avisos.length > 0) {
    seccion('AVISOS DEL MOTOR');
    for (const a of r.avisos) {
      console.log(`  [${a.nivel}] ${a.codigo}: ${a.titulo}`);
      console.log(`     ${a.detalle}`);
      if (a.referencia_legal !== undefined) console.log(`     ${a.referencia_legal}`);
    }
  }

  seccion('PROCEDENCIA');
  console.log(`  Motor ${r.version_motor} | config ${r.version_config} | ${r.fecha_calculo}`);
  console.log(`  Confianza global: ${r.confianza_global}`);
  console.log(`\n  ${r.disclaimer}`);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  const plantilla = argv.indexOf('--plantilla');
  if (plantilla >= 0) {
    const rc = argv[plantilla + 1];
    if (rc === undefined) {
      console.error('Falta la referencia catastral: pnpm valorar --plantilla <RC>');
      process.exit(1);
      return;
    }
    console.log(JSON.stringify(expedienteVacio(rc.toUpperCase()), null, 2));
    return;
  }

  const ruta = argv.find((a) => !a.startsWith('--'));
  if (ruta === undefined) {
    uso();
    process.exit(1);
    return;
  }
  if (!existsSync(ruta)) {
    console.error(`No existe el expediente ${ruta}.`);
    uso();
    process.exit(1);
  }

  const expediente = JSON.parse(readFileSync(ruta, 'utf8')) as Expediente;
  const fechaCalculo =
    argv.find((a) => a.startsWith('--fecha='))?.slice('--fecha='.length) ??
    new Date().toISOString().slice(0, 10);

  const url = requiereDatabaseUrl();
  const { config, dir } = loadConfig();
  const db = crearDb(url);

  const mitma = new MitmaDbAdapter(db);
  const { input, ficha, avisos } = await componerCalcInput(expediente, config, {
    catastro: new CatastroAdapter(),
    precios: new PrecioMercadoDbAdapter(mitma),
    ipv: new IneDbAdapter(db, 'segunda_mano'),
    antiguedadParque: antiguedadDelFixture,
  }, fechaCalculo);

  titulo(`VALORACION - ${ficha.direccion.literal ?? ficha.referencia_catastral}`);
  console.log(`Referencia:  ${ficha.referencia_catastral}`);
  console.log(`Base:        ${nombreDeLaBase(url)}`);
  console.log(`Config:      ${dir}`);
  console.log(`Fecha:       ${fechaCalculo}`);
  console.log(
    `Superficie:  ${input.property.superficie.m2} m2 ${input.property.superficie.tipo}`,
  );
  console.log(
    `Mercado:     ${input.market.precio_m2.eur_m2} EUR/m2 (${input.market.precio_m2.ambito})`,
  );
  console.log(`             ${input.market.precio_m2.fuente}`);
  if (input.market.ipv !== null) {
    console.log(
      `IPV:         ${(input.market.ipv.variacion_acumulada * 100).toFixed(2)}% ` +
        `de ${input.market.ipv.desde} a ${input.market.ipv.hasta}`,
    );
  }
  if (input.market.antiguedad_parque !== null) {
    console.log(
      `Parque:      ${input.market.antiguedad_parque.edad_media_anios.toFixed(1)} anos de media`,
    );
  }

  if (avisos.length > 0) {
    seccion('AL MONTAR LA ENTRADA');
    for (const a of avisos) console.log(`  - ${a}`);
  }

  imprimirResultado(calcularPrecioMaximo(input), !argv.includes('--resumen'));
  process.exit(0);
}

main().catch((e: unknown) => {
  if (e instanceof ExpedienteIncompletoError) {
    console.error(`\n${e.message}`);
    process.exit(1);
  }
  if (e instanceof SinPrecioDeMercadoError) {
    console.error(`\n${e.message}`);
    console.error('Lanza antes: pnpm ingest:municipios && pnpm ingest:mitma');
    process.exit(3);
  }
  if (e instanceof MissingConfigError) {
    console.error(`\nFalta un valor de configuracion: ${e.message}`);
    console.error('Miralo con: pnpm config:check');
    process.exit(4);
  }
  if (e instanceof SinDatoError || e instanceof SourceUnavailableError) {
    console.error(`\n${e.message}`);
    process.exit(3);
  }
  console.error(e);
  process.exit(1);
});
