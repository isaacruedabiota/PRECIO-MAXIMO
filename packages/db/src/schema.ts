import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Esquema de la base de datos.
 *
 * Principio rector: nada entra aqui sin quedar atado a una fila de fuentes_datos.
 * Un EUR/m2 sin procedencia no es un dato, es un rumor con decimales.
 */

// ---------------------------------------------------------------------------
// Tipos PostGIS
// ---------------------------------------------------------------------------

const point4326 = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(Point, 4326)',
});

const multipolygon4326 = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(MultiPolygon, 4326)',
});

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ambitoPrecioEnum = pgEnum('ambito_precio', ['codigo_postal', 'municipio', 'provincia']);
export const origenDatoEnum = pgEnum('origen_dato', ['api', 'descarga_batch', 'csv_manual', 'entrada_usuario']);

// ---------------------------------------------------------------------------
// Procedencia
// ---------------------------------------------------------------------------

/**
 * Columna vertebral de la trazabilidad. Cada ingesta deja una fila aqui y todos
 * los datos que trae apuntan a ella. Permite responder "de donde salio este
 * numero y cuando" para cualquier cifra del informe.
 */
export const fuentesDatos = pgTable(
  'fuentes_datos',
  {
    id: serial('id').primaryKey(),
    /** 'notariado' | 'mitma' | 'ine' | 'catastro' | 'serpavi' | ... */
    fuente: varchar('fuente', { length: 64 }).notNull(),
    origen: origenDatoEnum('origen').notNull(),
    url: text('url'),
    /** Periodo de referencia del dato: '2025Q4', '2025-06', etc. */
    periodo: varchar('periodo', { length: 16 }),
    descargadoEn: timestamp('descargado_en', { withTimezone: true }).notNull().defaultNow(),
    /** sha256 del fichero o de la respuesta, para detectar recargas identicas. */
    checksum: varchar('checksum', { length: 64 }),
    filasImportadas: integer('filas_importadas'),
    notas: text('notas'),
  },
  (t) => [index('idx_fuentes_fuente_periodo').on(t.fuente, t.periodo)],
);

// ---------------------------------------------------------------------------
// Geografia
// ---------------------------------------------------------------------------

export const municipios = pgTable(
  'municipios',
  {
    /** Codigo INE de 5 digitos: 2 de provincia + 3 de municipio. */
    codigoIne: varchar('codigo_ine', { length: 5 }).primaryKey(),
    nombre: text('nombre').notNull(),
    codigoProvincia: varchar('codigo_provincia', { length: 2 }).notNull(),
    provincia: text('provincia').notNull(),
    ccaa: text('ccaa').notNull(),
    poblacion: integer('poblacion'),
    /** MITMA solo publica dato municipal para municipios de mas de 25.000 hab. */
    tieneDatoMitmaMunicipal: boolean('tiene_dato_mitma_municipal').notNull().default(false),
    centroide: point4326('centroide'),
  },
  (t) => [
    index('idx_municipios_nombre').on(t.nombre),
    index('idx_municipios_ccaa').on(t.ccaa),
  ],
);

/** Un codigo postal puede abarcar varios municipios y viceversa. */
export const codigosPostales = pgTable(
  'codigos_postales',
  {
    id: serial('id').primaryKey(),
    cp: varchar('cp', { length: 5 }).notNull(),
    municipioIne: varchar('municipio_ine', { length: 5 }).references(() => municipios.codigoIne),
    geom: multipolygon4326('geom'),
  },
  (t) => [
    index('idx_cp_cp').on(t.cp),
    uniqueIndex('uq_cp_municipio').on(t.cp, t.municipioIne),
  ],
);

// ---------------------------------------------------------------------------
// Precios de mercado
// ---------------------------------------------------------------------------

/** Notariado: EUR/m2 de escritura por CP. Precio pagado, no de oferta. */
export const notariadoPrecios = pgTable(
  'notariado_precios',
  {
    id: serial('id').primaryKey(),
    cp: varchar('cp', { length: 5 }).notNull(),
    periodo: varchar('periodo', { length: 16 }).notNull(),
    /** Fecha de cierre del periodo. Es la fecha_dato que viaja al informe. */
    fechaDato: date('fecha_dato').notNull(),
    eurM2: numeric('eur_m2', { precision: 10, scale: 2 }).notNull(),
    nTransacciones: integer('n_transacciones'),
    p25: numeric('p25', { precision: 10, scale: 2 }),
    p75: numeric('p75', { precision: 10, scale: 2 }),
    /**
     * A que superficie se refiere el EUR/m2: 'util', 'construida' o
     * 'construida_con_comunes'. No son intercambiables y confundirlas mueve la
     * valoracion alrededor de un 6%.
     */
    baseSuperficie: varchar('base_superficie', { length: 24 }).notNull().default('construida'),
    fuenteId: integer('fuente_id')
      .notNull()
      .references(() => fuentesDatos.id),
  },
  (t) => [uniqueIndex('uq_notariado_cp_periodo').on(t.cp, t.periodo)],
);

