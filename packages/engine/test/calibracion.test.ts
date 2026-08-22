import { describe, expect, it } from 'vitest';

import { calcularT1 } from '../src/ceilings/t1-mercado';
import { analizarSensibilidad } from '../src/calibration/sensibilidad';
import { comprobarCoherenciaEstadoReforma } from '../src/calibration/coherencia';
import { contrastarComparables } from '../src/calibration/comparables';
import { resolverSuperficie } from '../src/superficie';
import type { CalcInput } from '../src/types';
import { configDeTest } from './fixtures/config';
import { entradaBase, mercadoBase, propiedadBase } from './fixtures/inputs';

/** T1 como calculadora, que es lo que se esta calibrando. */
const calculadoraT1 = (i: CalcInput) => {
  const { resuelta } = resolverSuperficie(i.property.superficie, i.config.coeficientes, i.fecha_calculo);
  const r = calcularT1({
    fecha_calculo: i.fecha_calculo,
    property: i.property,
    market: i.market,
    config: i.config,
    superficie: resuelta,
  });
  return { precio_maximo: { valor: r.valorTotal } };
};

describe('coherencia entre estado de T1 y coste de obra de T3', () => {
  const config = configDeTest();

  it('el coeficiente neto es el salto limpio entre los dos estados', () => {
    const r = comprobarCoherenciaEstadoReforma({ config, m2_utiles: 70, iva_override: 0 });
    // 1,11 - 0,82 = 0,29. El margen ya no se descuenta aqui: va en el coste.
    expect(r.niveles[0]?.coeficiente_neto).toBeCloseTo(0.29, 6);
  });

  it('el punto de equilibrio es coste dividido por coeficiente neto y metros', () => {
    const r = comprobarCoherenciaEstadoReforma({
      config,
      m2_utiles: 70,
      iva_override: 0,
      edificio_antiguo_o_sin_proyecto: false,
    });
    const nivel = r.niveles.find((n) => n.nivel === 'lavado_de_cara');
    // 200 EUR/m2 x 70 m2 x 1,15 imprevistos x 1,10 margen = 17.710 EUR
    expect(nivel?.coste_total_eur).toBeCloseTo(17710, 2);
    // 17.710 / (0,29 x 70) = 872,41 EUR/m2
    expect(nivel?.eur_m2_equilibrio).toBeCloseTo(17710 / (0.29 * 70), 1);
  });

  it('mover el margen mueve el equilibrio, ahora que va sobre la obra', () => {
    const suave = configDeTest();
    suave.reforma.margen_seguridad.valor = 0.05;
    const estricto = configDeTest();
    estricto.reforma.margen_seguridad.valor = 0.2;

    const a = comprobarCoherenciaEstadoReforma({ config: suave, m2_utiles: 70, iva_override: 0 });
    const b = comprobarCoherenciaEstadoReforma({ config: estricto, m2_utiles: 70, iva_override: 0 });

    // El coeficiente neto no cambia; lo que cambia es el coste a superar.
    expect(a.niveles[0]?.coeficiente_neto).toBeCloseTo(b.niveles[0]?.coeficiente_neto ?? 0, 6);
    expect(b.niveles[0]!.eur_m2_equilibrio!).toBeGreaterThan(a.niveles[0]!.eur_m2_equilibrio!);
  });

  it('marca que no compensa cuando el EUR/m2 esta por debajo del equilibrio', () => {
    // El equilibrio del nivel mas barato esta en 872 EUR/m2
    const r = comprobarCoherenciaEstadoReforma({
      config,
      m2_utiles: 70,
      eur_m2_homogeneizado: 800,
      iva_override: 0,
    });
    expect(r.niveles.every((n) => n.compensa === false)).toBe(true);
    expect(r.diagnostico).toContain('ningun nivel de reforma compensa');
  });

  it('con el margen sobre la obra, el nivel mas barato compensa a precios de Castellon', () => {
    // Con el margen sobre el valor reformado, el equilibrio del lavado de cara
    // estaba en 1.285 EUR/m2 y no compensaba a 1.000. Ahora esta en 872.
    const r = comprobarCoherenciaEstadoReforma({
      config,
      m2_utiles: 70,
      eur_m2_homogeneizado: 1000,
      iva_override: 0,
    });
    expect(r.niveles.find((n) => n.nivel === 'lavado_de_cara')?.compensa).toBe(true);
    expect(r.niveles.find((n) => n.nivel === 'reforma_integral')?.compensa).toBe(false);
  });

  it('marca que compensa cuando el EUR/m2 esta por encima', () => {
    const r = comprobarCoherenciaEstadoReforma({
      config,
      m2_utiles: 70,
      eur_m2_homogeneizado: 4000,
      iva_override: 0,
    });
    expect(r.niveles.find((n) => n.nivel === 'lavado_de_cara')?.compensa).toBe(true);
    expect(r.diagnostico).toContain('compensan');
  });

  it('detecta unos coeficientes de estado imposibles', () => {
    const incoherente = configDeTest();
    // Reformado valdria menos que a reformar: no puede ser.
    incoherente.coeficientes.estado_conservacion.reformado_reciente.valor = 0.8;
    const r = comprobarCoherenciaEstadoReforma({ config: incoherente, m2_utiles: 70, iva_override: 0 });

    expect(r.niveles[0]?.coeficiente_neto).toBeLessThan(0);
    expect(r.niveles.every((n) => n.eur_m2_equilibrio === null)).toBe(true);
    expect(r.diagnostico).toContain('obra gratis');
  });

  it('el IVA a cero es una cota inferior: con IVA el coste solo sube', () => {
    const sinIva = comprobarCoherenciaEstadoReforma({ config, m2_utiles: 70, iva_override: 0 });
    const conIva = comprobarCoherenciaEstadoReforma({ config, m2_utiles: 70, iva_reducido: true });

    expect(conIva.niveles[0]!.coste_total_eur).toBeGreaterThan(sinIva.niveles[0]!.coste_total_eur);
    expect(conIva.niveles[0]!.eur_m2_equilibrio!).toBeGreaterThan(sinIva.niveles[0]!.eur_m2_equilibrio!);
  });

  it('falla ruidosamente si se le pide el IVA real y sigue sin fijarse', () => {
    const sinIva = configDeTest();
    sinIva.reforma.iva.tipo_reducido_rehabilitacion = null;
    expect(() =>
      comprobarCoherenciaEstadoReforma({ config: sinIva, m2_utiles: 70, iva_reducido: true }),
    ).toThrow(/tipo_reducido_rehabilitacion/);
  });
});

