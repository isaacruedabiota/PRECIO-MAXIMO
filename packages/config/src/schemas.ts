import { z } from 'zod';

/**
 * Esquemas de la configuracion de negocio.
 *
 * Los objetos son "loose" a proposito: los ficheros JSON llevan claves _doc con
 * la explicacion de cada bloque y no queremos que la validacion las tire.
 */

/**
 * Un numero de negocio configurable.
 *
 * - min / max: horquilla razonable, para validar y para los sliders de la UI.
 * - sugerido: la semilla del brief. Sirve como punto de partida, NO se usa en el calculo.
 * - valor:    lo unico que lee el motor. null = sin fijar -> MissingConfigError.
 *
 * La separacion sugerido/valor es deliberada. Si el motor cayese al sugerido
 * cuando valor es null, la herramienta devolveria numeros con pinta de fiables
 * que en realidad no ha validado nadie. Es justo lo que hay que evitar.
 */
export const valorConfigurableSchema = z.looseObject({
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  sugerido: z.number().nullable().optional(),
  valor: z.number().nullable(),
});

export type ValorConfigurable = z.infer<typeof valorConfigurableSchema>;

const vc = valorConfigurableSchema;

// ---------------------------------------------------------------------------
// itp.json
// ---------------------------------------------------------------------------

/**
 * Limite de renta de una bonificacion. La normativa suele dar dos cifras segun
 * el regimen de declaracion, y usar la que no toca decide mal la bonificacion.
 */
export const limiteRentaSchema = z.looseObject({
  individual: z.number().nullable(),
  conjunta: z.number().nullable(),
});

export const tipoReducidoSchema = z.looseObject({
  codigo: z.string(),
  nombre: z.string(),
  tipo: z.number().nullable(),
  condiciones: z.array(z.string()),
  /** Edad maxima para las modalidades de joven. Varia por CCAA: no se supone. */
  limite_edad: z.number().nullable(),
  limite_base_imponible_irpf: limiteRentaSchema.nullable(),
  /** Aplica si el valor del inmueble NO excede de este importe. */
  limite_valor_inmueble: z.number().nullable(),
  /**
   * Aplica si el valor del inmueble EXCEDE de este importe. Las normativas
   * autonomicas suelen partir la misma bonificacion en dos tramos por valor, y
   * sin este campo el motor elegiria siempre el tipo mas bajo de los dos.
   */
  valor_inmueble_desde: z.number().nullable(),
  /** Referencia legal exacta, para poder citarla en el informe. */
  articulo: z.string().nullable(),
  fuente_url: z.string(),
  verificado: z.boolean(),
});

/**
 * Tramo de tipo general por valor del inmueble.
 *
 * OJO: no es una escala progresiva. El tipo del tramo se aplica al total de la
 * base imponible, no solo a la parte que cae dentro del tramo.
 */
export const tramoTipoSchema = z.looseObject({
  desde: z.number(),
  hasta: z.number().nullable(),
  tipo: z.number(),
});

export const itpCcaaSchema = z.looseObject({
  ccaa: z.string(),
  tipo_general: z.looseObject({
    tramos: z.array(tramoTipoSchema),
    articulo: z.string().nullable(),
  }),
  tipo_ajd_obra_nueva: z.number().nullable(),
  tipos_reducidos: z.array(tipoReducidoSchema),
  vigencia_desde: z.string().nullable(),
  fuente_url: z.string(),
  verificado: z.boolean(),
});

export const itpConfigSchema = z.looseObject({
  version: z.string(),
  ccaa: z.array(itpCcaaSchema),
  obra_nueva: z.looseObject({
    iva_vivienda: z.number().nullable(),
    iva_vpo_regimen_especial: z.number().nullable(),
    verificado: z.boolean(),
  }),
});

// ---------------------------------------------------------------------------
// aranceles.json
// ---------------------------------------------------------------------------