/** MITMA serie 35103500: valor tasado de vivienda libre. */
export const mitmaPrecios = pgTable(
  'mitma_precios',
  {
    id: serial('id').primaryKey(),
    ambito: ambitoPrecioEnum('ambito').notNull(),
    /** Codigo INE del municipio o codigo de provincia, segun el ambito. */
    codigo: varchar('codigo', { length: 5 }).notNull(),
    periodo: varchar('periodo', { length: 16 }).notNull(),
    fechaDato: date('fecha_dato').notNull(),
    /**
     * Antiguedad de la vivienda tasada: 'hasta_5', 'mas_de_5' o 'total'. MITMA
     * publica los tres y no son intercambiables. Ver ADR-015: el precio y la
     * edad del parque tienen que describir la misma poblacion.
     */
    segmento: varchar('segmento', { length: 16 }).notNull().default('total'),
    eurM2: numeric('eur_m2', { precision: 10, scale: 2 }).notNull(),
    /** Tamano de muestra. Por debajo de 15, T1 degrada la confianza. */
    nTasaciones: integer('n_tasaciones'),
    /** MITMA informa sobre superficie construida, verificado en su metodologia. */
    baseSuperficie: varchar('base_superficie', { length: 24 }).notNull().default('construida'),
    fuenteId: integer('fuente_id')
      .notNull()
      .references(() => fuentesDatos.id),
  },
  (t) => [
    uniqueIndex('uq_mitma_ambito_codigo_periodo_segmento').on(
      t.ambito,
      t.codigo,
      t.periodo,
      t.segmento,
    ),
  ],
);

/** INE: indice de precios de vivienda por CCAA, para actualizar el dato base. */
export const ineIpv = pgTable(
  'ine_ipv',
  {
    id: serial('id').primaryKey(),
    ccaa: text('ccaa').notNull(),
    /** 'general' | 'nueva' | 'segunda_mano' */
    serie: varchar('serie', { length: 24 }).notNull(),
    periodo: varchar('periodo', { length: 16 }).notNull(),
    fechaDato: date('fecha_dato').notNull(),
    indice: real('indice').notNull(),
    variacionTrimestral: real('variacion_trimestral'),
    variacionAnual: real('variacion_anual'),
    idTablaIne: varchar('id_tabla_ine', { length: 24 }).notNull(),
    fuenteId: integer('fuente_id')
      .notNull()
      .references(() => fuentesDatos.id),
  },
  (t) => [uniqueIndex('uq_ipv_ccaa_serie_periodo').on(t.ccaa, t.serie, t.periodo)],
);

/** Precios de anexos por zona. Se suman en valor absoluto, no como coeficiente. */
export const preciosAnexos = pgTable(
  'precios_anexos',
  {
    id: serial('id').primaryKey(),
    ambito: ambitoPrecioEnum('ambito').notNull(),
    codigo: varchar('codigo', { length: 5 }).notNull(),
    periodo: varchar('periodo', { length: 16 }).notNull(),
    garajeEur: numeric('garaje_eur', { precision: 10, scale: 2 }),
    trasteroEur: numeric('trastero_eur', { precision: 10, scale: 2 }),
    terrazaEurM2: numeric('terraza_eur_m2', { precision: 10, scale: 2 }),
    fuenteId: integer('fuente_id')
      .notNull()
      .references(() => fuentesDatos.id),
  },
  (t) => [uniqueIndex('uq_anexos_ambito_codigo_periodo').on(t.ambito, t.codigo, t.periodo)],
);

// ---------------------------------------------------------------------------
// Inmueble
// ---------------------------------------------------------------------------

