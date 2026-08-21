/**
 * Captura una respuesta real de una fuente y la guarda en fixtures/.
 *
 * FASE 2. Es la primera herramienta que hay que construir, antes que ningun
 * adaptador: la regla del proyecto es programar contra respuestas reales
 * capturadas, nunca contra un esquema supuesto.
 *
 * Uso previsto:
 *   pnpm capture:fixture catastro Consulta_DNPRC --rc=<referencia>
 *   -> fixtures/catastro/consulta-dnprc-<caso>.json
 *
 * Debe guardar tambien: URL exacta, metodo, cabeceras relevantes, codigo de
 * estado y momento de la captura. Un fixture sin esos metadatos no sirve para
 * detectar que la fuente ha cambiado.
 */
console.error('capture:fixture no esta implementado (Fase 2).');
process.exit(1);
