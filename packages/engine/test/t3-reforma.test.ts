import { describe, expect, it } from 'vitest';

import { calcularT3 } from '../src/ceilings/t3-reforma';
import { resolverSuperficie } from '../src/superficie';
import { traza } from '../src/trace';
import type { CalcInput, ReformaPrevista } from '../src/types';
import { configDeTest } from './fixtures/config';
import { entradaBase, propiedadBase, reformaBase } from './fixtures/inputs';

const ARV_FIJO = traza({
  valor: 120000,
  fuente: 'test',
  fecha_dato: '2026-06-30',
  metodo: 'valor de test',
  confianza: 'media',
  unidad: 'EUR',
});

function correrT3(over: Partial<CalcInput> = {}, reforma: ReformaPrevista | null = reformaBase()) {
  const input = entradaBase(over);
  const { resuelta } = resolverSuperficie(
    input.property.superficie,
    input.config.coeficientes,
    input.fecha_calculo,
  );
  return calcularT3({
    fecha_calculo: input.fecha_calculo,
    property: input.property,
    config: input.config,
    superficie: resuelta,
    reforma,
    valorReformado: ARV_FIJO,
    arvDerivado: false,
  });
}

function codigos(avisos: readonly { codigo: string }[]): string[] {
  return avisos.map((a) => a.codigo);
}

describe('T3 - coste de la reforma', () => {
  it('encadena modulo, imprevistos e IVA en ese orden', () => {
    // 70 m2 x 800 = 56.000; x 1,15 = 64.400; x 1,21 (tipo general) = 77.924
    const r = correrT3();
    expect(r.costeReforma).toBeCloseTo(77924, 2);
  });

  it('resta coste y margen de seguridad del valor reformado', () => {
    // El margen es el 10% del COSTE DE OBRA, no del valor del inmueble (ADR-012)
    const r = correrT3();
    expect(r.techo.valor?.valor).toBeCloseTo(120000 - 77924 - 77924 * 0.1, 2);
  });

  it('el margen escala con la obra, no con el valor del inmueble', () => {
    const barata = correrT3({}, reformaBase({ nivel: 'lavado_de_cara' }));
    const cara = correrT3({}, reformaBase({ nivel: 'integral_premium' }));

    const margenDe = (r: ReturnType<typeof correrT3>): number =>
      r.techo.desglose.find((l) => l.concepto === 'Margen de seguridad')?.valor.valor ?? 0;

    expect(margenDe(barata)).toBeCloseTo((barata.costeReforma ?? 0) * 0.1, 2);
    expect(margenDe(cara)).toBeGreaterThan(margenDe(barata) * 5);
  });

  it('suma las partidas singulares como importe absoluto', () => {
    const sin = correrT3();
    const con = correrT3({}, reformaBase({ partidas_singulares: ['rehabilitacion_fachada'] }));
    // 15.000 de fachada, arrastrando imprevistos e IVA
    expect((con.costeReforma ?? 0) - (sin.costeReforma ?? 0)).toBeCloseTo(15000 * 1.15 * 1.21, 2);
  });

  it('sube la provision de imprevistos sin proyecto cerrado', () => {
    const r = correrT3({}, reformaBase({ hay_proyecto_cerrado: false }));
    expect(r.costeReforma).toBeCloseTo(56000 * 1.25 * 1.21, 2);
  });

  it('sube la provision de imprevistos en edificio anterior a 1970', () => {
    const r = correrT3({ property: propiedadBase({ anio_construccion: 1965 }) });
    expect(r.costeReforma).toBeCloseTo(56000 * 1.25 * 1.21, 2);
  });

  it('escala con el nivel de reforma elegido', () => {
    const parcial = correrT3({}, reformaBase({ nivel: 'reforma_parcial' }));
    const integral = correrT3({}, reformaBase({ nivel: 'reforma_integral' }));
    const premium = correrT3({}, reformaBase({ nivel: 'integral_premium' }));

    expect(parcial.costeReforma).toBeLessThan(integral.costeReforma ?? 0);
    expect(integral.costeReforma).toBeLessThan(premium.costeReforma ?? 0);
  });
});

