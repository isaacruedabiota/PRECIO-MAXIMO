import { describe, expect, it } from 'vitest';

import { calcularT4 } from '../src/ceilings/t4-rentabilidad';
import { calcularPrecioMaximo } from '../src/index';
import { traza } from '../src/trace';
import type { CalcInput } from '../src/types';
import { configDeTest } from './fixtures/config';
import {
  alquilerBase,
  compradorBase,
  entradaBase,
  inversionBase,
  mercadoBase,
  propiedadBase,
} from './fixtures/inputs';

const ARV = traza({
  valor: 150000,
  fuente: 'test',
  fecha_dato: '2026-06-30',
  metodo: 'valor de test',
  confianza: 'media',
  unidad: 'EUR',
});

function correrT4(over: Partial<CalcInput> = {}, costeReforma: number | null = null) {
  const input = entradaBase({
    buyer: compradorBase({ objetivo: 'inversion_alquiler' }),
    market: mercadoBase({ alquiler: alquilerBase() }),
    inversion: inversionBase(),
    ...over,
  });
  return calcularT4({
    fecha_calculo: input.fecha_calculo,
    property: input.property,
    buyer: input.buyer,
    market: input.market,
    config: input.config,
    inversion: input.inversion,
    costeReforma,
    valorReformado: ARV,
  });
}

function codigos(avisos: readonly { codigo: string }[]): string[] {
  return avisos.map((a) => a.codigo);
}

describe('T4 - alquiler', () => {
  it('resuelve el precio que da la rentabilidad neta objetivo', () => {
    // Ingresos brutos: 700 x 12 x 0,94 = 7.896
    // Gastos(P) = 2.195,90 + 0,0085 P   ->  NOI = 5.700,10 - 0,0085 P
    // Gastos de compra(P) = 0,105 P + 1.015 (por debajo de 100.000)
    // (5.700,10 - 0,0085 P) / (1,105 P + 1.015) = 0,045  ->  P = 97.113,4
    const r = correrT4();
    const t4 = r.techo.valor?.valor ?? 0;
    expect(t4).toBeLessThanOrEqual(97113.4);
    expect(t4).toBeGreaterThan(97113.4 - 1);
  });

  it('a ese precio, la rentabilidad neta es exactamente la objetivo', () => {
    const r = correrT4();
    expect(r.metricas?.rentabilidad_neta.valor).toBeCloseTo(0.045, 4);
  });

  it('calcula el NOI descontando todos los gastos recurrentes', () => {
    const r = correrT4();
    const t4 = r.techo.valor?.valor ?? 0;
    expect(r.metricas?.noi_anual.valor).toBeCloseTo(5700.1 - 0.0085 * t4, 1);
  });

  it('un objetivo mas exigente baja el techo', () => {
    const suave = correrT4({ inversion: inversionBase({ rentabilidad_objetivo: 0.03 }) });
    const exigente = correrT4({ inversion: inversionBase({ rentabilidad_objetivo: 0.07 }) });
    expect(exigente.techo.valor?.valor).toBeLessThan(suave.techo.valor?.valor ?? 0);
  });

  it('la gestion via agencia baja el techo frente a la autogestion', () => {
    const propia = correrT4();
    const agencia = correrT4({ inversion: inversionBase({ gestion: 'agencia' }) });
    expect(agencia.techo.valor?.valor).toBeLessThan(propia.techo.valor?.valor ?? 0);
  });

  it('el coste de reforma se descuenta del techo', () => {
    const sin = correrT4();
    const con = correrT4({}, 20000);
    expect(con.techo.valor?.valor).toBeLessThan(sin.techo.valor?.valor ?? 0);
  });

  it('calcula las cuatro metricas de la operacion', () => {
    const r = correrT4();
    const t4 = r.techo.valor?.valor ?? 0;
    const inversionTotal = t4 + (0.105 * t4 + 1015);

    expect(r.metricas?.rentabilidad_bruta.valor).toBeCloseTo((700 * 12) / inversionTotal, 4);
    expect(r.metricas?.cash_on_cash.valor).toBeGreaterThan(0);
    expect(r.metricas?.anios_recuperacion.valor).toBeGreaterThan(0);
    expect(r.metricas?.rentabilidad_bruta.valor).toBeGreaterThan(r.metricas!.rentabilidad_neta.valor);
  });

  it('avisa cuando la operacion no se paga sola', () => {
    // Objetivo bajo -> precio alto -> hipoteca grande frente al NOI
    const r = correrT4({ inversion: inversionBase({ rentabilidad_objetivo: 0.02 }) });
    expect(codigos(r.techo.avisos)).toContain('FLUJO_DE_CAJA_NEGATIVO');
    expect(r.metricas?.cash_on_cash.valor).toBeLessThan(0);
  });

  it('devuelve techo nulo si ninguna rentabilidad es alcanzable', () => {
    const r = correrT4({
      market: mercadoBase({ alquiler: alquilerBase({ renta_mensual_estimada: 100 }) }),
    });
    expect(r.techo.valor).toBeNull();
    expect(codigos(r.techo.avisos)).toContain('RENTABILIDAD_INALCANZABLE');
  });

  it('no aplica sin renta de mercado', () => {
    const r = correrT4({ market: mercadoBase({ alquiler: null }) });
    expect(r.techo.aplica).toBe(false);
    expect(r.techo.motivo_no_aplica).toContain('SERPAVI');
  });
});

