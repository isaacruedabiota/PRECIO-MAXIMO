import { describe, expect, it } from 'vitest';

import { calcularT1 } from '../src/ceilings/t1-mercado';
import { resolverSuperficie } from '../src/superficie';
import type { CalcInput } from '../src/types';
import { configDeTest } from './fixtures/config';
import { entradaBase, mercadoBase, propiedadBase } from './fixtures/inputs';

function correrT1(over: Partial<CalcInput> = {}, estadoOverride?: 'reformado_reciente') {
  const input = entradaBase(over);
  const { resuelta } = resolverSuperficie(input.property.superficie, input.config.coeficientes, input.fecha_calculo);
  return calcularT1({
    fecha_calculo: input.fecha_calculo,
    property: input.property,
    market: input.market,
    config: input.config,
    superficie: resuelta,
    ...(estadoOverride !== undefined ? { estadoOverride } : {}),
  });
}

function codigos(avisos: readonly { codigo: string }[]): string[] {
  return avisos.map((a) => a.codigo);
}

describe('T1 - techo de mercado', () => {
  it('multiplica los coeficientes y aplica la superficie util', () => {
    const r = correrT1();

    // 70 m2 utiles, planta 2 con ascensor, exterior, CEE D, edificio de 2000.
    // planta 0,98 x antiguedad (1 - 26/100) 0,74 = 0,7252
    // 1.400 EUR/m2 x 0,7252 = 1.015,28 -> x 70 m2 = 71.069,60
    expect(r.eurM2Homogeneizado).toBeCloseTo(1015.28, 2);
    expect(r.techo.valor?.valor).toBeCloseTo(71069.6, 2);
  });

  it('homogeneiza tambien la horquilla P25-P75', () => {
    const r = correrT1();
    // Los percentiles recorren el mismo camino que el valor central
    expect(r.techo.rango?.min).toBeCloseTo(1200 * 0.7252 * 70, 1);
    expect(r.techo.rango?.max).toBeCloseTo(1650 * 0.7252 * 70, 1);
  });

  it('convierte el precio de referencia a superficie util cuando viene en construida', () => {
    const r = correrT1({
      market: mercadoBase({
        precio_m2: { ...mercadoBase().precio_m2, eur_m2: 1400, base_superficie: 'construida' },
      }),
    });
    // 1.400 / 0,82 = 1.707,32 EUR/m2 util antes de homogeneizar
    expect(r.eurM2Homogeneizado).toBeCloseTo((1400 / 0.82) * 0.7252, 2);
    expect(codigos(r.techo.avisos)).toContain('PRECIO_BASE_CONVERTIDO');
  });

  it('usa un factor distinto para la construida con partes comunes', () => {
    // MITMA calcula su EUR/m2 sobre superficie construida SIN comunes; los
    // anuncios suelen dar la construida CON comunes. Aplicarles el mismo factor
    // mete un error de alrededor del 6% en T1.
    const sinComunes = correrT1({
      property: propiedadBase({ superficie: { tipo: 'construida', m2: 85 } }),
    });
    const conComunes = correrT1({
      property: propiedadBase({ superficie: { tipo: 'construida_con_comunes', m2: 85 } }),
    });

    // 85 x 0,82 = 69,7 m2 utiles frente a 85 x 0,76 = 64,6
    expect(sinComunes.techo.valor?.valor).toBeGreaterThan(conComunes.techo.valor?.valor ?? 0);
    expect((conComunes.techo.valor?.valor ?? 0) / (sinComunes.techo.valor?.valor ?? 1)).toBeCloseTo(
      0.76 / 0.82,
      4,
    );
  });

  it('no sustituye un factor por el otro si el de comunes no esta fijado', () => {
    const config = configDeTest();
    config.coeficientes.superficie.factor_construida_con_comunes_a_util.valor = null;
    expect(() =>
      correrT1({
        config,
        property: propiedadBase({ superficie: { tipo: 'construida_con_comunes', m2: 85 } }),
      }),
    ).toThrow(/factor_construida_con_comunes_a_util/);
  });

  it('convierte la base del precio segun la superficie a la que se refiera la fuente', () => {
    const enUtil = correrT1();
    const enConstruida = correrT1({
      market: mercadoBase({
        precio_m2: { ...mercadoBase().precio_m2, base_superficie: 'construida' },
      }),
    });
    // Mismo EUR/m2 nominal, pero referido a construida vale mas por metro util
    expect(enConstruida.eurM2Homogeneizado).toBeCloseTo(enUtil.eurM2Homogeneizado / 0.82, 4);
  });

  it('el factor se cancela si la superficie y el precio son de la misma base', () => {
    // Multiplica los metros y divide el EUR/m2 en la misma proporcion.
    const conBase = (factor: number) => {
      const config = configDeTest();
      config.coeficientes.superficie.factor_construida_a_util.valor = factor;
      return correrT1({
        config,
        property: propiedadBase({ superficie: { tipo: 'construida', m2: 85 } }),
        market: mercadoBase({
          precio_m2: { ...mercadoBase().precio_m2, base_superficie: 'construida' },
        }),
      }).techo.valor?.valor;
    };

    expect(conBase(0.78)).toBeCloseTo(conBase(0.82) ?? 0, 6);
    expect(conBase(0.9)).toBeCloseTo(conBase(0.82) ?? 0, 6);
  });

  it('cuando las bases difieren, lo que manda es la razon entre los dos factores', () => {
    const conFactores = (sinComunes: number, conComunes: number) => {
      const config = configDeTest();
      config.coeficientes.superficie.factor_construida_a_util.valor = sinComunes;
      config.coeficientes.superficie.factor_construida_con_comunes_a_util.valor = conComunes;
      return (
        correrT1({
          config,
          property: propiedadBase({ superficie: { tipo: 'construida_con_comunes', m2: 85 } }),
          market: mercadoBase({
            precio_m2: { ...mercadoBase().precio_m2, base_superficie: 'construida' },
          }),
        }).techo.valor?.valor ?? 0
      );
    };

    // Misma razon 0,76/0,82, valores absolutos distintos: mismo resultado salvo
    // unos euros. La diferencia es el redondeo de los m2 utiles a dos decimales,
    // que es deliberado: el TrazedValue de la superficie tiene que ser
    // exactamente el numero con el que se ha calculado, no una version limpia
    // de otro. Sobre 80.000 EUR son 3 EUR, un 0,003%.
    const a = conFactores(0.82, 0.76);
    const b = conFactores(0.9, 0.9 * (0.76 / 0.82));
    expect(Math.abs(a - b)).toBeLessThan(5);
    // Razon distinta: resultado distinto.
    expect(conFactores(0.82, 0.7)).toBeLessThan(conFactores(0.82, 0.8));
  });

  it('avisa cuando las bases de superficie no coinciden', () => {
    const r = correrT1({
      property: propiedadBase({ superficie: { tipo: 'construida_con_comunes', m2: 85 } }),
      market: mercadoBase({
        precio_m2: { ...mercadoBase().precio_m2, base_superficie: 'construida' },
      }),
    });
    expect(codigos(r.techo.avisos)).toContain('CONVERSION_SUPERFICIE_ASIMETRICA');
  });

  it('no avisa cuando coinciden', () => {
    const r = correrT1({
      property: propiedadBase({ superficie: { tipo: 'construida', m2: 85 } }),
      market: mercadoBase({
        precio_m2: { ...mercadoBase().precio_m2, base_superficie: 'construida' },
      }),
    });
    expect(codigos(r.techo.avisos)).not.toContain('CONVERSION_SUPERFICIE_ASIMETRICA');
  });

  it('actualiza el precio base con la variacion del IPV', () => {
    const r = correrT1({
      market: mercadoBase({
        ipv: {
          ccaa: 'Comunitat Valenciana',
          variacion_acumulada: 0.05,
          desde: '2026-06-30',
          hasta: '2026-08-22',
          fuente: 'INE',
          id_tabla_ine: '00000',
        },
      }),
    });
    expect(r.eurM2Homogeneizado).toBeCloseTo(1400 * 1.05 * 0.7252, 2);
  });

  it('avisa cuando no hay IPV con el que actualizar', () => {
    expect(codigos(correrT1().techo.avisos)).toContain('SIN_ACTUALIZACION_IPV');
  });

  it('penaliza la falta de ascensor de forma progresiva por planta', () => {
    const tercera = correrT1({
      property: propiedadBase({ ascensor: false, planta: { numero: 3, es_atico: false, es_bajo: false } }),
    });
    const quinta = correrT1({
      property: propiedadBase({ ascensor: false, planta: { numero: 5, es_atico: false, es_bajo: false } }),
    });
    expect(quinta.eurM2Homogeneizado).toBeLessThan(tercera.eurM2Homogeneizado);
  });

  it('no aplica coeficiente de ascensor cuando el edificio lo tiene', () => {
    const nombres = correrT1().coeficientes.map((c) => c.nombre);
    expect(nombres.some((n) => n.includes('sin ascensor'))).toBe(false);
  });
});

