/**
 * CLI: pnpm config:seed [--dry-run]
 *
 * Copia `sugerido` -> `valor` en los valores configurables que sigan a null,
 * para poder ejecutar el motor de punta a punta sin haber verificado todavia
 * cada cifra contra su fuente.
 *
 * Tres limites deliberados:
 *
 *   1. NO toca `verificado`. Sigue en false, y el resultado del motor lleva
 *      aviso destacado mientras quede un solo bloque sin contrastar.
 *   2. NO inventa lo que no tiene `sugerido`. Los tipos de ITP, los tipos de
 *      IVA, los tramos de arancel y las partidas singulares de reforma se
 *      quedan a null, porque el brief nunca dio un valor para ellos. Sembrarlos
 *      con un numero plausible seria exactamente el fallo que este proyecto
 *      intenta evitar: un ITP mal puesto son 8.000 EUR de error en un piso de
 *      200.000.
 *   3. NO sobrescribe un `valor` ya fijado. Es idempotente y no pisa tu trabajo.
 *
 * Para deshacerlo: git checkout packages/config/data
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { configDir } from './loader';
import { CONFIG_FILES } from './schemas';

interface Sembrado {
  ruta: string;
  valor: number;
}

interface SinSembrar {
  ruta: string;
  motivo: 'sin_sugerido' | 'no_es_valor_configurable';
}

function sembrar(
  nodo: unknown,
  ruta: string,
  sembrados: Sembrado[],
  pendientes: SinSembrar[],
): void {
  if (Array.isArray(nodo)) {
    nodo.forEach((hijo, i) => sembrar(hijo, `${ruta}[${i}]`, sembrados, pendientes));
    return;
  }
  if (nodo === null || typeof nodo !== 'object') return;

  const obj = nodo as Record<string, unknown>;

  if ('valor' in obj) {
    if (obj['valor'] !== null) return; // ya fijado: no se pisa

    const sugerido = obj['sugerido'];
    if (typeof sugerido === 'number') {
      obj['valor'] = sugerido;
      sembrados.push({ ruta: `${ruta}.valor`, valor: sugerido });
    } else {
      pendientes.push({ ruta: `${ruta}.valor`, motivo: 'sin_sugerido' });
    }
    return;
  }

  for (const [clave, valor] of Object.entries(obj)) {
    if (clave.startsWith('_')) continue;
    const sub = ruta ? `${ruta}.${clave}` : clave;

    if (clave === 'verificado') continue; // nunca se toca

    if (valor === null) {
      pendientes.push({ ruta: sub, motivo: 'no_es_valor_configurable' });
      continue;
    }
    sembrar(valor, sub, sembrados, pendientes);
  }
}

function main(): number {
  const dryRun = process.argv.includes('--dry-run');
  const dir = configDir();

  const sembrados: Sembrado[] = [];
  const pendientes: SinSembrar[] = [];

  for (const [clave, { archivo }] of Object.entries(CONFIG_FILES)) {
    if (clave === 'fuentes') continue; // catalogo de endpoints, no de numeros

    const ruta = join(dir, archivo);
    const json: unknown = JSON.parse(readFileSync(ruta, 'utf8'));

    const antes = sembrados.length;
    sembrar(json, clave, sembrados, pendientes);

    if (!dryRun && sembrados.length > antes) {
      writeFileSync(ruta, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
    }
  }

  console.log(dryRun ? 'SIMULACION (--dry-run): no se ha escrito nada.\n' : '');
  console.log(`SEMBRADOS ${sembrados.length} valores desde su 'sugerido':`);
  for (const s of sembrados) console.log(`  + ${s.ruta} = ${s.valor}`);

  const sinSugerido = pendientes.filter((p) => p.motivo === 'sin_sugerido');
  const escalares = pendientes.filter((p) => p.motivo === 'no_es_valor_configurable');

  console.log(`\nSIGUEN A NULL (${pendientes.length}). Hay que rellenarlos a mano:`);
  if (escalares.length > 0) {
    console.log(`\n  Tipos impositivos, tramos de arancel y demas datos oficiales (${escalares.length}):`);
    console.log('  El brief nunca dio un valor para estos. Van contra BOE / boletin autonomico.');
    for (const p of escalares) console.log(`    - ${p.ruta}`);
  }
  if (sinSugerido.length > 0) {
    console.log(`\n  Estimaciones sin semilla en el brief (${sinSugerido.length}):`);
    for (const p of sinSugerido) console.log(`    - ${p.ruta}`);
  }

  console.log(
    '\nverificado sigue en false en todos los bloques: ningun numero esta contrastado.\n' +
      'Para deshacer: git checkout packages/config/data',
  );

  return 0;
}

process.exit(main());