describe('T4 - zona de mercado residencial tensionado', () => {
  it('limita la renta al indice de referencia y avisa', () => {
    const r = correrT4({
      market: mercadoBase({
        alquiler: alquilerBase({ zona_tensionada: true, renta_maxima_indice: 500 }),
      }),
    });
    const aviso = r.techo.avisos.find((a) => a.codigo === 'RENTA_LIMITADA_POR_ZONA_TENSIONADA');
    expect(aviso?.nivel).toBe('critico');
    expect(aviso?.referencia_legal).toContain('Ley 12/2023');
  });

  it('el limite tumba el techo de rentabilidad', () => {
    const libre = correrT4();
    const tensionada = correrT4({
      market: mercadoBase({
        alquiler: alquilerBase({ zona_tensionada: true, renta_maxima_indice: 500 }),
      }),
    });
    expect(tensionada.techo.valor?.valor).toBeLessThan(libre.techo.valor?.valor ?? 0);
  });

  it('no limita si el indice esta por encima de la renta de mercado', () => {
    const r = correrT4({
      market: mercadoBase({
        alquiler: alquilerBase({ zona_tensionada: true, renta_maxima_indice: 900 }),
      }),
    });
    expect(codigos(r.techo.avisos)).not.toContain('RENTA_LIMITADA_POR_ZONA_TENSIONADA');
  });

  it('avisa si es zona tensionada y no hay valor del indice', () => {
    const r = correrT4({
      market: mercadoBase({
        alquiler: alquilerBase({ zona_tensionada: true, renta_maxima_indice: null }),
      }),
    });
    expect(codigos(r.techo.avisos)).toContain('ZONA_TENSIONADA_SIN_LIMITE');
  });

  it('avisa si no se ha comprobado', () => {
    const r = correrT4({
      market: mercadoBase({ alquiler: alquilerBase({ zona_tensionada: null }) }),
    });
    expect(codigos(r.techo.avisos)).toContain('ZONA_TENSIONADA_SIN_COMPROBAR');
  });
});

describe('T4 - datos que no se estiman a la ligera', () => {
  it('exige el IBI: omitirlo inflaria la rentabilidad', () => {
    expect(() =>
      correrT4({
        property: propiedadBase({ valor_catastral: null }),
        inversion: inversionBase({ ibi_anual_eur: null }),
      }),
    ).toThrow(/ibi_anual_eur/);
  });

  it('estima el IBI desde el valor catastral si lo hay', () => {
    const r = correrT4({
      property: propiedadBase({ valor_catastral: 50000 }),
      inversion: inversionBase({ ibi_anual_eur: null }),
    });
    const ibi = r.techo.desglose.find((l) => l.concepto === 'IBI');
    expect(ibi?.valor.valor).toBeCloseTo(50000 * 0.006, 2);
  });

  it('exige la cuota de comunidad', () => {
    expect(() => correrT4({ inversion: inversionBase({ comunidad_mensual_eur: null }) })).toThrow(
      /comunidad_mensual_eur/,
    );
  });

  it('exige el tipo marginal de IRPF', () => {
    const config = configDeTest();
    config.rentabilidad.alquiler.irpf.tipo_marginal_estimado = null;
    expect(() =>
      correrT4({ config, inversion: inversionBase({ tipo_marginal_irpf: null }) }),
    ).toThrow(/tipo_marginal_irpf/);
  });

  it('exige la reduccion de IRPF por arrendamiento', () => {
    const config = configDeTest();
    config.rentabilidad.alquiler.irpf.reduccion_general = null;
    expect(() => correrT4({ config })).toThrow(/reduccion_general/);
  });

  it('avisa si la reduccion de IRPF no esta verificada', () => {
    const config = configDeTest();
    config.rentabilidad.alquiler.irpf.verificado = false;
    const r = correrT4({ config });
    expect(codigos(r.techo.avisos)).toContain('IRPF_ALQUILER_SIN_VERIFICAR');
  });
});