describe('analisis de sensibilidad', () => {
  it('ordena los valores por cuanto mueven el resultado', () => {
    const r = analizarSensibilidad(entradaBase(), calculadoraT1, ['coeficientes']);
    for (let i = 1; i < r.impactos.length; i += 1) {
      expect(r.impactos[i]!.recorrido_eur).toBeLessThanOrEqual(r.impactos[i - 1]!.recorrido_eur);
    }
  });

  it('los coeficientes que no aplican al caso salen con recorrido cero', () => {
    // El caso base tiene ascensor, luego los coeficientes de sin_ascensor no le afectan
    const r = analizarSensibilidad(entradaBase(), calculadoraT1, ['coeficientes']);
    const sinAscensor = r.impactos.filter((i) => i.ruta.includes('sin_ascensor'));
    expect(sinAscensor.length).toBeGreaterThan(0);
    expect(sinAscensor.every((i) => i.recorrido_eur === 0)).toBe(true);
  });

  it('detecta el bloque de antiguedad como el que mas mueve un piso viejo', () => {
    const r = analizarSensibilidad(
      entradaBase({ property: propiedadBase({ anio_construccion: 1975 }) }),
      calculadoraT1,
      ['coeficientes'],
    );
    expect(r.impactos[0]?.ruta).toContain('antiguedad');
  });

  it('el recorrido de un coeficiente es coherente con su horquilla', () => {
    const r = analizarSensibilidad(
      entradaBase({ property: propiedadBase({ certificado_energetico: { estado: 'registrado', letra_consumo: 'G' } }) }),
      calculadoraT1,
      ['coeficientes'],
    );
    const cee = r.impactos.find((i) => i.ruta === 'coeficientes.certificado_energetico.G');
    expect(cee?.min).toBe(0.93);
    expect(cee?.max).toBe(0.97);
    expect(cee?.recorrido_eur).toBeGreaterThan(0);
  });

  it('explora un +-10% cuando el valor no declara horquilla', () => {
    const r = analizarSensibilidad(
      entradaBase({ property: propiedadBase({ planta: { numero: 0, es_atico: false, es_bajo: true } }) }),
      calculadoraT1,
      ['coeficientes'],
    );
    const bajo = r.impactos.find((i) => i.ruta === 'coeficientes.planta.bajo');
    expect(bajo?.valor_actual).toBe(0.9);
    expect(bajo?.min).toBeCloseTo(0.81, 6);
    expect(bajo?.max).toBeCloseTo(0.99, 6);
  });

  it('no modifica la config que se le pasa', () => {
    const input = entradaBase();
    const antes = input.config.coeficientes.estado_conservacion.a_reformar.valor;
    analizarSensibilidad(input, calculadoraT1, ['coeficientes']);
    expect(input.config.coeficientes.estado_conservacion.a_reformar.valor).toBe(antes);
  });
});