/** Tramo de un arancel escalado: sobre la parte de base entre desde y hasta. */
export const tramoArancelSchema = z.looseObject({
  desde: z.number(),
  hasta: z.number().nullable(),
  tipo: z.number(),
});

export const arancelEscaladoSchema = z.looseObject({
  tramos: z.array(tramoArancelSchema),
  cuota_fija_base: z.number().nullable(),
  iva_aplicable: z.number().nullable(),
  /** Rebaja sobre los derechos resultantes de la escala, en tanto por uno. */
  rebaja: z.number().nullable(),
  /** Topes globales del arancel, antes de rebaja e IVA. null si no los hay. */
  minimo_eur: z.number().nullable(),
  maximo_eur: z.number().nullable(),
  articulo: z.string().nullable(),
  fuente_url: z.string(),
  vigencia_desde: z.string().nullable(),
  verificado: z.boolean(),
});

export const arancelesConfigSchema = z.looseObject({
  version: z.string(),
  notaria: arancelEscaladoSchema.extend({ suplidos_y_copias: vc }),
  registro: arancelEscaladoSchema,
  gestoria: vc,
  tasacion: vc,
  nota_simple: vc,
  gastos_hipoteca_a_cargo_del_comprador: z.looseObject({
    aplica: z.boolean().nullable(),
    verificado: z.boolean(),
  }),
});

// ---------------------------------------------------------------------------
// coeficientes.json
// ---------------------------------------------------------------------------

export const coeficientesConfigSchema = z.looseObject({
  version: z.string(),
  verificado: z.boolean(),
  superficie: z.looseObject({
    factor_construida_a_util: vc,
    factor_construida_con_comunes_a_util: vc,
    atipica_sobre_p90: vc,
  }),
  anexos: z.looseObject({
    terraza_m2_minima_computable: vc,
  }),
  estado_conservacion: z.looseObject({
    a_reformar: vc,
    buen_estado: vc,
    reformado_reciente: vc,
  }),
  planta: z.looseObject({
    bajo: vc,
    primera_segunda: vc,
    intermedia: vc,
    atico: vc,
  }),
  sin_ascensor: z.looseObject({
    planta_0_2: vc,
    planta_3: vc,
    planta_4: vc,
    planta_5_o_mas: vc,
  }),
  situacion: z.looseObject({ exterior: vc, interior: vc }),
  orientacion: z.looseObject({
    norte: vc,
    sur: vc,
    este: vc,
    oeste: vc,
    noreste: vc,
    noroeste: vc,
    sureste: vc,
    suroeste: vc,
    desconocida: vc,
  }),
  certificado_energetico: z.looseObject({
    A: vc, B: vc, C: vc, D: vc, E: vc, F: vc, G: vc,
    no_disponible: vc,
  }),
  antiguedad: z.looseObject({
    vida_util_total_anios: vc,
    metodo: z.string(),
    edad_referencia_zona_anios: vc,
    coeficiente_minimo: vc,
    penalizacion_extra_pre_1980_sin_rehabilitar: vc,
    anio_corte_instalaciones: z.number(),
  }),
  limites: z.looseObject({
    coeficiente_global_min: vc,
    coeficiente_global_max: vc,
  }),
  confianza: z.looseObject({
    min_transacciones_confianza_alta: z.number(),
    degradar_si_fallback_municipal: z.enum(['alta', 'media', 'baja']),
    degradar_si_fallback_provincial: z.enum(['alta', 'media', 'baja']),
    degradar_si_superficie_estimada: z.enum(['alta', 'media', 'baja']),
    meses_antiguedad_dato_para_degradar: z.number(),
  }),
});

// ---------------------------------------------------------------------------
// reforma.json
// ---------------------------------------------------------------------------