describe('T3 - IVA del art. 91 LIVA', () => {
  it('aplica el tipo general si no se puede comprobar el valor catastral', () => {
    const r = correrT3();
    expect(r.costeReforma).toBeCloseTo(64400 * 1.21, 2);
    expect(codigos(r.techo.avisos)).toContain('SIN_VALOR_CATASTRAL');
  });

  it('aplica el tipo reducido cuando se cumplen las tres condiciones', () => {
    // valor catastral 40.000 x multiplicador 2 = limite 80.000 > 64.400
    const r = correrT3({ property: propiedadBase({ valor_catastral: 40000 }) });
    expect(r.costeReforma).toBeCloseTo(64400 * 1.1, 2);
  });

  it('vuelve al tipo general si el coste supera el limite sobre valor catastral', () => {
    // 10.000 x 2 = limite 20.000 < 64.400
    const r = correrT3({ property: propiedadBase({ valor_catastral: 10000 }) });
    expect(r.costeReforma).toBeCloseTo(64400 * 1.21, 2);
  });

  it('aplica el tipo general si el destinatario no actua como particular', () => {
    const r = correrT3(
      { property: propiedadBase({ valor_catastral: 40000 }) },
      reformaBase({ destinatario_particular: false }),
    );
    expect(r.costeReforma).toBeCloseTo(64400 * 1.21, 2);
  });

  it('aplica el tipo general si la vivienda no llega a la antiguedad minima', () => {
    const r = correrT3({
      property: propiedadBase({ valor_catastral: 40000, anio_construccion: 2025 }),
    });
    expect(r.costeReforma).toBeCloseTo(64400 * 1.21, 2);
  });

  it('modela siempre el escenario alternativo con el otro tipo', () => {
    const r = correrT3({ property: propiedadBase({ valor_catastral: 40000 }) });
    const alternativo = r.techo.desglose.find((l) => l.concepto.includes('Escenario alternativo'));
    expect(alternativo?.valor.valor).toBeCloseTo(64400 * 1.21, 2);
  });

  it('falla ruidosamente si los tipos de IVA siguen sin fijarse', () => {
    const config = configDeTest();
    config.reforma.iva.tipo_general = null;
    expect(() => correrT3({ config })).toThrow(/reforma\.iva\.tipo_general/);
  });
});

describe('T3 - casos limite', () => {
  it('no aplica si no hay reforma prevista', () => {
    const r = correrT3({}, null);
    expect(r.techo.aplica).toBe(false);
    expect(r.techo.valor).toBeNull();
    expect(r.techo.motivo_no_aplica).toContain('listo para entrar');
  });

  it('explica el motivo cuando el piso esta a reformar pero no se describe la reforma', () => {
    const r = correrT3({ property: propiedadBase({ estado_conservacion: 'a_reformar' }) }, null);
    expect(r.techo.motivo_no_aplica).toContain('no se ha descrito');
  });

  it('avisa cuando la reforma se come el valor del inmueble', () => {
    const r = correrT3({}, reformaBase({ nivel: 'integral_premium' }));
    // 70 x 1.200 x 1,15 x 1,21 = 116.886 mas margen, por encima de 120.000
    expect(r.techo.valor?.valor).toBeLessThan(0);
    expect(codigos(r.techo.avisos)).toContain('REFORMA_NO_RENTABLE');
  });

  it('falla ruidosamente si una partida singular sigue sin fijarse', () => {
    const config = configDeTest();
    config.reforma.partidas_singulares_eur['aerotermia'] = {
      min: null,
      max: null,
      sugerido: null,
      valor: null,
    };
    expect(() => correrT3({ config }, reformaBase({ partidas_singulares: ['aerotermia'] }))).toThrow(
      /aerotermia/,
    );
  });
});
