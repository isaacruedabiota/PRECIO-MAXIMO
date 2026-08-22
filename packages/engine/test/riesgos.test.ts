import { describe, expect, it } from 'vitest';

import { calcularPrecioMaximo } from '../src/index';
import { detectarBloqueantes } from '../src/risk/blockers';
import { calcularDescuentos } from '../src/risk/discounts';
import { configDeTest } from './fixtures/config';
import { entradaBase, propiedadBase, riesgosBase } from './fixtures/inputs';

function codigos(items: readonly { codigo: string }[]): string[] {
  return items.map((i) => i.codigo);
}

describe('descuentos por riesgo', () => {
  const config = configDeTest();
  const correr = (over: Parameters<typeof riesgosBase>[0], minimo = 100000) =>
    calcularDescuentos(riesgosBase(over), config, '2026-08-22', minimo);

  it('descuenta la derrama aprobada por su importe exacto, sin estimar', () => {
    const { descuentos } = correr({ derramas_aprobadas_eur: 4000 });
    const derrama = descuentos.find((d) => d.codigo === 'DERRAMA_APROBADA');
    expect(derrama?.importe.valor).toBe(4000);
    expect(derrama?.importe.confianza).toBe('alta');
    expect(derrama?.importe.fuente).toContain('acta');
  });

  it('descuenta las cargas registrales por su importe exacto', () => {
    const { descuentos } = correr({ cargas_registrales_eur: 18000 });
    expect(descuentos.find((d) => d.codigo === 'CARGAS_REGISTRALES')?.importe.valor).toBe(18000);
  });

  it('estima la ITE desfavorable por metros de fachada', () => {
    const { descuentos } = correr({ ite: 'desfavorable', metros_fachada_edificio: 200 });
    expect(descuentos.find((d) => d.codigo === 'ITE_DESFAVORABLE')?.importe.valor).toBe(120 * 200);
  });

  it('penaliza menos una ITE sin pasar que una desfavorable', () => {
    const desfavorable = correr({ ite: 'desfavorable', metros_fachada_edificio: 200 });
    const sinPasar = correr({ ite: 'no_pasada', metros_fachada_edificio: 200 });
    expect(sinPasar.descuentos[0]?.importe.valor).toBeLessThan(
      desfavorable.descuentos[0]?.importe.valor ?? 0,
    );
  });

  it('no descuenta la ITE sin metros de fachada, pero avisa del riesgo', () => {
    const { descuentos, avisos } = correr({ ite: 'desfavorable', metros_fachada_edificio: null });
    expect(descuentos).toHaveLength(0);
    expect(codigos(avisos)).toContain('ITE_SIN_METROS_FACHADA');
  });

  it('no descuenta el fibrocemento sin importe configurado, pero avisa', () => {
    const sinImporte = configDeTest();
    sinImporte.riesgos.descuentos.fibrocemento.eur.valor = null;
    const { descuentos, avisos } = calcularDescuentos(
      riesgosBase({ fibrocemento_en_cubierta: true }),
      sinImporte,
      '2026-08-22',
      100000,
    );
    expect(descuentos).toHaveLength(0);
    expect(codigos(avisos)).toContain('FIBROCEMENTO_SIN_CUANTIFICAR');
  });

  it('aplica los riesgos porcentuales sobre el minimo de los techos', () => {
    const { descuentos } = correr({ zona_inundable: 'si' }, 200000);
    expect(descuentos.find((d) => d.codigo === 'ZONA_INUNDABLE')?.importe.valor).toBe(200000 * 0.05);
  });

  it('avisa si la zona inundable esta sin comprobar', () => {
    const { avisos } = correr({ zona_inundable: 'desconocido' });
    expect(codigos(avisos)).toContain('ZONA_INUNDABLE_SIN_COMPROBAR');
  });

  it('acumula varios riesgos a la vez', () => {
    const { descuentos } = correr({
      derramas_aprobadas_eur: 4000,
      cargas_registrales_eur: 10000,
      ite: 'no_pasada',
      metros_fachada_edificio: 100,
    });
    expect(descuentos).toHaveLength(3);
  });
});

describe('bloqueantes', () => {
  const config = configDeTest();

  it('bloquea cuando no hay division horizontal', () => {
    const { bloqueantes } = detectarBloqueantes(
      propiedadBase({ tiene_division_horizontal: false }),
      riesgosBase(),
      config,
    );
    expect(codigos(bloqueantes)).toEqual(['SIN_DIVISION_HORIZONTAL']);
  });

  it('bloquea una VPO con precio maximo vigente', () => {
    const { bloqueantes } = detectarBloqueantes(propiedadBase({ es_vpo: true }), riesgosBase(), config);
    expect(codigos(bloqueantes)).toEqual(['VPO_PRECIO_MAXIMO']);
  });

  it('bloquea una afeccion urbanistica', () => {
    const { bloqueantes } = detectarBloqueantes(
      propiedadBase(),
      riesgosBase({ afeccion_urbanistica: true }),
      config,
    );
    expect(codigos(bloqueantes)).toEqual(['AFECCION_URBANISTICA']);
  });

  it('lo desconocido avisa pero no bloquea', () => {
    const { bloqueantes, avisos } = detectarBloqueantes(
      propiedadBase({ tiene_division_horizontal: null, es_vpo: null }),
      riesgosBase(),
      config,
    );
    expect(bloqueantes).toHaveLength(0);
    expect(codigos(avisos)).toContain('DIVISION_HORIZONTAL_SIN_COMPROBAR');
    expect(codigos(avisos)).toContain('VPO_SIN_COMPROBAR');
  });

  it('un bloqueante detiene el calculo entero y no devuelve ningun precio', () => {
    const resultado = calcularPrecioMaximo(
      entradaBase({ property: propiedadBase({ tiene_division_horizontal: false }) }),
    );

    expect(resultado.bloqueantes).toHaveLength(1);
    expect(resultado.precio_maximo).toBeNull();
    expect(resultado.minimo_techos).toBeNull();
    expect(resultado.precio_entrada_negociacion).toBeNull();
    expect(resultado.techo_limitante).toBeNull();

    // Ni un solo techo con valor: dar cifras aqui seria dar un numero falso.
    for (const id of ['T1', 'T2', 'T3', 'T4'] as const) {
      expect(resultado.techos[id].valor).toBeNull();
    }

    // El disclaimer sigue estando, tambien cuando no hay resultado.
    expect(resultado.disclaimer).toContain('ECO/805/2003');
  });
});
