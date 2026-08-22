/**
 * Matematica financiera. Funciones puras, sin dependencias.
 */

/**
 * Cuota mensual del sistema frances.
 *
 *   cuota = C * i / (1 - (1+i)^-n)
 *
 * @param capital principal del prestamo
 * @param tipoMensual interes mensual en tanto por uno
 * @param meses numero de cuotas
 */
export function cuotaFrances(capital: number, tipoMensual: number, meses: number): number {
  if (meses <= 0) throw new Error('El plazo en meses debe ser positivo.');
  if (capital <= 0) return 0;
  // Prestamo a interes cero: reparto lineal. Sin este caso la formula divide por cero.
  if (tipoMensual === 0) return capital / meses;
  return (capital * tipoMensual) / (1 - (1 + tipoMensual) ** -meses);
}

/**
 * Capital maximo financiable dada una cuota. Es la inversa de cuotaFrances.
 *
 *   C = cuota * (1 - (1+i)^-n) / i
 */
export function capitalDesdeCuota(cuota: number, tipoMensual: number, meses: number): number {
  if (meses <= 0) throw new Error('El plazo en meses debe ser positivo.');
  if (cuota <= 0) return 0;
  if (tipoMensual === 0) return cuota * meses;
  return (cuota * (1 - (1 + tipoMensual) ** -meses)) / tipoMensual;
}

export interface OpcionesBiseccion {
  min: number;
  max: number;
  tolerancia: number;
  maxIteraciones: number;
}

/**
 * Busca el mayor P del intervalo que cumple `cabe(P)`.
 *
 * Requiere que `cabe` sea monotona: si cabe un precio, cabe cualquiera menor.
 * Es el caso de la restriccion de ahorro de T2, donde entrada + gastos crece
 * con el precio.
 *
 * Se resuelve numericamente y no despejando porque gastos(P) tiene escalones:
 * los aranceles de notaria y registro van por tramos, y la base imponible del
 * ITP es max(precio, valor de referencia catastral), que introduce un codo en
 * el punto donde el precio adelanta al valor de referencia.
 */
export function mayorQueCumple(
  cabe: (p: number) => boolean,
  { min, max, tolerancia, maxIteraciones }: OpcionesBiseccion,
): number {
  if (!cabe(min)) return 0; // ni el minimo cabe
  if (cabe(max)) return max; // el techo lo pone otra restriccion

  let bajo = min;
  let alto = max;

  for (let i = 0; i < maxIteraciones && alto - bajo > tolerancia; i += 1) {
    const medio = (bajo + alto) / 2;
    if (cabe(medio)) {
      bajo = medio;
    } else {
      alto = medio;
    }
  }

  return bajo;
}
