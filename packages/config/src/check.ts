/**
 * CLI: pnpm config:check
 *
 * Valida los JSON de configuracion y lista lo que falta por rellenar y por
 * verificar. Es el panel de control de la deuda de configuracion del proyecto.
 */
import { auditarConfig, loadConfig } from './loader.js';

function main(): number {
  const { raw, dir } = loadConfig();
  const { pendientes, sin_verificar, fuera_de_rango } = auditarConfig(raw);

  console.log(`Config cargada desde: ${dir}`);
  console.log(`Todos los ficheros validan contra su esquema.\n`);

  if (fuera_de_rango.length > 0) {
    console.log(`FUERA DE RANGO (${fuera_de_rango.length}) - revisar:`);
    for (const r of fuera_de_rango) console.log(`  ! ${r}`);
    console.log('');
  }

  console.log(`PENDIENTES DE FIJAR (${pendientes.length})`);
  console.log('El motor lanza MissingConfigError si necesita alguno de estos:');
  for (const p of pendientes) console.log(`  - ${p}`);
  console.log('');

  const bloques = [...new Set(sin_verificar)];
  console.log(`SIN VERIFICAR CONTRA FUENTE (${bloques.length} bloques)`);
  console.log('No impiden calcular, pero generan aviso en el resultado:');
  for (const b of bloques) console.log(`  ? ${b}`);
  console.log('');

  // Fase 0: se espera que este todo pendiente. No es un fallo de build.
  return fuera_de_rango.length > 0 ? 1 : 0;
}

process.exit(main());
