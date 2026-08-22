import { describe, expect, it } from 'vitest';

import { calcularT2 } from '../src/ceilings/t2-financiero';
import { baseImponibleITP, calcularGastosCompra } from '../src/costs/gastos-compra';
import type { CalcInput } from '../src/types';
import { configDeTest } from './fixtures/config';
import { compradorBase, entradaBase, propiedadBase } from './fixtures/inputs';

function correrT2(over: Partial<CalcInput> = {}) {
  const input = entradaBase(over);
  return calcularT2({
    fecha_calculo: input.fecha_calculo,
    property: input.property,
    buyer: input.buyer,
    config: input.config,
  });
}

function codigos(avisos: readonly { codigo: string }[]): string[] {
  return avisos.map((a) => a.codigo);
}

describe('T2 - restriccion de ahorro', () => {
  it('resuelve el precio maximo que cabe en el ahorro', () => {
    // gastos(P) = 0,1015 P + 1.365 para P > 100.000
    // 0,2 P + 0,1015 P + 1.365 <= 60.000  ->  P <= 194.477,61
    const exacto = 194477.61;
    const tolerancia = configDeTest().hipoteca.solver.tolerancia_eur;

    const r = correrT2();
    const t2 = r.techo.valor?.valor ?? 0;

    // La biseccion se queda por debajo de la raiz, nunca por encima. Importa la
    // direccion del error: pasarse seria recomendar un precio que no se puede pagar.
    expect(t2).toBeLessThanOrEqual(exacto);
    expect(t2).toBeGreaterThan(exacto - tolerancia);
    expect(r.techo.valor?.metodo).toContain('ahorro');
  });

  it('la entrada mas los gastos agotan exactamente el ahorro', () => {
    const r = correrT2();
    const precio = r.techo.valor?.valor ?? 0;
    const gastos = r.gastos?.total ?? 0;
    expect(0.2 * precio + gastos).toBeCloseTo(60000, 0);
  });

  it('devuelve un techo nulo si el ahorro no cubre ni el precio minimo', () => {
    const r = correrT2({ buyer: compradorBase({ ahorro_disponible: 2000 }) });
    expect(r.techo.valor).toBeNull();
    expect(codigos(r.techo.avisos)).toContain('SIN_CAPACIDAD_DE_COMPRA');
  });
});

describe('T2 - restriccion de cuota', () => {
  it('manda la cuota cuando sobra ahorro', () => {
    const r = correrT2({ buyer: compradorBase({ ahorro_disponible: 300000 }) });
    // cuota max 750 EUR, 30 anos al 3% -> capital 177.892 / LTV 0,8
    expect(r.techo.valor?.valor).toBeCloseTo(222365.3, 0);
    expect(r.techo.valor?.metodo).toContain('cuota');
  });

  it('las deudas actuales restan capacidad de pago', () => {
    const sinDeudas = correrT2({ buyer: compradorBase({ ahorro_disponible: 300000 }) });
    const conDeudas = correrT2({
      buyer: compradorBase({ ahorro_disponible: 300000, deudas_mensuales_actuales: 300 }),
    });
    expect(conDeudas.techo.valor?.valor).toBeLessThan(sinDeudas.techo.valor?.valor ?? 0);
  });

  it('devuelve techo nulo si las deudas se comen la cuota entera', () => {
    const r = correrT2({ buyer: compradorBase({ deudas_mensuales_actuales: 800 }) });
    expect(r.techo.valor).toBeNull();
    expect(codigos(r.techo.avisos)).toContain('SIN_CAPACIDAD_DE_COMPRA');
  });

  it('recorta el plazo por la edad limite de vencimiento', () => {
    const r = correrT2({
      buyer: compradorBase({ edad: 55, ahorro_disponible: 300000 }),
    });
    // 75 - 55 = 20 anos, no los 30 pedidos
    expect(codigos(r.techo.avisos)).toContain('PLAZO_RECORTADO');
  });

  it('topa un LTV por encima del maximo de la herramienta', () => {
    const r = correrT2({
      buyer: compradorBase({
        hipoteca: { ...compradorBase().hipoteca, ltv_max: 0.95 },
      }),
    });
    expect(codigos(r.techo.avisos)).toContain('LTV_TOPADO');
  });
});

describe('T2 - base imponible del impuesto', () => {
  it('la base es el mayor entre precio y valor de referencia catastral', () => {
    expect(baseImponibleITP(150000, 180000)).toEqual({ base: 180000, mandaValorReferencia: true });
    expect(baseImponibleITP(200000, 180000)).toEqual({ base: 200000, mandaValorReferencia: false });
    expect(baseImponibleITP(150000, null)).toEqual({ base: 150000, mandaValorReferencia: false });
  });

  it('avisa de forma destacada cuando manda el valor de referencia', () => {
    const input = entradaBase({
      property: propiedadBase({ valor_referencia_catastral: 250000 }),
    });
    const { gastos, avisos } = calcularGastosCompra(200000, {
      property: input.property,
      buyer: input.buyer,
      config: input.config,
    });

    expect(gastos.base_imponible_impuesto).toBe(250000);
    expect(gastos.manda_valor_referencia).toBe(true);
    expect(gastos.itp).toBeCloseTo(25000, 2); // 10% sobre 250.000, no sobre 200.000
    expect(codigos(avisos)).toContain('VALOR_REFERENCIA_MANDA');
  });

  it('avisa si no se ha comprobado el valor de referencia', () => {
    const input = entradaBase();
    const { avisos } = calcularGastosCompra(200000, {
      property: input.property,
      buyer: input.buyer,
      config: input.config,
    });
    expect(codigos(avisos)).toContain('SIN_VALOR_REFERENCIA');
  });

  it('un valor de referencia alto reduce el techo por ahorro', () => {
    const sin = correrT2();
    const con = correrT2({ property: propiedadBase({ valor_referencia_catastral: 250000 }) });
    expect(con.techo.valor?.valor).toBeLessThan(sin.techo.valor?.valor ?? 0);
  });
});

