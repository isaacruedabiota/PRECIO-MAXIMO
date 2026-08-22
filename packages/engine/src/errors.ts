/**
 * Errores del motor.
 *
 * Todos llevan contexto estructurado. Un `throw new Error('falta dato')` no
 * permite al borde de la aplicacion decidir si el problema es del usuario, de
 * la configuracion o de la fuente de datos.
 */

/** Lo que aun no esta implementado. Nunca devolver un placeholder en su lugar. */
export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';

  constructor(que: string) {
    super(`${que} no esta implementado todavia.`);
  }
}

/** El input no describe un inmueble sobre el que se pueda calcular nada. */
export class InputInvalidoError extends Error {
  override readonly name = 'InputInvalidoError';

  constructor(
    readonly campo: string,
    readonly motivo: string,
  ) {
    super(`Input invalido en "${campo}": ${motivo}`);
  }
}

/**
 * Falta un dato de mercado imprescindible para el techo que se estaba
 * calculando. Distinto de MissingConfigError: aquello es config sin fijar,
 * esto es un dato que deberia haber traido el adaptador.
 */
export class DatoMercadoAusenteError extends Error {
  override readonly name = 'DatoMercadoAusenteError';

  constructor(
    readonly dato: string,
    readonly techo: string,
  ) {
    super(`Falta el dato de mercado "${dato}", necesario para ${techo}.`);
  }
}