describe('T1 - depreciacion por antiguedad', () => {
  it('en modo absoluto deprecia contra obra nueva y avisa del doble conteo', () => {
    const r = correrT1();
    const antiguedad = r.coeficientes.find((c) => c.nombre === 'antiguedad');
    expect(antiguedad?.valor).toBeCloseTo(0.74, 6);
    expect(codigos(r.techo.avisos)).toContain('ANTIGUEDAD_ABSOLUTA');
  });

  it('con edad de referencia de la zona, un inmueble de la edad media no se penaliza', () => {
    const config = configDeTest();
    config.coeficientes.antiguedad.edad_referencia_zona_anios.valor = 26;

    const r = correrT1({ config });
    const antiguedad = r.coeficientes.find((c) => c.nombre === 'antiguedad');

    // El piso tiene exactamente la edad de referencia: coeficiente neutro.
    expect(antiguedad?.valor).toBeCloseTo(1, 6);
    expect(codigos(r.techo.avisos)).not.toContain('ANTIGUEDAD_ABSOLUTA');
  });

  it('avisa cuando el piso es mucho mas nuevo que la zona y ese premio no tiene tope', () => {
    const config = configDeTest();
    // Parque viejo frente a un piso de 26 anos: el coeficiente se va por encima
    // de 1. Es coherente con el modelo relativo, pero nada lo limita.
    config.coeficientes.antiguedad.edad_referencia_zona_anios.valor = 60;

    const r = correrT1({ config });
    const antiguedad = r.coeficientes.find((c) => c.nombre === 'antiguedad');

    // (1 - 26/100) / (1 - 60/100) = 1,85
    expect(antiguedad?.valor).toBeCloseTo(1.85, 6);
    expect(codigos(r.techo.avisos)).toContain('ANTIGUEDAD_PREMIO_SIN_TOPE');
  });

  it('topa el premio cuando se fija coeficiente_maximo, y lo dice', () => {
    const config = configDeTest();
    config.coeficientes.antiguedad.edad_referencia_zona_anios.valor = 60;
    config.coeficientes.antiguedad.coeficiente_maximo = {
      min: 1.05,
      max: 1.25,
      sugerido: 1.15,
      valor: 1.15,
    };

    const r = correrT1({ config });
    expect(r.coeficientes.find((c) => c.nombre === 'antiguedad')?.valor).toBeCloseTo(1.15, 6);
    expect(codigos(r.techo.avisos)).toContain('ANTIGUEDAD_PREMIO_TOPADO');
    expect(codigos(r.techo.avisos)).not.toContain('ANTIGUEDAD_PREMIO_SIN_TOPE');
  });

  it('sin coeficiente_maximo el resultado no cambia: el tope es opcional', () => {
    const config = configDeTest();
    config.coeficientes.antiguedad.edad_referencia_zona_anios.valor = 60;
    const sinCampo = correrT1({ config });

    const config2 = configDeTest();
    config2.coeficientes.antiguedad.edad_referencia_zona_anios.valor = 60;
    config2.coeficientes.antiguedad.coeficiente_maximo = {
      min: 1.05,
      max: 1.25,
      sugerido: 1.15,
      valor: null,
    };
    const conCampoANull = correrT1({ config: config2 });

    expect(conCampoANull.techo.valor?.valor).toBe(sinCampo.techo.valor?.valor);
  });

  it('el dato de mercado del parque manda sobre el respaldo de config', () => {
    const config = configDeTest();
    config.coeficientes.antiguedad.edad_referencia_zona_anios.valor = 0;

    const r = correrT1({
      config,
      market: mercadoBase({
        antiguedad_parque: {
          edad_media_anios: 26,
          ambito: 'municipio',
          fuente: 'Catastro INSPIRE (test)',
          fuente_url: null,
          fecha_dato: '2026-02-21',
          n_viviendas: 86887,
        },
      }),
    });

    // El piso tiene 26 anos y el parque tambien: coeficiente neutro, pese a que
    // la config diga 0. Y sin el aviso de depreciacion absoluta.
    expect(r.coeficientes.find((c) => c.nombre === 'antiguedad')?.valor).toBeCloseTo(1, 6);
    expect(codigos(r.techo.avisos)).not.toContain('ANTIGUEDAD_ABSOLUTA');
  });

  it('cita la fuente del parque en la explicacion del coeficiente', () => {
    const r = correrT1({
      market: mercadoBase({
        antiguedad_parque: {
          edad_media_anios: 44.79,
          ambito: 'municipio',
          fuente: 'Catastro INSPIRE (test)',
          fuente_url: null,
          fecha_dato: '2026-02-21',
          n_viviendas: 86887,
        },
      }),
    });
    const antiguedad = r.coeficientes.find((c) => c.nombre === 'antiguedad');
    expect(antiguedad?.explicacion).toContain('Catastro INSPIRE');
    // edad 26 sobre vida 100, relativo a un parque de 44,79
    expect(antiguedad?.valor).toBeCloseTo((1 - 0.26) / (1 - 0.4479), 6);
  });

  it('penaliza de mas a un edificio anterior a 1980 sin rehabilitar', () => {
    const r = correrT1({ property: propiedadBase({ anio_construccion: 1975 }) });
    const antiguedad = r.coeficientes.find((c) => c.nombre === 'antiguedad');

    // edad 51 -> residual 0,49, por debajo del minimo 0,6, luego x 0,95
    expect(antiguedad?.valor).toBeCloseTo(0.6 * 0.95, 6);
    expect(codigos(r.techo.avisos)).toContain('INSTALACIONES_ANTERIORES_A_NORMA');
  });

  it('una rehabilitacion integral evita la penalizacion por instalaciones', () => {
    const r = correrT1({
      property: propiedadBase({ anio_construccion: 1975, anio_rehabilitacion: 2020 }),
    });
    expect(codigos(r.techo.avisos)).not.toContain('INSTALACIONES_ANTERIORES_A_NORMA');
  });

  it('avisa si no hay ano de construccion y no inventa depreciacion', () => {
    const r = correrT1({ property: propiedadBase({ anio_construccion: null }) });
    expect(r.coeficientes.find((c) => c.nombre === 'antiguedad')).toBeUndefined();
    expect(codigos(r.techo.avisos)).toContain('SIN_ANIO_CONSTRUCCION');
  });
});

