import { describe, expect, it } from 'vitest';

import { NotImplementedError, VERSION_MOTOR, calcularPrecioMaximo } from '../src/index.js';

/**
 * Fase 0: el motor solo tiene contrato. Estos tests fijan la unica garantia
 * que se puede dar ahora mismo, que es la que mas importa: el motor no
 * devuelve numeros inventados mientras no este implementado.
 *
 * Fase 1 sustituye este fichero por los tests de cada techo.
 */
describe('contrato del motor (Fase 0)', () => {
  it('no devuelve un resultado placeholder: lanza', () => {
    expect(() => calcularPrecioMaximo({} as never)).toThrow(NotImplementedError);
  });

  it('expone la version del motor para poder estamparla en el resultado', () => {
    expect(VERSION_MOTOR).toMatch(/^\d+\.\d+\.\d+/);
  });
});