export const reformaConfigSchema = z.looseObject({
  version: z.string(),
  modulos_eur_m2_util: z.looseObject({
    lavado_de_cara: vc,
    reforma_parcial: vc,
    reforma_integral: vc,
    integral_premium: vc,
  }),
  partidas_singulares_eur: z.record(z.string(), z.union([vc, z.string()])),
  imprevistos: z.looseObject({
    por_defecto: vc,
    edificio_antiguo_o_sin_proyecto: vc,
    anio_corte_edificio_antiguo: z.number(),
  }),
  iva: z.looseObject({
    tipo_reducido_rehabilitacion: z.number().nullable(),
    tipo_general: z.number().nullable(),
    antiguedad_minima_anios: vc,
    /**
     * Limite del coste de los materiales aportados por quien ejecuta la obra,
     * como fraccion de la base imponible de la operacion. Es la tercera
     * condicion del art. 91.Uno.2.10 LIVA.
     */
    limite_materiales_pct: z.number().nullable(),
    condiciones_tipo_reducido: z.array(z.string()),
    articulo: z.string().nullable(),
    verificado: z.boolean(),
  }),
  margen_seguridad: vc,
});

// ---------------------------------------------------------------------------
// hipoteca.json
// ---------------------------------------------------------------------------

export const hipotecaConfigSchema = z.looseObject({
  version: z.string(),
  ltv: z.looseObject({ max_por_defecto: vc, tope_absoluto: vc }),
  ratio_esfuerzo: z.looseObject({
    por_defecto: vc,
    maximo_permitido: vc,
    umbral_alerta_escenario_estres: vc,
  }),
  escenario_estres: z.looseObject({ incremento_euribor_pp: vc }),
  plazo: z.looseObject({
    anios_por_defecto: vc,
    anios_maximo: vc,
    edad_limite_vencimiento: vc,
  }),
  amortizacion: z.looseObject({ sistema: z.literal('frances') }),
  solver: z.looseObject({
    metodo: z.literal('biseccion'),
    precio_min_eur: z.number(),
    precio_max_eur: z.number(),
    tolerancia_eur: z.number(),
    max_iteraciones: z.number(),
  }),
});

// ---------------------------------------------------------------------------
// rentabilidad.json
// ---------------------------------------------------------------------------

export const rentabilidadConfigSchema = z.looseObject({
  version: z.string(),
  alquiler: z.looseObject({
    tasa_vacancia: vc,
    mantenimiento_pct_valor_anual: vc,
    gestion_autogestion: vc,
    gestion_agencia: vc,
    seguro_anual_eur: vc,
    rentabilidad_neta_objetivo: vc,
    irpf: z.looseObject({
      /** Reduccion por defecto: el caso residual del art. 23.2 LIRPF. */
      reduccion_general: z.number().nullable(),
      /** Reducciones superiores por caso, art. 23.2 letras a) a c). */
      reducciones_por_caso: z.looseObject({
        zona_tensionada_renta_rebajada: z.number().nullable(),
        zona_tensionada_inquilino_joven: z.number().nullable(),
        rehabilitada_ultimos_dos_anios: z.number().nullable(),
      }),
      tipo_marginal_estimado: z.number().nullable(),
      articulo: z.string().nullable(),
      verificado: z.boolean(),
    }),
    zona_tensionada: z.looseObject({
      aplicar_limite_indice: z.boolean(),
      verificado: z.boolean(),
    }),
  }),
  flipping: z.looseObject({
    factor_arv: vc,
    desglose_del_complementario: z.record(z.string(), z.union([vc, z.string()])),
    meses_operacion_estimados: vc,
  }),
  gastos_recurrentes: z.looseObject({
    ibi_pct_valor_catastral: vc,
    comunidad_mensual_eur: vc,
  }),
});

// ---------------------------------------------------------------------------
// riesgos.json
// ---------------------------------------------------------------------------

export const bloqueanteConfigSchema = z.looseObject({
  activo: z.boolean(),
  titulo: z.string(),
  detalle: z.string(),
  como_verificar: z.string(),
});