/** Cache de respuestas del Catastro. La API es lenta y no conviene machacarla. */
export const catastroCache = pgTable(
  'catastro_cache',
  {
    referenciaCatastral: varchar('referencia_catastral', { length: 20 }).primaryKey(),
    /** Respuesta cruda tal cual la devolvio el servicio. */
    payload: jsonb('payload').notNull(),
    /** Ficha ya normalizada a FichaCatastral. */
    ficha: jsonb('ficha'),
    obtenidoEn: timestamp('obtenido_en', { withTimezone: true }).notNull().defaultNow(),
    expiraEn: timestamp('expira_en', { withTimezone: true }),
  },
  (t) => [index('idx_catastro_expira').on(t.expiraEn)],
);

/**
 * Valor de referencia del Catastro. Determina la base imponible del ITP desde
 * la Ley 11/2021. Origen 'entrada_usuario' mientras la sede exija certificado.
 */
export const valoresReferencia = pgTable(
  'valores_referencia',
  {
    id: serial('id').primaryKey(),
    referenciaCatastral: varchar('referencia_catastral', { length: 20 }).notNull(),
    ejercicio: integer('ejercicio').notNull(),
    valorEur: numeric('valor_eur', { precision: 12, scale: 2 }).notNull(),
    origen: origenDatoEnum('origen').notNull().default('entrada_usuario'),
    introducidoEn: timestamp('introducido_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_vref_rc_ejercicio').on(t.referenciaCatastral, t.ejercicio)],
);

export const certificadosEnergeticos = pgTable(
  'certificados_energeticos',
  {
    id: serial('id').primaryKey(),
    referenciaCatastral: varchar('referencia_catastral', { length: 20 }).notNull(),
    ccaa: text('ccaa').notNull(),
    numeroRegistro: text('numero_registro'),
    letraConsumo: varchar('letra_consumo', { length: 1 }).notNull(),
    letraEmisiones: varchar('letra_emisiones', { length: 1 }),
    fechaRegistro: date('fecha_registro'),
    fuenteId: integer('fuente_id').references(() => fuentesDatos.id),
  },
  (t) => [index('idx_cee_rc').on(t.referenciaCatastral)],
);

// ---------------------------------------------------------------------------
// Alquiler (T4)
// ---------------------------------------------------------------------------

export const zonasTensionadas = pgTable(
  'zonas_tensionadas',
  {
    municipioIne: varchar('municipio_ine', { length: 5 }).primaryKey(),
    declaradoDesde: date('declarado_desde'),
    declaradoHasta: date('declarado_hasta'),
    fuenteId: integer('fuente_id').references(() => fuentesDatos.id),
  },
);

export const serpaviRentas = pgTable(
  'serpavi_rentas',
  {
    id: serial('id').primaryKey(),
    ambito: ambitoPrecioEnum('ambito').notNull(),
    codigo: varchar('codigo', { length: 5 }).notNull(),
    periodo: varchar('periodo', { length: 16 }).notNull(),
    /** Horquilla del indice de referencia, en EUR/m2 al mes. */
    rentaMinEurM2Mes: numeric('renta_min_eur_m2_mes', { precision: 8, scale: 3 }),
    rentaMaxEurM2Mes: numeric('renta_max_eur_m2_mes', { precision: 8, scale: 3 }),
    fuenteId: integer('fuente_id')
      .notNull()
      .references(() => fuentesDatos.id),
  },
  (t) => [uniqueIndex('uq_serpavi_ambito_codigo_periodo').on(t.ambito, t.codigo, t.periodo)],
);

// ---------------------------------------------------------------------------
// Historial de valoraciones
// ---------------------------------------------------------------------------

/**
 * Cada calculo se guarda entero: input, resultado, version del motor y huella de
 * la config. Sin esto no se puede reproducir un informe de hace tres meses, y un
 * informe que no se puede reproducir no es trazable.
 */
export const valoraciones = pgTable(
  'valoraciones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    /** Etiqueta que le pone el usuario: "Grao, calle X". Sin datos de terceros. */
    alias: text('alias'),
    referenciaCatastral: varchar('referencia_catastral', { length: 20 }),
    input: jsonb('input').notNull(),
    resultado: jsonb('resultado').notNull(),
    versionMotor: varchar('version_motor', { length: 32 }).notNull(),
    versionConfig: varchar('version_config', { length: 32 }).notNull(),
    precioMaximoEur: bigint('precio_maximo_eur', { mode: 'number' }),
  },
  (t) => [
    index('idx_valoraciones_creado').on(t.creadoEn),
    index('idx_valoraciones_rc').on(t.referenciaCatastral),
  ],
);