describe('contraste contra comparables observados', () => {
  const config = configDeTest();
  const market = mercadoBase();
  const fecha = '2026-08-22';

  /** Un comparable identico al caso base, con el precio que quiera el test. */
  const comparable = (id: string, precio: number) => ({
    id,
    precio_observado: precio,
    property: propiedadBase(),
  });

  it('mide el sesgo con signo: positivo es sobrevalorar', () => {
    // El modelo estima 71.069,60 para este piso
    const r = contrastarComparables({
      comparables: [comparable('a', 60000), comparable('b', 60000)],
      market,
      config,
      fecha_calculo: fecha,
    });
    expect(r.sesgo_pct).toBeGreaterThan(0);
    expect(r.diagnostico).toContain('sobrevalora');
  });

  it('detecta cuando el modelo infravalora', () => {
    const r = contrastarComparables({
      comparables: [comparable('a', 90000)],
      market,
      config,
      fecha_calculo: fecha,
    });
    expect(r.sesgo_pct).toBeLessThan(0);
    expect(r.diagnostico).toContain('infravalora');
  });

  it('distingue sesgo de dispersion', () => {
    // Errores simetricos: sesgo cerca de cero pero dispersion alta
    const r = contrastarComparables({
      comparables: [comparable('alto', 90000), comparable('bajo', 58000)],
      market,
      config,
      fecha_calculo: fecha,
    });
    expect(Math.abs(r.sesgo_pct)).toBeLessThan(r.error_absoluto_medio_pct);
    expect(r.diagnostico).toContain('centrado');
  });

  it('senala el peor comparable', () => {
    const r = contrastarComparables({
      comparables: [comparable('cerca', 70000), comparable('lejos', 20000)],
      market,
      config,
      fecha_calculo: fecha,
    });
    expect(r.peor?.id).toBe('lejos');
  });

  it('avisa de que con pocos comparables no se puede afinar', () => {
    const r = contrastarComparables({
      comparables: [comparable('a', 71070)],
      market,
      config,
      fecha_calculo: fecha,
    });
    expect(r.diagnostico).toContain('Solo 1 comparables');
  });

  it('se niega a contrastar sin comparables', () => {
    expect(() =>
      contrastarComparables({ comparables: [], market, config, fecha_calculo: fecha }),
    ).toThrow();
  });
});
