/**
 * Ingesta de la serie 35103500 de MITMA (valor tasado de vivienda libre).
 *
 * FASE 3. Ahora mismo solo deja constancia de lo que hay que hacer, en el orden
 * correcto, y falla en vez de fingir que ha importado algo.
 *
 * Pasos:
 *   1. Localizar la URL real del XLS trimestral y anotarla en fuentes.json.
 *   2. Descargar y guardar el fichero crudo con su checksum.
 *   3. Crear la fila de fuentes_datos ANTES de insertar ningun precio.
 *   4. Parsear municipio (>25.000 hab) y provincia por separado.
 *   5. Insertar en mitma_precios apuntando a esa fila.
 */
console.error(
  'ingest:mitma no esta implementado (Fase 3).\n' +
    'Antes de programarlo: descargar el XLS real, guardarlo en fixtures/mitma/ y ' +
    'programar contra ese fichero, no contra una suposicion de su formato.',
);
process.exit(1);