export const riesgosConfigSchema = z.looseObject({
  version: z.string(),
  descuentos: z.looseObject({
    derramas_aprobadas: z.looseObject({ modo: z.string() }),
    cargas_registrales: z.looseObject({ modo: z.string() }),
    ite_desfavorable: z.looseObject({ modo: z.string(), eur_por_m2_fachada: vc }),
    ite_no_pasada: z.looseObject({ modo: z.string(), eur_por_m2_fachada: vc }),
    fibrocemento: z.looseObject({ modo: z.string(), eur: vc }),
    zona_inundable: z.looseObject({ modo: z.string(), pct: vc }),
    suelo_contaminado: z.looseObject({ modo: z.string(), pct: vc }),
  }),
  bloqueantes: z.looseObject({
    sin_division_horizontal: bloqueanteConfigSchema,
    vpo_precio_maximo: bloqueanteConfigSchema,
    afeccion_urbanistica: bloqueanteConfigSchema,
  }),
});

// ---------------------------------------------------------------------------
// negociacion.json
// ---------------------------------------------------------------------------

export const negociacionConfigSchema = z.looseObject({
  version: z.string(),
  precio_entrada: z.looseObject({ factor_min: vc, factor_max: vc }),
  veredicto_precio_pedido: z.looseObject({
    umbral_por_debajo_de_mercado: vc,
    umbral_sobrevalorado: vc,
  }),
  disclaimer: z.looseObject({ texto: z.string() }),
});

// ---------------------------------------------------------------------------
// fuentes.json (informativo: lo consumen los adaptadores, no el motor)
// ---------------------------------------------------------------------------

export const fuentesConfigSchema = z.looseObject({ version: z.string() });

// ---------------------------------------------------------------------------
// Config completa
// ---------------------------------------------------------------------------

export type ItpConfig = z.infer<typeof itpConfigSchema>;
export type ItpCcaa = z.infer<typeof itpCcaaSchema>;
export type TipoReducido = z.infer<typeof tipoReducidoSchema>;
export type ArancelEscalado = z.infer<typeof arancelEscaladoSchema>;
export type TramoArancel = z.infer<typeof tramoArancelSchema>;
export type ArancelesConfig = z.infer<typeof arancelesConfigSchema>;
export type CoeficientesConfig = z.infer<typeof coeficientesConfigSchema>;
export type ReformaConfig = z.infer<typeof reformaConfigSchema>;
export type HipotecaConfig = z.infer<typeof hipotecaConfigSchema>;
export type RentabilidadConfig = z.infer<typeof rentabilidadConfigSchema>;
export type RiesgosConfig = z.infer<typeof riesgosConfigSchema>;
export type NegociacionConfig = z.infer<typeof negociacionConfigSchema>;
export type FuentesConfig = z.infer<typeof fuentesConfigSchema>;

/** Lo que recibe el motor. Sin I/O: se le pasa ya cargada y validada. */
export interface EngineConfig {
  itp: ItpConfig;
  aranceles: ArancelesConfig;
  coeficientes: CoeficientesConfig;
  reforma: ReformaConfig;
  hipoteca: HipotecaConfig;
  rentabilidad: RentabilidadConfig;
  riesgos: RiesgosConfig;
  negociacion: NegociacionConfig;
  /** Version agregada, para estampar en el resultado y poder reproducirlo. */
  version: string;
}

export const CONFIG_FILES = {
  itp: { archivo: 'itp.json', schema: itpConfigSchema },
  aranceles: { archivo: 'aranceles.json', schema: arancelesConfigSchema },
  coeficientes: { archivo: 'coeficientes.json', schema: coeficientesConfigSchema },
  reforma: { archivo: 'reforma.json', schema: reformaConfigSchema },
  hipoteca: { archivo: 'hipoteca.json', schema: hipotecaConfigSchema },
  rentabilidad: { archivo: 'rentabilidad.json', schema: rentabilidadConfigSchema },
  riesgos: { archivo: 'riesgos.json', schema: riesgosConfigSchema },
  negociacion: { archivo: 'negociacion.json', schema: negociacionConfigSchema },
  fuentes: { archivo: 'fuentes.json', schema: fuentesConfigSchema },
} as const;
