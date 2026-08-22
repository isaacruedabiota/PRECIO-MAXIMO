import type { ArancelEscalado } from '@vp/config/schemas';
import { MissingConfigError, requerido } from '@vp/config/values';

/**
 * Arancel escalado por tramos (notaria y registro).
 *
 * Cada tramo aplica su tipo sobre la PARTE de la base que cae dentro de el, mas
 * una cuota fija de partida. No es un porcentaje plano sobre el total: por eso
 * el coste de compra no es proporcional al precio y T2 hay que resolverlo
 * numericamente en lugar de despejando.
 */
export function arancelEscalado(base: number, arancel: ArancelEscalado, ruta: string): number {
  if (arancel.tramos.length === 0) {
    throw new MissingConfigError(
      `${ruta}.tramos`,
      'No hay tramos de arancel cargados. Sin ellos no se puede estimar el coste de la escritura. ' +
        'config:seed no los siembra: son datos oficiales, no estimaciones.',
    );
  }

  const cuotaFija = requerido(
    arancel.cuota_fija_base,
    `${ruta}.cuota_fija_base`,
    'Cuota fija de partida del arancel.',
  );

  let honorarios = cuotaFija;

  for (const tramo of arancel.tramos) {
    if (base <= tramo.desde) continue;
    const techo = tramo.hasta ?? Number.POSITIVE_INFINITY;
    honorarios += (Math.min(base, techo) - tramo.desde) * tramo.tipo;
  }

  // Topes globales antes de rebaja e IVA. El arancel registral los tiene:
  // "el arancel global no podra superar los 2.181,673939 euros ni ser inferior
  // a 24,040484 euros".
  if (arancel.minimo_eur !== null) honorarios = Math.max(honorarios, arancel.minimo_eur);
  if (arancel.maximo_eur !== null) honorarios = Math.min(honorarios, arancel.maximo_eur);

  // Rebaja legal sobre los derechos resultantes de la escala.
  const rebaja = requerido(
    arancel.rebaja,
    `${ruta}.rebaja`,
    'Rebaja legal sobre los derechos del arancel. Poner 0 si no hay ninguna, pero comprobarlo: tanto el ' +
      'arancel notarial como el registral llevan una del 5 %.',
  );
  honorarios *= 1 - rebaja;

  const iva = requerido(
    arancel.iva_aplicable,
    `${ruta}.iva_aplicable`,
    'Tipo de IVA sobre los honorarios.',
  );

  return honorarios * (1 + iva);
}
