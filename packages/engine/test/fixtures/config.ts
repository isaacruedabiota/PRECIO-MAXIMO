import type { EngineConfig, ValorConfigurable } from '@vp/config/schemas';

/**
 * Config completa para tests.
 *
 * ================================ AVISO ==================================
 * TODOS los tipos impositivos de este fichero son INVENTADOS. No son los
 * tipos reales de ninguna comunidad autonoma ni de ningun arancel vigente.
 * Existen solo para que los tests tengan numeros redondos con los que
 * verificar la aritmetica del motor.
 *
 * Es a proposito que los tests traigan su propia config en lugar de leer
 * packages/config/data: un test que dependiera de la config real fallaria o
 * pasaria segun el estado de un JSON que se edita a mano, y dejaria de
 * comprobar lo unico que tiene que comprobar, que es el calculo.
 * =========================================================================
 */

export function v(valor: number | null, min?: number, max?: number): ValorConfigurable {
  return { min: min ?? null, max: max ?? null, sugerido: valor, valor };
}

export function configDeTest(): EngineConfig {
  return {
    version: 'test',

    itp: {
      version: 'test',
      ccaa: [
        {
          ccaa: 'Comunitat Valenciana',
          tipo_general: {
            // INVENTADOS: 10% hasta 500.000 y 12% por encima, para que los
            // tests puedan comprobar el salto de tramo con numeros redondos.
            tramos: [
              { desde: 0, hasta: 500000, tipo: 0.1 },
              { desde: 500000, hasta: null, tipo: 0.12 },
            ],
            articulo: 'test',
          },
          // INVENTADOS: 0,1% vivienda habitual, 1,5% el resto.
          tipo_ajd_obra_nueva: { vivienda_habitual: 0.001, general: 0.015, articulo: 'test' },
          tipos_reducidos: [
            {
              codigo: 'joven_primera_vivienda',
              nombre: 'Jovenes menores de 35, primera vivienda habitual',
              tipo: 0.06, // INVENTADO
              condiciones: ['edad < 35', 'vivienda habitual'],
              limite_edad: 35,
              limite_base_imponible_irpf: null,
              limite_valor_inmueble: null,
              valor_inmueble_desde: null,
              articulo: 'test',
              fuente_url: 'test',
              verificado: true,
            },
            {
              codigo: 'familia_numerosa',
              nombre: 'Familia numerosa',
              tipo: 0.04, // INVENTADO
              condiciones: ['familia numerosa'],
              limite_edad: null,
              limite_base_imponible_irpf: { individual: 45000, conjunta: 60000 },
              limite_valor_inmueble: null,
              valor_inmueble_desde: null,
              articulo: 'test',
              fuente_url: 'test',
              verificado: true,
            },
          ],
          vigencia_desde: '2020-01-01',
          fuente_url: 'test',
          verificado: true,
        },
      ],
      obra_nueva: {
        iva_vivienda: 0.1,
        iva_vpo_regimen_especial: 0.04,
        verificado: true,
      },
    },

    aranceles: {
      version: 'test',
      notaria: {
        // Tramos INVENTADOS, planos y facilmente verificables a mano.
        tramos: [
          { desde: 0, hasta: 100000, tipo: 0.003 },
          { desde: 100000, hasta: null, tipo: 0.001 },
        ],
        cuota_fija_base: 100,
        iva_aplicable: 0,
        // Sin rebaja ni topes, para que la aritmetica del test sea directa.
        rebaja: 0,
        minimo_eur: null,
        maximo_eur: null,
        suplidos_y_copias: v(0),
        articulo: 'test',
        fuente_url: 'test',
        vigencia_desde: '2020-01-01',
        verificado: true,
      },
      registro: {
        tramos: [
          { desde: 0, hasta: 100000, tipo: 0.002 },
          { desde: 100000, hasta: null, tipo: 0.0005 },
        ],
        cuota_fija_base: 50,
        iva_aplicable: 0,
        rebaja: 0,
        minimo_eur: null,
        maximo_eur: null,
        articulo: 'test',
        fuente_url: 'test',
        vigencia_desde: '2020-01-01',
        verificado: true,
      },
      gestoria: v(400),
      tasacion: v(450),
      nota_simple: v(15),
      gastos_hipoteca_a_cargo_del_comprador: { aplica: false, verificado: true },
    },

    coeficientes: {
      version: 'test',
      verificado: true,
      superficie: {
        factor_construida_a_util: v(0.82, 0.78, 0.92),
        factor_construida_con_comunes_a_util: v(0.76, 0.72, 0.8),
        atipica_sobre_p90: v(0.97, 0.95, 1),
      },
      anexos: { terraza_m2_minima_computable: v(8, 4, 12) },
      estado_conservacion: {
        a_reformar: v(0.82, 0.78, 0.85),
        buen_estado: v(1, 1, 1),
        reformado_reciente: v(1.11, 1.08, 1.15),
      },
      planta: {
        bajo: v(0.9),
        primera_segunda: v(0.98),
        intermedia: v(1),
        atico: v(1.06),
      },
      sin_ascensor: {
        planta_0_2: v(1),
        planta_3: v(0.9),
        planta_4: v(0.87),
        planta_5_o_mas: v(0.85),
      },
      situacion: { exterior: v(1), interior: v(0.92) },
      orientacion: {
        norte: v(0.97),
        sur: v(1.03),
        este: v(1),
        oeste: v(1),
        noreste: v(0.98),
        noroeste: v(0.98),
        sureste: v(1.02),
        suroeste: v(1.02),
        desconocida: v(1),
      },
      // Con horquilla declarada, como en la config real: el analisis de
      // sensibilidad la usa para saber entre que extremos mover cada valor.
      certificado_energetico: {
        A: v(1.05, 1.03, 1.05),
        B: v(1.03, 1.03, 1.05),
        C: v(1, 1, 1),
        D: v(1, 1, 1),
        E: v(0.98, 0.98, 0.98),
        F: v(0.97, 0.93, 0.97),
        G: v(0.93, 0.93, 0.97),
        no_disponible: v(1, 0.97, 1),
      },
      antiguedad: {
        vida_util_total_anios: v(100, 75, 100),
        metodo: 'lineal_sobre_vida_residual',
        edad_referencia_zona_anios: v(0, 0, 60),
        coeficiente_minimo: v(0.6, 0.5, 0.7),
        penalizacion_extra_pre_1980_sin_rehabilitar: v(0.95, 0.93, 0.98),
        anio_corte_instalaciones: 1980,
      },
      limites: {
        coeficiente_global_min: v(0.6, 0.5, 0.7),
        coeficiente_global_max: v(1.3, 1.2, 1.4),
      },
      confianza: {
        min_transacciones_confianza_alta: 15,
        degradar_si_fallback_municipal: 'media',
        degradar_si_fallback_provincial: 'baja',
        degradar_si_superficie_estimada: 'media',
        meses_antiguedad_dato_para_degradar: 12,
      },
    },

    reforma: {
      version: 'test',
      modulos_eur_m2_util: {
        lavado_de_cara: v(200, 150, 250),
        reforma_parcial: v(400, 300, 500),
        reforma_integral: v(800, 700, 900),
        integral_premium: v(1200, 1000, 1400),
      },
      partidas_singulares_eur: {
        sustitucion_bajante_comunitaria: v(3000),
        refuerzo_estructural: v(12000),
        retirada_fibrocemento: v(6000),
        instalacion_ascensor: v(25000),
        aerotermia: v(9000),
        rehabilitacion_fachada: v(15000),
      },
      imprevistos: {
        por_defecto: v(0.15),
        edificio_antiguo_o_sin_proyecto: v(0.25),
        anio_corte_edificio_antiguo: 1970,
      },
      iva: {
        tipo_reducido_rehabilitacion: 0.1, // INVENTADO
        tipo_general: 0.21, // INVENTADO
        antiguedad_minima_anios: v(2, 2, 2),
        limite_materiales_pct: 0.4,
        condiciones_tipo_reducido: ['test'],
        articulo: 'test',
        verificado: true,
      },
      margen_seguridad: v(0.1),
    },

    hipoteca: {
      version: 'test',
      ltv: { max_por_defecto: v(0.8), tope_absoluto: v(0.9) },
      ratio_esfuerzo: {
        por_defecto: v(0.3),
        maximo_permitido: v(0.35),
        umbral_alerta_escenario_estres: v(0.4),
      },
      escenario_estres: { incremento_euribor_pp: v(0.02) },
      plazo: {
        anios_por_defecto: v(30),
        anios_maximo: v(30),
        edad_limite_vencimiento: v(75),
      },
      amortizacion: { sistema: 'frances' },
      solver: {
        metodo: 'biseccion',
        precio_min_eur: 10000,
        precio_max_eur: 3000000,
        tolerancia_eur: 1,
        max_iteraciones: 200,
      },
    },

    rentabilidad: {
      version: 'test',
      alquiler: {
        tasa_vacancia: v(0.06),
        mantenimiento_pct_valor_anual: v(0.01),
        gestion_autogestion: v(0),
        gestion_agencia: v(0.08),
        seguro_anual_eur: v(250),
        rentabilidad_neta_objetivo: v(0.045),
        irpf: {
          reduccion_general: 0.5,
          reducciones_por_caso: {
            zona_tensionada_renta_rebajada: 0.9,
            zona_tensionada_inquilino_joven: 0.7,
            rehabilitada_ultimos_dos_anios: 0.6,
          },
          tipo_marginal_estimado: 0.3,
          articulo: 'test',
          verificado: true,
        },
        zona_tensionada: { aplicar_limite_indice: true, verificado: true },
      },
      flipping: {
        factor_arv: v(0.72),
        desglose_del_complementario: {
          gastos_compra: v(0.1),
          gastos_financieros: v(0.03),
          gastos_venta_y_comercializacion: v(0.04),
          impuestos_sobre_la_ganancia: v(0.05),
          margen_inversor: v(0.06),
        },
        meses_operacion_estimados: v(10),
      },
      gastos_recurrentes: {
        ibi_pct_valor_catastral: v(0.006),
        comunidad_mensual_eur: v(45),
      },
    },

    riesgos: {
      version: 'test',
      descuentos: {
        derramas_aprobadas: { modo: 'importe_usuario' },
        cargas_registrales: { modo: 'importe_usuario' },
        ite_desfavorable: { modo: 'estimacion_por_metro_fachada', eur_por_m2_fachada: v(120) },
        ite_no_pasada: { modo: 'estimacion_por_metro_fachada', eur_por_m2_fachada: v(60) },
        fibrocemento: { modo: 'importe_config', eur: v(6000) },
        zona_inundable: { modo: 'porcentaje_sobre_minimo_techos', pct: v(0.05) },
        suelo_contaminado: { modo: 'porcentaje_sobre_minimo_techos', pct: v(0.1) },
      },
      bloqueantes: {
        sin_division_horizontal: {
          activo: true,
          titulo: 'Sin division horizontal',
          detalle: 'No hay finca registral independiente.',
          como_verificar: 'Nota simple del Registro.',
        },
        vpo_precio_maximo: {
          activo: true,
          titulo: 'VPO con precio maximo vigente',
          detalle: 'El precio lo fija la administracion.',
          como_verificar: 'Consultar la calificacion.',
        },
        afeccion_urbanistica: {
          activo: true,
          titulo: 'Afeccion urbanistica',
          detalle: 'Puede impedir reformar o rehipotecar.',
          como_verificar: 'Cedula urbanistica.',
        },
      },
    },

    negociacion: {
      version: 'test',
      precio_entrada: { factor_min: v(0.88), factor_max: v(0.92) },
      veredicto_precio_pedido: {
        umbral_por_debajo_de_mercado: v(-0.05),
        umbral_sobrevalorado: v(0.05),
      },
      disclaimer: {
        texto:
          'Valoracion orientativa. No constituye tasacion oficial a efectos de la Orden ECO/805/2003 ' +
          'ni sustituye el asesoramiento profesional.',
      },
    },
  };
}