describe('T4 - flipping', () => {
  const correrFlip = (over: Partial<CalcInput> = {}, costeReforma: number | null = 40000) =>
    correrT4({ buyer: compradorBase({ objetivo: 'inversion_flipping' }), ...over }, costeReforma);

  it('aplica ARV por el factor menos el coste de reforma', () => {
    const r = correrFlip();
    // 150.000 x 0,72 - 40.000 = 68.000
    expect(r.techo.valor?.valor).toBeCloseTo(150000 * 0.72 - 40000, 2);
  });

  it('desglosa a donde va el complementario del factor', () => {
    const r = correrFlip();
    const partidas = r.techo.desglose.filter((l) => l.concepto.startsWith('Del 28%'));
    expect(partidas).toHaveLength(5);
    // Cada partida es un porcentaje del ARV
    const suma = partidas.reduce((s, l) => s + l.valor.valor, 0);
    expect(suma).toBeCloseTo(150000 * 0.28, 2);
  });

  it('avisa si el desglose no cuadra con el factor', () => {
    const config = configDeTest();
    config.rentabilidad.flipping.factor_arv.valor = 0.8; // complementario 0,20 != 0,28
    const r = correrFlip({ config });
    expect(codigos(r.techo.avisos)).toContain('DESGLOSE_FLIPPING_NO_CUADRA');
  });

  it('avisa si la operacion no deja margen', () => {
    const r = correrFlip({}, 120000);
    expect(r.techo.valor?.valor).toBeLessThan(0);
    expect(codigos(r.techo.avisos)).toContain('FLIPPING_SIN_RECORRIDO');
  });

  it('no aplica sin reforma prevista', () => {
    const r = correrFlip({}, null);
    expect(r.techo.aplica).toBe(false);
    expect(r.techo.motivo_no_aplica).toContain('reforma prevista');
  });

  it('no devuelve metricas de alquiler', () => {
    expect(correrFlip().metricas).toBeNull();
  });
});

describe('T4 dentro del calculo completo', () => {
  const entradaInversor = (over: Partial<CalcInput> = {}): CalcInput =>
    entradaBase({
      buyer: compradorBase({ objetivo: 'inversion_alquiler', ahorro_disponible: 300000 }),
      market: mercadoBase({ alquiler: alquilerBase() }),
      inversion: inversionBase(),
      ...over,
    });

  it('T4 entra en el minimo y puede ser el techo limitante', () => {
    const r = calcularPrecioMaximo(entradaInversor());

    expect(r.techos.T4.aplica).toBe(true);
    expect(r.techos.T4.valor).not.toBeNull();

    const valores = (['T1', 'T2', 'T4'] as const)
      .map((id) => r.techos[id].valor?.valor)
      .filter((v): v is number => v !== undefined && v !== null);
    expect(r.minimo_techos?.valor).toBeCloseTo(Math.min(...valores), 2);
  });

  it('las metricas de inversion viajan al resultado', () => {
    const r = calcularPrecioMaximo(entradaInversor());
    expect(r.metricas_inversion).not.toBeNull();
    expect(r.metricas_inversion?.noi_anual.fuente).toBeTruthy();
    expect(r.metricas_inversion?.rentabilidad_neta.unidad).toBe('porcentaje');
  });

  it('en modo residencia no hay metricas y T4 no aplica', () => {
    const r = calcularPrecioMaximo(entradaBase());
    expect(r.metricas_inversion).toBeNull();
    expect(r.techos.T4.aplica).toBe(false);
  });

  it('avisa si el objetivo es inversion y T4 no se puede calcular', () => {
    // Sin renta de mercado no hay T4, y saltarselo seria devolver un precio
    // ignorando justo el techo que manda en una operacion de inversion.
    const r = calcularPrecioMaximo(
      entradaInversor({ market: mercadoBase({ alquiler: null }) }),
    );
    expect(codigos(r.avisos)).toContain('T4_NO_CALCULABLE_EN_MODO_INVERSOR');
    expect(r.avisos.find((a) => a.codigo === 'T4_NO_CALCULABLE_EN_MODO_INVERSOR')?.nivel).toBe('critico');
  });
});

describe('T4 - cuando no aplica', () => {
  it('no aplica en modo residencia', () => {
    const r = correrT4({ buyer: compradorBase({ objetivo: 'residencia' }) });
    expect(r.techo.aplica).toBe(false);
    expect(r.techo.motivo_no_aplica).toContain('inversor');
  });

  it('no aplica si el objetivo es inversion pero faltan los datos de la operacion', () => {
    const r = correrT4({ inversion: null });
    expect(r.techo.aplica).toBe(false);
    expect(r.techo.motivo_no_aplica).toContain('datos de la operacion');
  });
});