describe('T1 - confianza', () => {
  it('es alta con dato de codigo postal, muestra amplia y superficie util declarada', () => {
    expect(correrT1().confianza).toBe('alta');
  });

  it('baja a media con fallback municipal', () => {
    const r = correrT1({
      market: mercadoBase({ precio_m2: { ...mercadoBase().precio_m2, ambito: 'municipio' } }),
    });
    expect(r.confianza).toBe('media');
    expect(codigos(r.techo.avisos)).toContain('FALLBACK_MUNICIPAL');
  });

  it('baja a baja con fallback provincial', () => {
    const r = correrT1({
      market: mercadoBase({ precio_m2: { ...mercadoBase().precio_m2, ambito: 'provincia' } }),
    });
    expect(r.confianza).toBe('baja');
    expect(codigos(r.techo.avisos)).toContain('FALLBACK_PROVINCIAL');
  });

  it('baja con pocas transacciones en la muestra', () => {
    const r = correrT1({
      market: mercadoBase({ precio_m2: { ...mercadoBase().precio_m2, n_transacciones: 3 } }),
    });
    expect(r.confianza).toBe('baja');
    expect(codigos(r.techo.avisos)).toContain('POCAS_TRANSACCIONES');
  });

  it('baja a media si la superficie util esta estimada', () => {
    const r = correrT1({ property: propiedadBase({ superficie: { tipo: 'construida', m2: 85 } }) });
    expect(r.confianza).toBe('media');
  });

  it('avisa si el dato de mercado esta desfasado', () => {
    const r = correrT1({
      market: mercadoBase({ precio_m2: { ...mercadoBase().precio_m2, fecha_dato: '2024-01-31' } }),
    });
    expect(codigos(r.techo.avisos)).toContain('DATO_DESFASADO');
  });
});

