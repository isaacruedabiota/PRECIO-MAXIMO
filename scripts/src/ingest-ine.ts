/**
 * Ingesta del IPV (Indice de Precios de Vivienda) del INE por CCAA.
 *
 * FASE 3.
 *
 * Pasos:
 *   1. Localizar los IDs de tabla del IPV por CCAA (general / nueva / segunda mano).
 *      NO se inventan: se comprueban llamando a la API y viendo que devuelve.
 *   2. Anotarlos en packages/config/data/fuentes.json -> ine.tablas.
 *   3. Guardar una respuesta real en fixtures/ine/ y programar contra ella.
 *   4. Crear fila en fuentes_datos e insertar en ine_ipv apuntando a ella.
 *
 * API: https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/{idTabla}?nult={n}
 */
console.error(
  'ingest:ine no esta implementado (Fase 3).\n' +
    'Primero hay que localizar los IDs de tabla del IPV llamando a la API real.',
);
process.exit(1);
