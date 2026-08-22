import { describe, expect, it } from 'vitest';

import { calcularPrecioMaximo } from '../src/index';
import type { CalcInput, MaxPriceResult } from '../src/types';
import { configDeTest } from './fixtures/config';

/**
 * Criterio de aceptacion de la Fase 1 (PROMPT.md, seccion 8).
 *
 *   Piso en Castellon, CP 12100 (El Grao). 85 m2 construidos, sin dato de
 *   utiles. Planta 3a sin ascensor. Edificio de 1978. Estado: a reformar.
 *   Certificado energetico G. Precio pedido: 135.000 EUR. Derrama aprobada de
 *   4.000 EUR para fachada. Comprador de 27 anos, primera vivienda habitual,
 *   45.000 EUR de ahorro, 2.100 EUR/mes netos.
 *
 * Los datos de mercado son de TEST, no reales: en la Fase 1 entran a mano y los
 * adaptadores llegan en las Fases 2 y 3. Por eso las comprobaciones son de
 * estructura, de trazabilidad y de coherencia interna, y solo se fijan cifras
 * exactas donde se pueden derivar a mano desde el fixture.
 */

const EUR_M2_ZONA_TEST = 1450; // EUR/m2 CONSTRUIDO. Valor de test, no dato real.

function casoDelGrao(): CalcInput {
  const config = configDeTest();

  // Calibracion de zona: El Grao es un barrio de parque envejecido, asi que la
  // edad de referencia no es cero. Ver el ultimo bloque de este fichero para
  // que pasa si se deja la config recien sembrada.
  config.coeficientes.antiguedad.edad_referencia_zona_anios.valor = 40;
  config.coeficientes.limites.coeficiente_global_min.valor = 0.5;

  return {
    fecha_calculo: '2026-08-22',
    config,
    property: {
      referencia_catastral: null,
      localizacion: {
        codigo_postal: '12100',
        municipio_ine: '12040',
        municipio_nombre: 'Castello de la Plana',
        provincia: 'Castellon',
        ccaa: 'Comunitat Valenciana',
      },
      superficie: { tipo: 'construida', m2: 85 },
      superficie_construida_con_comunes_m2: null,
      planta: { numero: 3, es_atico: false, es_bajo: false },
      ascensor: false,
      situacion: 'exterior',
      orientacion: 'desconocida',
      anio_construccion: 1978,
      anio_rehabilitacion: null,
      estado_conservacion: 'a_reformar',
      certificado_energetico: { estado: 'registrado', letra_consumo: 'G' },
      anexos: { plazas_garaje: 0, trasteros: 0, terraza_m2: 0 },
      habitaciones: 3,
      banos: 1,
      precio_pedido: 135000,
      dias_publicado: 120,
      valor_referencia_catastral: 120000,
      valor_catastral: 45000,
      es_obra_nueva: false,
      tiene_division_horizontal: true,
      es_vpo: false,
    },
    riesgos: {
      derramas_aprobadas_eur: 4000,
      ite: 'no_aplica',
      cargas_registrales_eur: 0,
      fibrocemento_en_cubierta: false,
      zona_inundable: 'no',
      suelo_contaminado: false,
      afeccion_urbanistica: false,
      metros_fachada_edificio: null,
    },
    buyer: {
      edad: 27,
      primera_vivienda_habitual: true,
      sera_vivienda_habitual: true,
      familia_numerosa: 'no',
      tributacion_irpf: 'individual',
      discapacidad_reconocida: false,
      base_imponible_irpf_anual: 28000,
      ahorro_disponible: 45000,
      ingresos_netos_mensuales: 2100,
      deudas_mensuales_actuales: 0,
      hipoteca: {
        ltv_max: 0.8,
        plazo_anios: 30,
        tipo: 'fijo',
        tin_anual: 0.03,
        diferencial: null,
        euribor_actual: null,
      },
      objetivo: 'residencia',
    },
    market: {
      precio_m2: {
        eur_m2: EUR_M2_ZONA_TEST,
        ambito: 'codigo_postal',
        fuente: 'Notariado CP 12100 (dato de TEST)',
        fuente_url: null,
        fecha_dato: '2026-06-30',
        n_transacciones: 34,
        p25: 1250,
        p75: 1680,
        base_superficie: 'construida',
      },
      ipv: null,
      anexos: null,
      superficie_p90_zona_m2: null,
      antiguedad_parque: null,
      alquiler: null,
      arv_eur_m2: null,
    },
    reforma: {
      nivel: 'reforma_parcial',
      partidas_singulares: [],
      hay_proyecto_cerrado: false,
      destinatario_particular: true,
      coste_materiales_pct: null,
    },
    // Residencia habitual: no hay operacion de inversion que valorar.
    inversion: null,
  };
}