describe('T1 - topes y anexos', () => {
  it('topa el producto de coeficientes y avisa cuando lo hace', () => {
    const r = correrT1({
      property: propiedadBase({
        estado_conservacion: 'a_reformar',
        ascensor: false,
        planta: { numero: 5, es_atico: false, es_bajo: false },
        situacion: 'interior',
        orientacion: 'norte',
        certificado_energetico: { estado: 'registrado', letra_consumo: 'G' },
        anio_construccion: 1965,
      }),
    });
    expect(codigos(r.techo.avisos)).toContain('COEFICIENTE_GLOBAL_TOPADO');
    // 0,6 es el tope minimo del fixture
    expect(r.eurM2Homogeneizado).toBeCloseTo(1400 * 0.6, 2);
  });

  it('suma los anexos en valor absoluto, no como coeficiente', () => {
    const r = correrT1({
      property: propiedadBase({ anexos: { plazas_garaje: 1, trasteros: 1, terraza_m2: 12 } }),
      market: mercadoBase({
        anexos: {
          garaje_eur: 12000,
          trastero_eur: 4000,
          terraza_eur_m2: 300,
          fuente: 'test',
          fecha_dato: '2026-06-30',
        },
      }),
    });
    // 71.069,60 de vivienda + 12.000 + 4.000 + 12 x 300
    expect(r.techo.valor?.valor).toBeCloseTo(71069.6 + 12000 + 4000 + 3600, 2);
  });

  it('no computa una terraza por debajo del umbral configurado', () => {
    const r = correrT1({
      property: propiedadBase({ anexos: { plazas_garaje: 0, trasteros: 0, terraza_m2: 5 } }),
      market: mercadoBase({
        anexos: {
          garaje_eur: 12000,
          trastero_eur: 4000,
          terraza_eur_m2: 300,
          fuente: 'test',
          fecha_dato: '2026-06-30',
        },
      }),
    });
    expect(r.techo.valor?.valor).toBeCloseTo(71069.6, 2);
  });

  it('avisa si hay anexos pero no hay precios con los que valorarlos', () => {
    const r = correrT1({
      property: propiedadBase({ anexos: { plazas_garaje: 1, trasteros: 0, terraza_m2: 0 } }),
    });
    expect(codigos(r.techo.avisos)).toContain('ANEXOS_SIN_VALORAR');
  });
});
