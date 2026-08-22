/**
 * CLI: pnpm calibrate [municipio]
 *
 * Informe de calibracion de T1 y T3 sobre datos reales de MITMA.
 *
 * Tres cosas:
 *   1. Desglose de T1 paso a paso con el EUR/m2 real de la zona.
 *   2. Sensibilidad: que coeficiente mueve mas el resultado, para saber cual
 *      merece la pena verificar primero.
 *   3. Coherencia entre el coeficiente de estado de T1 y el coste de obra de T3,
 *      con el EUR/m2 a partir del cual reformar empieza a compensar.
 *
 * Usa la config real de packages/config/data, no una de test. Si algo sigue a
 * null, el informe lo dice en lugar de rellenarlo.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '@vp/config';
import { MissingConfigError } from '@vp/config/values';
import {
  analizarSensibilidad,
  calcularT1,
  comprobarCoherenciaEstadoReforma,
  resolverSuperficie,
} from '@vp/engine';
import type { CalcInput, MarketData, PropertyInput } from '@vp/engine';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface FilaMitma {
  provincia: string;
  municipio: string;
  eur_m2_mas_de_5_anios: number | null;
  tasaciones_mas_de_5_anios: number | null;
}

function cargarMitma(municipio: string): { fila: FilaMitma; periodo: string } {
  const ruta = resolve(RAIZ, 'fixtures', 'mitma', '35103500-municipios-ultimo-trimestre.json');
  const json = JSON.parse(readFileSync(ruta, 'utf8')) as {
    periodo: string;
    datos: FilaMitma[];
  };

  const fila = json.datos.find((d) => d.municipio.toLowerCase().includes(municipio.toLowerCase()));
  if (fila === undefined) {
    throw new Error(`No hay dato de MITMA para "${municipio}" en ${json.periodo}.`);
  }
  return { fila, periodo: json.periodo };
}

interface AntiguedadFixture {
  municipio: string;
  fuente: string;
  url_atom: string;
  fecha_dataset_gml: string;
  parque_de_mas_de_5_anios: {
    viviendas_computadas: number;
    edad_media_anios: number;
  };
}

/**
 * Antiguedad del parque de la zona, calculada del Catastro. Es el parametro que
 * mas mueve T1, asi que si esta se usa y si no se dice.
 */
function cargarAntiguedad(codigoCatastro: string): AntiguedadFixture | null {
  const ruta = resolve(RAIZ, 'fixtures', 'catastro', `${codigoCatastro}-antiguedad-parque.json`);
  if (!existsSync(ruta)) return null;
  return JSON.parse(readFileSync(ruta, 'utf8')) as AntiguedadFixture;
}

/** Fin del trimestre en formato ISO, a partir de la etiqueta T1A2026. */
function fechaDelPeriodo(periodo: string): string {
  const m = /^T(\d)A(\d{4})$/.exec(periodo.trim());
  if (m === null) throw new Error(`Periodo no reconocido: ${periodo}`);
  const finales = ['03-31', '06-30', '09-30', '12-31'];
  return `${m[2]}-${finales[Number(m[1]) - 1]}`;
}

const eur = (n: number | null | undefined): string =>
  n === null || n === undefined ? '-' : `${Math.round(n).toLocaleString('es-ES')} EUR`;

function argNumero(nombre: string): number | null {
  const arg = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  if (arg === undefined) return null;
  const n = Number(arg.split('=')[1]);
  return Number.isFinite(n) ? n : null;
}