describe('T2 - resolucion del tipo de ITP', () => {
  it('aplica el tipo general a un comprador sin bonificaciones', () => {
    const r = correrT2();
    expect(r.gastos?.tipo_aplicado).toBe(0.1);
    expect(r.gastos?.modalidad).toContain('Tipo general');
  });

  it('aplica el tipo reducido de joven y eleva el techo', () => {
    const joven = compradorBase({ edad: 27, primera_vivienda_habitual: true });
    const r = correrT2({ buyer: joven });
    expect(r.gastos?.tipo_aplicado).toBe(0.06);
    expect(r.techo.valor?.valor).toBeGreaterThan(194477.61);
  });

  it('no aplica el tipo de joven si supera la edad limite', () => {
    const r = correrT2({ buyer: compradorBase({ edad: 36, primera_vivienda_habitual: true }) });
    expect(r.gastos?.tipo_aplicado).toBe(0.1);
  });

  it('elige la modalidad mas favorable entre las que cumple', () => {
    const r = correrT2({
      buyer: compradorBase({
        edad: 30,
        primera_vivienda_habitual: true,
        familia_numerosa: true,
        base_imponible_irpf_anual: 30000,
      }),
    });
    // familia numerosa al 4% es mejor que joven al 6%
    expect(r.gastos?.tipo_aplicado).toBe(0.04);
  });

  it('descarta la bonificacion y avisa si no se puede comprobar el limite de renta', () => {
    const r = correrT2({
      buyer: compradorBase({
        familia_numerosa: true,
        primera_vivienda_habitual: true,
        base_imponible_irpf_anual: null,
      }),
    });
    // Ante la duda, el tipo menos favorable: mejor quedarse corto que ofrecer de mas.
    expect(r.gastos?.tipo_aplicado).toBe(0.1);
    expect(codigos(r.techo.avisos)).toContain('BONIFICACION_SIN_COMPROBAR_RENTA');
  });

  it('descarta la bonificacion si la renta supera el limite', () => {
    const r = correrT2({
      buyer: compradorBase({
        familia_numerosa: true,
        primera_vivienda_habitual: true,
        base_imponible_irpf_anual: 90000,
      }),
    });
    expect(r.gastos?.tipo_aplicado).toBe(0.1);
  });

  it('falla ruidosamente si el tipo general sigue sin fijarse', () => {
    const config = configDeTest();
    config.itp.ccaa[0]!.tipo_general = null;
    expect(() => correrT2({ config })).toThrow(/tipo_general/);
  });

  it('falla ruidosamente si falta la edad limite de una modalidad que podria aplicar', () => {
    const config = configDeTest();
    config.itp.ccaa[0]!.tipos_reducidos[0]!.limite_edad = null;
    expect(() =>
      correrT2({ config, buyer: compradorBase({ edad: 27, primera_vivienda_habitual: true }) }),
    ).toThrow(/limite_edad/);
  });

  it('falla ruidosamente si no hay bloque de ITP para la comunidad', () => {
    const property = propiedadBase();
    property.localizacion.ccaa = 'Comunidad Foral de Navarra';
    expect(() => correrT2({ property })).toThrow(/Comunidad Foral de Navarra/);
  });
});

describe('T2 - escenario de estres', () => {
  it('no lo calcula con tipo fijo', () => {
    const r = correrT2();
    expect(r.techo.desglose.some((l) => l.concepto.includes('estres'))).toBe(false);
  });

  it('lo calcula con tipo variable', () => {
    const r = correrT2({
      buyer: compradorBase({
        hipoteca: { ...compradorBase().hipoteca, tipo: 'variable', euribor_actual: 0.02, diferencial: 0.01 },
      }),
    });
    expect(r.techo.desglose.some((l) => l.concepto.includes('estres'))).toBe(true);
  });

  it('avisa cuando la cuota estresada rompe el umbral', () => {
    // Con esfuerzo del 30% y +2 pp, el esfuerzo estresado se queda alrededor del
    // 37-40%, asi que un umbral del 40% casi nunca salta. Se baja el umbral para
    // comprobar el mecanismo de alerta, no para calibrarlo.
    const config = configDeTest();
    config.hipoteca.ratio_esfuerzo.umbral_alerta_escenario_estres.valor = 0.35;

    const r = correrT2({
      config,
      buyer: compradorBase({
        ahorro_disponible: 300000,
        hipoteca: { ...compradorBase().hipoteca, tipo: 'variable', euribor_actual: 0.02, diferencial: 0.01 },
      }),
    });
    expect(codigos(r.techo.avisos)).toContain('ESFUERZO_ESTRESADO_EXCESIVO');
  });
});
