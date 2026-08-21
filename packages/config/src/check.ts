/**
 * CLI: pnpm config:check
 *
 * Valida los JSON de configuracion y lista lo que falta por rellenar y por
 * verificar. Es el panel de control de la deuda de configuracion del proyecto.
 */
import { auditarConfig, loadConfig } from './loader';

function agruparPorFichero(rutas: string[]): Map<string, string[]> {
  const grupos = new Map<string, string[]>();
  for (const ruta of rutas) {
    const fichero = ruta.split('.')[0] ?? '(raiz)';
    const lista = grupos.get(fichero) ?? [];
    lista.push(ruta);
    grupos.set(fichero, lista);
  }
  return new Map([...grupos].sort((a, b) => b[1].length - a[1].length));
}

function main(): number {
  const { raw, dir } = loadConfig();
  const { pendientes, sin_verificar, fuera_de_rango } = auditarConfig(raw);

  console.log(`Config cargada desde: ${dir}`);
  console.log('Todos los ficheros validan contra su esquema.\n');

  if (fuera_de_rango.length > 0) {
    console.log(`FUERA DE RANGO (${fuera_de_rango.length}) - revisar:`);
    for (const r of fuera_de_rango) console.log(`  ! ${r}`);
    console.log('');
  }

  console.log(`PENDIENTES DE FIJAR (${pendientes.length})`);
  console.log('El motor lanza MissingConfigError si necesita alguno de estos.\n');
  for (const [fichero, rutas] of agruparPorFichero(pendientes)) {
    console.log(`  ${fichero}.json  (${rutas.length})`);
    for (const r of rutas) console.log(`    - ${r}`);
    console.log('');
  }

  const bloques = [...new Set(sin_verificar)];
  console.log(`SIN VERIFICAR CONTRA FUENTE (${bloques.length} bloques)`);
  console.log('No impiden calcular, pero el resultado sale con aviso destacado.\n');
  for (const [fichero, rutas] of agruparPorFichero(bloques)) {
    console.log(`  ${fichero}.json  (${rutas.length})`);
  }
  console.log('');

  // Que quede todo pendiente no es un fallo de build: es el estado esperado
  // hasta que se contrasten los datos oficiales uno a uno.
  return fuera_de_rango.length > 0 ? 1 : 0;
}

process.exit(main());