function main(): void {
  const posicionales = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const municipio = posicionales[0] ?? 'Castellón de la Plana';
  const fechaCalculo = posicionales[1] ?? new Date().toISOString().slice(0, 10);

  const { config, dir } = loadConfig();

  // Overrides para poder contrastar escenarios de calibracion sin editar los
  // JSON: pnpm calibrate -- --edad-ref=40 --coef-min=0.5
  const edadRef = argNumero('edad-ref');
  const coefMin = argNumero('coef-min');
  if (edadRef !== null) config.coeficientes.antiguedad.edad_referencia_zona_anios.valor = edadRef;
  if (coefMin !== null) config.coeficientes.limites.coeficiente_global_min.valor = coefMin;
  const { fila, periodo } = cargarMitma(municipio);
  const antiguedad = cargarAntiguedad('12900');
  const fechaDato = fechaDelPeriodo(periodo);

  if (fila.eur_m2_mas_de_5_anios === null) {
    throw new Error(`MITMA marca el dato de ${fila.municipio} como no representativo.`);
  }

  console.log('='.repeat(78));
  console.log(`CALIBRACION DE T1 y T3 - ${fila.municipio} (${fila.provincia})`);
  console.log('='.repeat(78));
  console.log(`Config:     ${dir}`);
  console.log(`Dato base:  ${fila.eur_m2_mas_de_5_anios} EUR/m2, vivienda de mas de 5 anos`);
  console.log(`Fuente:     MITMA serie 35103500, ${periodo} (${fechaDato})`);
  console.log(`Muestra:    ${fila.tasaciones_mas_de_5_anios ?? '?'} tasaciones`);
  console.log(`Fecha calc: ${fechaCalculo}`);
  console.log(
    antiguedad === null
      ? 'Parque:     sin dato de antiguedad; se usa el respaldo de config'
      : `Parque:     ${antiguedad.parque_de_mas_de_5_anios.edad_media_anios} anos de media sobre ` +
        `${antiguedad.parque_de_mas_de_5_anios.viviendas_computadas.toLocaleString('es-ES')} viviendas (Catastro)`,
  );
  if (edadRef !== null || coefMin !== null) {
    console.log(
      `Overrides:  edad_referencia_zona=${edadRef ?? 'config'} coeficiente_global_min=${coefMin ?? 'config'}`,
    );
  }

  // ---------------------------------------------------------------------
  // Caso de referencia: el piso del Grao del criterio de aceptacion
  // ---------------------------------------------------------------------
  const property: PropertyInput = {
    referencia_catastral: null,
    localizacion: {
      codigo_postal: '12100',
      municipio_ine: '12040',
      municipio_nombre: fila.municipio,
      provincia: fila.provincia,
      ccaa: 'Comunitat Valenciana',
    },
    superficie: { tipo: 'construida', m2: 85 },
    superficie_construida_con_comunes_m2: null,
    planta: { numero: 3, es_atico: false, es_bajo: false },
    ascensor: false,
    situacion: 'exterior',
    orientacion: 'desconocida',
    anio_construccion: 1978,
    anio_rehabilitacion: null,
    estado_conservacion: 'a_reformar',
    certificado_energetico: { estado: 'registrado', letra_consumo: 'G' },
    anexos: { plazas_garaje: 0, trasteros: 0, terraza_m2: 0 },
    habitaciones: 3,
    banos: 1,
    precio_pedido: 135000,
    dias_publicado: 120,
    valor_referencia_catastral: null,
    valor_catastral: null,
    es_obra_nueva: false,
    tiene_division_horizontal: true,
    es_vpo: false,
  };

  const market: MarketData = {
    precio_m2: {
      eur_m2: fila.eur_m2_mas_de_5_anios,
      ambito: 'municipio',
      fuente: `MITMA 35103500 ${periodo}`,
      fuente_url: 'https://apps.fomento.gob.es/boletinonline2/sedal/35103500.XLS',
      fecha_dato: fechaDato,
      n_transacciones: fila.tasaciones_mas_de_5_anios,
      p25: null,
      p75: null,
      // VERIFICADO en el documento de metodologia de MITMA: su EUR/m2 es el
      // cociente entre el valor de tasacion y la superficie construida.
      base_superficie: 'construida',
    },
    ipv: null,
    anexos: null,
    superficie_p90_zona_m2: null,
    antiguedad_parque:
      antiguedad === null
        ? null
        : {
            edad_media_anios: antiguedad.parque_de_mas_de_5_anios.edad_media_anios,
            ambito: 'municipio',
            fuente: antiguedad.fuente,
            fuente_url: antiguedad.url_atom,
            fecha_dato: antiguedad.fecha_dataset_gml,
            n_viviendas: antiguedad.parque_de_mas_de_5_anios.viviendas_computadas,
          },
    alquiler: null,
    arv_eur_m2: null,
  };

  const { resuelta: superficie } = resolverSuperficie(property.superficie, config.coeficientes, fechaCalculo);
  const t1 = calcularT1({ fecha_calculo: fechaCalculo, property, market, config, superficie });

  console.log(`\n${'-'.repeat(78)}`);
  console.log('1. DESGLOSE DE T1');
  console.log('-'.repeat(78));
  console.log(`Superficie:  ${superficie.m2_utiles.valor} m2 utiles (${superficie.origen})`);
  for (const linea of t1.techo.desglose) {
    const v = linea.valor;
    console.log(`  ${linea.concepto.padEnd(34)} ${String(v.valor).padStart(12)} ${v.unidad}`);
  }
  console.log(`\n  T1 = ${eur(t1.techo.valor?.valor)}   (confianza ${t1.confianza})`);
  console.log(`  Precio pedido del caso: ${eur(property.precio_pedido)}`);
  console.log(`  Producto de coeficientes: ${t1.coeficientes.reduce((p, c) => p * c.valor, 1).toFixed(4)}`);

  // ---------------------------------------------------------------------
  console.log(`\n${'-'.repeat(78)}`);
  console.log('2. SENSIBILIDAD SOBRE T1  (donde gastar el esfuerzo de verificacion)');
  console.log('-'.repeat(78));

  const entrada = { fecha_calculo: fechaCalculo, property, market, config } as unknown as CalcInput;
  const sensibilidad = analizarSensibilidad(
    entrada,
    (i) => {
      const { resuelta } = resolverSuperficie(i.property.superficie, i.config.coeficientes, i.fecha_calculo);
      const r = calcularT1({
        fecha_calculo: i.fecha_calculo,
        property: i.property,
        market: i.market,
        config: i.config,
        superficie: resuelta,
      });
      return { precio_maximo: { valor: r.valorTotal } };
    },
    ['coeficientes'],
  );

  console.log(`T1 base: ${eur(sensibilidad.precio_base)}\n`);
  const relevantes = sensibilidad.impactos.filter((i) => i.recorrido_eur > 0);
  for (const i of relevantes.slice(0, 12)) {
    console.log(
      `  ${i.ruta.padEnd(52)} ${eur(i.recorrido_eur).padStart(12)}  ` +
        `${(i.recorrido_pct * 100).toFixed(1).padStart(5)}%  [${i.min} .. ${i.max}]`,
    );
  }
  const irrelevantes = sensibilidad.impactos.length - relevantes.length;
  console.log(`\n  ${irrelevantes} valores no mueven este caso: se pueden verificar mas tarde.`);

  // ---------------------------------------------------------------------
  console.log(`\n${'-'.repeat(78)}`);
  console.log('3. COHERENCIA ENTRE EL ESTADO DE T1 Y EL COSTE DE OBRA DE T3');
  console.log('-'.repeat(78));

  // Mientras los tipos de IVA sigan sin verificar, se calcula a IVA cero. Es
  // una cota inferior del coste: si a IVA cero la obra ya no compensa, con IVA
  // tampoco, y eso se puede afirmar sin inventar ningun tipo.
  const ivaConfigurado = config.reforma.iva.tipo_reducido_rehabilitacion;
  const usaCotaInferior = ivaConfigurado === null;

  try {
    const coherencia = comprobarCoherenciaEstadoReforma({
      config,
      m2_utiles: superficie.m2_utiles.valor,
      eur_m2_homogeneizado: t1.eurM2Homogeneizado,
      edificio_antiguo_o_sin_proyecto: true,
      iva_reducido: true,
      ...(usaCotaInferior ? { iva_override: 0 } : {}),
    });

    if (usaCotaInferior) {
      console.log(
        '  Los tipos de IVA siguen a null, asi que se calcula a IVA CERO: es una cota\n' +
          '  INFERIOR del coste de obra. Con IVA real, todo lo de abajo empeora.\n',
      );
    }

    console.log(
      `  a reformar ${coherencia.coef_a_reformar} -> reformado reciente ${coherencia.coef_reformado_reciente}` +
        `, margen ${(coherencia.margen_seguridad * 100).toFixed(0)}%, ` +
        `imprevistos ${(coherencia.imprevistos * 100).toFixed(0)}%, IVA ${(coherencia.iva * 100).toFixed(0)}%`,
    );
    console.log(`  Coeficiente neto de reformar: ${coherencia.niveles[0]?.coeficiente_neto}\n`);
    console.log(`  ${'nivel'.padEnd(20)} ${'coste'.padStart(12)} ${'equilibrio'.padStart(14)}  compensa`);
    for (const n of coherencia.niveles) {
      console.log(
        `  ${n.nivel.padEnd(20)} ${eur(n.coste_total_eur).padStart(12)} ` +
          `${(n.eur_m2_equilibrio === null ? '-' : `${n.eur_m2_equilibrio} EUR/m2`).padStart(14)}  ` +
          `${n.compensa === null ? '?' : n.compensa ? 'si' : 'NO'}`,
      );
    }
    console.log(`\n  EUR/m2 homogeneizado actual: ${t1.eurM2Homogeneizado.toFixed(0)}`);
    console.log(`\n  ${coherencia.diagnostico}`);
  } catch (error) {
    if (error instanceof MissingConfigError) {
      console.log(`  NO SE PUEDE COMPROBAR: falta "${error.ruta}".`);
      console.log(`  ${error.detalle}`);
    } else {
      throw error;
    }
  }

  // ---------------------------------------------------------------------
  console.log(`\n${'-'.repeat(78)}`);
  console.log('AVISOS DEL CASO');
  console.log('-'.repeat(78));
  for (const a of t1.techo.avisos) {
    console.log(`  [${a.nivel.toUpperCase().padEnd(8)}] ${a.codigo}: ${a.titulo}`);
  }
  console.log('');
}

main();
