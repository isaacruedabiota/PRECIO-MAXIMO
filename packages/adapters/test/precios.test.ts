/**
 * Tests de la cascada de precios y de la variacion acumulada del IPV.
 *
 * Los dos son puros: se prueban sin base y sin red. Las cifras de IPV que se
 * usan son las reales de la Comunitat Valenciana en la tabla 80270.
 */

import { describe, expect, it } from 'vitest';

import {
  SinPrecioDeMercadoError,
  resolverCascada,
} from '../src/precios/cascada';
import type { CandidatoPrecio } from '../src/precios/cascada';
import {
  SerieIpvInsuficienteError,
  ordinalTrimestre,
  trimestreDeFecha,
  variacionAcumulada,
} from '../src/precios/variacion-ipv';

function candidato(
  ambito: CandidatoPrecio['ambito'],
  eur: number,
  descripcion = ambito,
): CandidatoPrecio {
  return {
    eur_m2: eur,
    ambito,
    fuente: 'test',
    fuente_url: null,
    fecha_dato: '2026-03-31',
    n_transacciones: null,
    p25: null,
    p75: null,
    base_superficie: 'construida',
    descripcion,
  };
}

describe('cascada de precios de T1', () => {
  it('prefiere el codigo postal al municipio y al provincial', () => {
    const r = resolverCascada(
      [candidato('provincia', 1445), candidato('municipio', 1522), candidato('codigo_postal', 1610)],
      'test',
    );
    expect(r.elegido.ambito).toBe('codigo_postal');
    expect(r.elegido.eur_m2).toBe(1610);
    expect(r.descartados).toHaveLength(2);
  });

  it('cae al municipio cuando no hay dato de escrituras', () => {
    const r = resolverCascada([candidato('provincia', 1445), candidato('municipio', 1522)], 'test');
    expect(r.elegido.ambito).toBe('municipio');
    expect(r.explicacion).toContain('no hay dato de escrituras');
  });

  it('avisa de que un precio provincial mezcla mercados distintos', () => {
    const r = resolverCascada([candidato('provincia', 1445)], 'test');
    expect(r.elegido.ambito).toBe('provincia');
    expect(r.explicacion).toContain('mezcla mercados');
  });

  it('deja constancia de lo que descarta y por que', () => {
    const r = resolverCascada([candidato('municipio', 1522), candidato('provincia', 1445)], 'test');
    expect(r.descartados[0]?.candidato.ambito).toBe('provincia');
    expect(r.descartados[0]?.motivo).toContain('mas fino');
  });

  it('no promedia escalones: elige uno y dice cual', () => {
    const r = resolverCascada([candidato('municipio', 1522), candidato('provincia', 1445)], 'test');
    expect(r.elegido.eur_m2).toBe(1522);
  });

  it('para en lugar de inventar un precio cuando no hay ninguno', () => {
    expect(() => resolverCascada([], 'CP 12006')).toThrow(SinPrecioDeMercadoError);
  });

  it('descarta un cero o un negativo, que no son precios', () => {
    expect(() => resolverCascada([candidato('municipio', 0)], 'test')).toThrow(
      SinPrecioDeMercadoError,
    );
  });
});

describe('trimestres', () => {
  it('ordena por ano y trimestre', () => {
    expect(ordinalTrimestre('2026Q1')).toBeGreaterThan(ordinalTrimestre('2025Q4'));
    expect(ordinalTrimestre('2025Q4') - ordinalTrimestre('2025Q1')).toBe(3);
  });

  it('saca el trimestre de una fecha', () => {
    expect(trimestreDeFecha('2026-03-31')).toBe('2026Q1');
    expect(trimestreDeFecha('2025-10-01')).toBe('2025Q4');
  });
});

describe('variacion acumulada del IPV', () => {
  // Indices reales de la Comunitat Valenciana, tabla 80270, serie general.
  const serie = [
    { periodo: '2024Q4', indice: 94.511 },
    { periodo: '2025Q1', indice: 98.832 },
    { periodo: '2025Q2', indice: 102.13 },
    { periodo: '2025Q3', indice: 104.528 },
    { periodo: '2026Q1', indice: 108.019 },
  ];

  it('acumula entre dos trimestres publicados', () => {
    const r = variacionAcumulada('Comunitat Valenciana', serie, '2025Q1', '2026Q1');
    expect(r.variacion).toBeCloseTo(108.019 / 98.832 - 1, 9);
    expect(r.variacion).toBeGreaterThan(0.09);
  });

  it('usa el ultimo trimestre publicado cuando el pedido aun no existe', () => {
    const r = variacionAcumulada('Comunitat Valenciana', serie, '2025Q1', '2026Q3');
    expect(r.hasta).toBe('2026Q1');
    expect(r.notas.join(' ')).toContain('aun no esta publicado');
  });

  it('no extrapola: la variacion es la del ultimo dato real', () => {
    const pedido = variacionAcumulada('Comunitat Valenciana', serie, '2025Q1', '2026Q3');
    const real = variacionAcumulada('Comunitat Valenciana', serie, '2025Q1', '2026Q1');
    expect(pedido.variacion).toBe(real.variacion);
  });

  it('para si falta el trimestre de origen, que es el del dato de MITMA', () => {
    expect(() => variacionAcumulada('Comunitat Valenciana', serie, '2019Q1', '2026Q1')).toThrow(
      SerieIpvInsuficienteError,
    );
  });

  it('para con una serie vacia en vez de devolver variacion cero', () => {
    expect(() => variacionAcumulada('Aragon', [], '2025Q1', '2026Q1')).toThrow(
      SerieIpvInsuficienteError,
    );
  });

  it('da variacion negativa hacia atras, y lo dice', () => {
    const r = variacionAcumulada('Comunitat Valenciana', serie, '2026Q1', '2024Q4');
    expect(r.variacion).toBeLessThan(0);
    expect(r.notas.join(' ')).toContain('anterior al de origen');
  });
});
