import { describe, expect, it } from 'vitest';

import { arancelEscalado } from '../src/costs/arancel';
import { capitalDesdeCuota, cuotaFrances, mayorQueCumple } from '../src/math/finance';
import { configDeTest } from './fixtures/config';

describe('sistema frances', () => {
  it('calcula la cuota de un prestamo estandar', () => {
    // 100.000 EUR a 30 anos al 3% nominal
    expect(cuotaFrances(100000, 0.03 / 12, 360)).toBeCloseTo(421.6, 1);
  });

  it('reparte linealmente cuando el interes es cero', () => {
    expect(cuotaFrances(120000, 0, 240)).toBe(500);
  });

  it('capitalDesdeCuota es la inversa exacta de cuotaFrances', () => {
    const capital = 187345.67;
    const cuota = cuotaFrances(capital, 0.029 / 12, 300);
    expect(capitalDesdeCuota(cuota, 0.029 / 12, 300)).toBeCloseTo(capital, 6);
  });

  it('un capital de cero no genera cuota', () => {
    expect(cuotaFrances(0, 0.03 / 12, 360)).toBe(0);
  });

  it('rechaza un plazo no positivo en lugar de dividir por cero', () => {
    expect(() => cuotaFrances(100000, 0.0025, 0)).toThrow();
    expect(() => capitalDesdeCuota(500, 0.0025, -12)).toThrow();
  });
});

describe('biseccion', () => {
  it('encuentra el mayor valor que cumple, dentro de la tolerancia', () => {
    const resultado = mayorQueCumple((p) => p <= 1234.5, {
      min: 0,
      max: 10000,
      tolerancia: 0.01,
      maxIteraciones: 200,
    });
    expect(resultado).toBeGreaterThan(1234.49);
    expect(resultado).toBeLessThanOrEqual(1234.5);
  });

  it('devuelve 0 si ni el minimo cumple', () => {
    expect(
      mayorQueCumple(() => false, { min: 10, max: 1000, tolerancia: 1, maxIteraciones: 50 }),
    ).toBe(0);
  });

  it('devuelve el maximo si todo el intervalo cumple', () => {
    expect(
      mayorQueCumple(() => true, { min: 10, max: 1000, tolerancia: 1, maxIteraciones: 50 }),
    ).toBe(1000);
  });

  it('resuelve una funcion con escalones, que es el caso real de T2', () => {
    // gastos con un salto brusco en 100.000, como los tramos de arancel
    const cabe = (p: number): boolean => p + (p > 100000 ? 50000 : 0) <= 120000;
    const resultado = mayorQueCumple(cabe, {
      min: 0,
      max: 200000,
      tolerancia: 1,
      maxIteraciones: 200,
    });
    expect(resultado).toBeGreaterThan(99999);
    expect(resultado).toBeLessThanOrEqual(100000);
  });
});

describe('arancel escalado', () => {
  const config = configDeTest();

  it('aplica cada tipo solo a la parte de base que cae en su tramo', () => {
    // 100 de cuota fija + 100.000 x 0,003 + 50.000 x 0,001
    expect(arancelEscalado(150000, config.aranceles.notaria, 'aranceles.notaria')).toBeCloseTo(450, 6);
    // 50 + 100.000 x 0,002 + 50.000 x 0,0005
    expect(arancelEscalado(150000, config.aranceles.registro, 'aranceles.registro')).toBeCloseTo(275, 6);
  });

  it('no pasa del primer tramo cuando la base es pequena', () => {
    // 100 + 50.000 x 0,003
    expect(arancelEscalado(50000, config.aranceles.notaria, 'aranceles.notaria')).toBeCloseTo(250, 6);
  });

  it('falla ruidosamente si no hay tramos cargados', () => {
    const sinTramos = { ...config.aranceles.notaria, tramos: [] };
    expect(() => arancelEscalado(150000, sinTramos, 'aranceles.notaria')).toThrow(
      /aranceles\.notaria\.tramos/,
    );
  });

  it('falla ruidosamente si falta el IVA aplicable', () => {
    const sinIva = { ...config.aranceles.notaria, iva_aplicable: null };
    expect(() => arancelEscalado(150000, sinIva, 'aranceles.notaria')).toThrow(
      /aranceles\.notaria\.iva_aplicable/,
    );
  });
});