function codigos(avisos: readonly { codigo: string }[]): string[] {
  return avisos.map((a) => a.codigo);
}

describe('caso de aceptacion: piso del Grao, Castellon', () => {
  const resultado: MaxPriceResult = calcularPrecioMaximo(casoDelGrao());

  it('calcula los cuatro techos y los deja visibles por separado', () => {
    expect(Object.keys(resultado.techos).sort()).toEqual(['T1', 'T2', 'T3', 'T4']);

    expect(resultado.techos.T1.valor).not.toBeNull();
    expect(resultado.techos.T2.valor).not.toBeNull();
    expect(resultado.techos.T3.valor).not.toBeNull();

    // T4 no aplica en residencia habitual, y lo dice.
    expect(resultado.techos.T4.aplica).toBe(false);
    expect(resultado.techos.T4.motivo_no_aplica).toContain('inversor');
  });

  it('deriva el techo de mercado paso a paso desde el dato de zona', () => {
    // 85 m2 construidos x 0,82 = 69,7 m2 utiles
    // 1.450 / 0,82 = 1.768,29 EUR/m2 util
    // coeficientes: 0,82 (a reformar) x 1,00 (planta 3 intermedia) x 0,90 (sin
    //   ascensor en 3a) x 1,00 x 1,00 x 0,93 (CEE G) x 0,8233 (antiguedad) = 0,565087
    const producto = 0.82 * 1.0 * 0.9 * 1.0 * 1.0 * 0.93 * ((1 - 0.48) / (1 - 0.4)) * 0.95;
    const eurM2Util = EUR_M2_ZONA_TEST / 0.82;

    const t1 = resultado.techos.T1.valor?.valor ?? 0;
    expect(t1).toBeCloseTo(eurM2Util * producto * 69.7, 1);
  });

  it('identifica el minimo y dice cual es y por que', () => {
    const valores = (['T1', 'T2', 'T3'] as const).map((id) => resultado.techos[id].valor?.valor ?? 0);
    const menor = Math.min(...valores);

    expect(resultado.techo_limitante).not.toBeNull();
    expect(resultado.minimo_techos?.valor).toBeCloseTo(menor, 2);
    expect(resultado.minimo_techos?.metodo).toContain('minimo de los techos');

    const limitante = resultado.techos[resultado.techo_limitante!];
    expect(limitante.valor?.valor).toBeCloseTo(menor, 2);
  });

  it('aplica el descuento de la derrama aprobada', () => {
    const derrama = resultado.descuentos_riesgo.find((d) => d.codigo === 'DERRAMA_APROBADA');
    expect(derrama?.importe.valor).toBe(4000);
    expect(derrama?.importe.fuente).toContain('acta');

    // precio maximo = minimo de los techos - descuentos
    expect(resultado.precio_maximo?.valor).toBeCloseTo((resultado.minimo_techos?.valor ?? 0) - 4000, 2);
  });

  it('avisa de que la superficie util es estimada y degrada la confianza', () => {
    expect(codigos(resultado.avisos)).toContain('SUPERFICIE_ESTIMADA');
    expect(resultado.confianza_global).not.toBe('alta');
  });

  it('avisa de que el valor de referencia catastral manda sobre el precio', () => {
    expect(codigos(resultado.avisos)).toContain('VALOR_REFERENCIA_MANDA');

    const avisoVref = resultado.avisos.find((a) => a.codigo === 'VALOR_REFERENCIA_MANDA');
    expect(avisoVref?.nivel).toBe('critico');
    expect(avisoVref?.referencia_legal).toContain('Ley 11/2021');

    // El aviso se refiere al precio que se va a ofrecer, no al techo de T2:
    // es al precio final donde el comprador nota el sobrecoste fiscal.
    const maximo = resultado.precio_maximo?.valor ?? 0;
    expect(avisoVref?.detalle).toContain(maximo.toFixed(0));
    expect(avisoVref?.detalle).toContain((120000 - maximo).toFixed(0));

    // Y solo hay uno: dos mensajes con el mismo codigo y cifras distintas confunden.
    expect(codigos(resultado.avisos).filter((c) => c === 'VALOR_REFERENCIA_MANDA')).toHaveLength(1);
  });

  it('avisa de las instalaciones de un edificio de 1978 sin rehabilitar', () => {
    expect(codigos(resultado.avisos)).toContain('INSTALACIONES_ANTERIORES_A_NORMA');
  });

  it('aplica el tipo reducido de ITP por comprador joven', () => {
    const linea = resultado.techos.T2.desglose.find((l) => l.concepto.includes('Impuesto'));
    expect(linea?.valor.fuente).toContain('Jovenes');
  });

  it('da precio maximo y precio de entrada en negociacion', () => {
    const maximo = resultado.precio_maximo?.valor ?? 0;
    expect(maximo).toBeGreaterThan(0);

    const entrada = resultado.precio_entrada_negociacion;
    expect(entrada?.min).toBe(Math.round(maximo * 0.88));
    expect(entrada?.max).toBe(Math.round(maximo * 0.92));
    expect(entrada?.min).toBeLessThan(maximo);
  });

  it('compara con el precio pedido y da veredicto', () => {
    const comparativa = resultado.comparativa_precio_pedido;
    expect(comparativa?.precio_pedido).toBe(135000);
    expect(comparativa?.diferencia_eur).toBeCloseTo(135000 - (resultado.precio_maximo?.valor ?? 0), 2);
    expect(['por_debajo_de_mercado', 'en_precio', 'sobrevalorado']).toContain(comparativa?.veredicto);
  });

  it('devuelve un argumentario y todo lo que lo respalda cita fuente y fecha', () => {
    expect(resultado.argumentario.length).toBeGreaterThan(0);

    for (const punto of resultado.argumentario) {
      expect(punto.titular.length).toBeGreaterThan(0);
      expect(punto.detalle.length).toBeGreaterThan(0);

      for (const respaldo of punto.respaldo) {
        expect(respaldo.fuente).toBeTruthy();
        expect(respaldo.fecha_dato).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(respaldo.metodo).toBeTruthy();
      }
    }
  });

  it('menciona la derrama y la falta de ascensor como argumentos de negociacion', () => {
    const titulares = resultado.argumentario.map((p) => p.titular.toLowerCase()).join(' | ');
    expect(titulares).toContain('derrama');
    expect(titulares).toContain('ascensor');
  });

  it('estampa version de motor, de config y disclaimer', () => {
    expect(resultado.version_motor).toMatch(/^\d+\.\d+\.\d+/);
    expect(resultado.version_config).toBe('test');
    expect(resultado.fecha_calculo).toBe('2026-08-22');
    expect(resultado.disclaimer).toContain('No constituye tasacion oficial');
  });

  it('ordena los avisos con lo critico primero', () => {
    const niveles = resultado.avisos.map((a) => a.nivel);
    const peso = { critico: 0, atencion: 1, info: 2 } as const;
    for (let i = 1; i < niveles.length; i += 1) {
      expect(peso[niveles[i]!]).toBeGreaterThanOrEqual(peso[niveles[i - 1]!]);
    }
  });

  it('no devuelve ningun numero sin trazabilidad', () => {
    const trazados = [
      resultado.precio_maximo,
      resultado.minimo_techos,
      ...(['T1', 'T2', 'T3'] as const).map((id) => resultado.techos[id].valor),
    ];

    for (const t of trazados) {
      expect(t).not.toBeNull();
      expect(t!.fuente).toBeTruthy();
      expect(t!.fecha_dato).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(t!.metodo).toBeTruthy();
      expect(['alta', 'media', 'baja']).toContain(t!.confianza);
    }
  });
});

describe('el mismo caso con la config recien sembrada', () => {
  /**
   * Con los valores que deja `config:seed` (depreciacion absoluta y tope minimo
   * global de 0,60), este piso apila tantos coeficientes a la baja que el
   * producto se sale por debajo del tope. El motor lo detecta y avisa: es la
   * senal de que los coeficientes necesitan calibrarse con el mercado local
   * antes de fiarse del numero.
   */
  it('salta el aviso de coeficiente topado', () => {
    const caso = casoDelGrao();
    caso.config.coeficientes.antiguedad.edad_referencia_zona_anios.valor = 0;
    caso.config.coeficientes.limites.coeficiente_global_min.valor = 0.6;

    const resultado = calcularPrecioMaximo(caso);
    expect(codigos(resultado.avisos)).toContain('COEFICIENTE_GLOBAL_TOPADO');
    expect(codigos(resultado.avisos)).toContain('ANTIGUEDAD_ABSOLUTA');
  });
});
