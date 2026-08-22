/**
 * Modelo de dominio del motor de precio maximo.
 *
 * Convencion de nombres (ver CLAUDE.md): los conceptos del dominio inmobiliario
 * y fiscal espanol van en espanol (ITP, derrama, valor_referencia, superficie_util)
 * porque no tienen equivalente ingles sin perder precision juridica. La fontaneria
 * (nombres de fichero, tipos de infraestructura, puertos de adaptadores) va en ingles.
 *
 * FASE 0: aqui solo se define el contrato. Ni una linea de calculo.
 */

// Import del subpath de esquemas, no del indice: el indice arrastra el cargador,
// que hace I/O con node:fs. El motor no debe poder ni ver esas APIs.
import type { EngineConfig } from '@vp/config/schemas';

// ---------------------------------------------------------------------------
// Trazabilidad
// ---------------------------------------------------------------------------

export type Confianza = 'alta' | 'media' | 'baja';

export type Unidad =
  | 'EUR'
  | 'EUR/m2'
  | 'm2'
  | 'porcentaje'
  | 'coeficiente'
  | 'anios'
  | 'meses';

/**
 * Todo numero que sale del motor es un TrazedValue. Regla del proyecto:
 * si no puedes decir de donde sale un numero, no lo muestres.
 */
export interface TrazedValue {
  valor: number;
  /** Origen legible: "Notariado CP 12100", "MITMA municipal", "input usuario", "config/itp.json". */
  fuente: string;
  /** ISO-8601 (YYYY-MM-DD). Fecha A LA QUE SE REFIERE el dato, no la de descarga. */
  fecha_dato: string;
  /** "comparacion homogeneizada", "arancel escalado", "biseccion", "sistema frances". */
  metodo: string;
  confianza: Confianza;
  unidad: Unidad;
  /** Motivos de degradacion de confianza, supuestos aplicados, salvedades. */
  notas?: readonly string[];
}

/** Linea de un desglose: cada paso intermedio de un techo, tambien trazado. */
export interface DesgloseLinea {
  concepto: string;
  valor: TrazedValue;
  /** Formula legible por humanos, para el informe. */
  formula?: string;
}

// ---------------------------------------------------------------------------
// Avisos y bloqueantes
// ---------------------------------------------------------------------------

export type NivelAviso = 'info' | 'atencion' | 'critico';

export interface Aviso {
  nivel: NivelAviso;
  /** Codigo estable para tests y para i18n futura. Ej: 'SUPERFICIE_ESTIMADA'. */
  codigo: string;
  titulo: string;
  detalle: string;
  /** Ej: "Ley 11/2021, art. 10 TRLITPAJD". */
  referencia_legal?: string;
}

/**
 * Un bloqueante NO descuenta: para el calculo. Devolver un precio maximo sobre
 * un inmueble sin division horizontal o con precio de VPO tasado por la
 * administracion seria dar un numero falso con apariencia de rigor.
 */
export interface Bloqueante {
  codigo: 'SIN_DIVISION_HORIZONTAL' | 'VPO_PRECIO_MAXIMO' | 'AFECCION_URBANISTICA';
  titulo: string;
  detalle: string;
  referencia_legal?: string;
  /** Que tiene que comprobar el usuario para desbloquear el calculo. */
  como_verificar: string;
}

// ---------------------------------------------------------------------------
// Entrada: el inmueble
// ---------------------------------------------------------------------------

export type EstadoConservacion =
  | 'a_reformar'
  | 'buen_estado'
  | 'reformado_reciente';

export type LetraCEE = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

export type CertificadoEnergetico =
  | { estado: 'registrado'; letra_consumo: LetraCEE; letra_emisiones?: LetraCEE }
  | { estado: 'en_tramite' }
  | { estado: 'no_disponible' };

export type Orientacion =
  | 'norte'
  | 'sur'
  | 'este'
  | 'oeste'
  | 'noreste'
  | 'noroeste'
  | 'sureste'
  | 'suroeste'
  | 'desconocida';

/**
 * Las tres superficies que maneja el sector, y que NO son intercambiables:
 *
 *   util                     lo que se pisa dentro de la vivienda
 *   construida               util mas cerramientos y tabiqueria
 *   construida_con_comunes   lo anterior mas la parte proporcional de zonas
 *                            comunes, segun cuota de participacion
 *
 * La distincion no es academica. La metodologia de la estadistica de valor
 * tasado de MITMA dice literalmente que su EUR/m2 sale del "cociente entre el
 * valor de tasacion y la superficie construida", y define la construida con
 * comunes como concepto aparte. Los anuncios, en cambio, suelen dar la
 * construida con comunes. Confundirlas mueve T1 alrededor de un 6%.
 */
export type TipoSuperficie = 'util' | 'construida' | 'construida_con_comunes';

/**
 * La superficie es el input que mas dinero mueve. 80 m2 construidos frente a
 * 65 m2 utiles son decenas de miles de euros, asi que el tipo obliga a declarar
 * cual de las tres se esta dando.
 */
export interface SuperficieInput {
  tipo: TipoSuperficie;
  m2: number;
}

/** Resultado de resolver la superficie a utiles, con la estimacion marcada. */
export interface SuperficieResuelta {
  m2_utiles: TrazedValue;
  origen: 'declarada_util' | 'estimada_desde_construida';
  /** Factor construida -> util aplicado. null si la util venia declarada. */
  factor_aplicado: number | null;
}

export interface Planta {
  /** 0 = bajo, 1 = primera... Los sotanos y entreplantas van con numero negativo o 0. */
  numero: number;
  es_atico: boolean;
  es_bajo: boolean;
}

export interface Anexos {
  plazas_garaje: number;
  trasteros: number;
  terraza_m2: number;
}

export interface Localizacion {
  codigo_postal: string;
  /** Codigo INE de 5 digitos del municipio (2 provincia + 3 municipio). */
  municipio_ine: string | null;
  municipio_nombre: string;
  provincia: string;
  /** Nombre oficial de la CCAA, tal cual aparece como clave en config/itp.json. */
  ccaa: string;
}

export interface PropertyInput {
  referencia_catastral: string | null;
  localizacion: Localizacion;

  superficie: SuperficieInput;
  /** Construida con comunes, si se conoce. Informativa. */
  superficie_construida_con_comunes_m2: number | null;

  planta: Planta;
  ascensor: boolean;
  /** Un interior vale menos por luz y ventilacion, no por metros. */
  situacion: 'exterior' | 'interior';
  orientacion: Orientacion;

  anio_construccion: number | null;
  /** Ano de rehabilitacion integral del edificio, si la hubo. */
  anio_rehabilitacion: number | null;

  estado_conservacion: EstadoConservacion;
  certificado_energetico: CertificadoEnergetico;
  anexos: Anexos;

  habitaciones: number | null;
  banos: number | null;

  /** Precio que pide el vendedor. Referencia para negociar, NO input del calculo. */
  precio_pedido: number;
  dias_publicado: number | null;

  /**
   * Valor de referencia del Catastro. Determina la base imponible del ITP desde
   * la Ley 11/2021. No es consultable sin certificado digital para inmueble
   * ajeno, asi que entra a mano. null = desconocido -> el motor avisa, no supone.
   */
  valor_referencia_catastral: number | null;
  /** Valor catastral (distinto del de referencia). Necesario para el art. 91 LIVA en T3. */
  valor_catastral: number | null;

  es_obra_nueva: boolean;
  /** null = sin comprobar. Un null en un bloqueante genera aviso, no bloqueo. */
  tiene_division_horizontal: boolean | null;
  es_vpo: boolean | null;
}

// ---------------------------------------------------------------------------
// Entrada: la reforma prevista
// ---------------------------------------------------------------------------

export type NivelReforma =
  | 'lavado_de_cara'
  | 'reforma_parcial'
  | 'reforma_integral'
  | 'integral_premium';

export type PartidaSingular =
  | 'sustitucion_bajante_comunitaria'
  | 'refuerzo_estructural'
  | 'retirada_fibrocemento'
  | 'instalacion_ascensor'
  | 'aerotermia'
  | 'rehabilitacion_fachada';

export interface ReformaPrevista {
  nivel: NivelReforma;
  /** Importes absolutos, no EUR/m2. Se suman al modulo. */
  partidas_singulares: readonly PartidaSingular[];
  /**
   * Sin proyecto cerrado la provision de imprevistos sube: no sabes lo que vas
   * a encontrar al levantar el suelo.
   */
  hay_proyecto_cerrado: boolean;
  /**
   * El destinatario de la obra actua como particular y no como empresario.
   * Es una de las condiciones del tipo reducido de IVA del art. 91 LIVA, y en
   * modo flipping deja de cumplirse.
   */
  destinatario_particular: boolean;
  /**
   * Coste de los materiales que aporta quien ejecuta la obra, como fraccion de
   * la base imponible. Tercera condicion del tipo reducido de IVA
   * (art. 91.Uno.2.10 LIVA): por encima del limite legal, tipo general.
   * null = no se sabe, y entonces se aplica el tipo general con aviso.
   */
  coste_materiales_pct: number | null;
}

// ---------------------------------------------------------------------------
// Entrada: la operacion de inversion (T4)
// ---------------------------------------------------------------------------

export interface InversionInput {
  /** Autogestion no cuesta dinero pero cuesta tiempo; la agencia se lleva un %. */
  gestion: 'autogestion' | 'agencia';
  /**
   * IBI anual del recibo. No se estima si no hace falta: omitirlo infla la
   * rentabilidad y con ella el precio que la herramienta recomienda pagar.
   */
  ibi_anual_eur: number | null;
  /** Cuota de comunidad mensual, del acta o del anuncio. */
  comunidad_mensual_eur: number | null;
  /** Rentabilidad neta objetivo. null usa la de config. */
  rentabilidad_objetivo: number | null;
  /**
   * Tipo marginal de IRPF del inversor. Es un dato personal, no un parametro
   * legal, por eso entra aqui y no en la configuracion.
   */
  tipo_marginal_irpf: number | null;
}

// ---------------------------------------------------------------------------
// Entrada: riesgos
// ---------------------------------------------------------------------------

export type EstadoITE = 'favorable' | 'desfavorable' | 'no_pasada' | 'no_aplica' | 'desconocido';

export interface RiesgosInput {
  /** Importe de derramas ya aprobadas en junta. Del acta, no estimado. */
  derramas_aprobadas_eur: number;
  ite: EstadoITE;
  /** Suma de cargas de la nota simple (hipoteca viva, embargos, censos). */
  cargas_registrales_eur: number;
  fibrocemento_en_cubierta: boolean;
  zona_inundable: 'no' | 'si' | 'desconocido';
  suelo_contaminado: boolean;
  /** Fuera de ordenacion, afectado por alineacion, expediente urbanistico. */
  afeccion_urbanistica: boolean;
  /** Metros de fachada del edificio, para estimar el coste de una ITE desfavorable. */
  metros_fachada_edificio: number | null;
}

export interface DescuentoRiesgo {
  codigo: string;
  concepto: string;
  importe: TrazedValue;
  justificacion: string;
}

// ---------------------------------------------------------------------------
// Entrada: el comprador
// ---------------------------------------------------------------------------

export type TipoInteres = 'fijo' | 'variable' | 'mixto';

export interface CondicionesHipoteca {
  ltv_max: number;
  plazo_anios: number;
  tipo: TipoInteres;
  /** TIN anual en tanto por uno (0.029 = 2,9%). Para variable: euribor + diferencial. */
  tin_anual: number;
  /** Solo variable/mixto. Tanto por uno. */
  diferencial: number | null;
  /** Solo variable/mixto. Ultimo euribor 12m publicado, tanto por uno. */
  euribor_actual: number | null;
}

export type Objetivo = 'residencia' | 'inversion_alquiler' | 'inversion_flipping';

/**
 * Categoria de familia numerosa o monoparental. Importa porque los limites de
 * renta de las bonificaciones cambian entre general y especial.
 */
export type CategoriaFamiliaNumerosa = 'no' | 'general' | 'especial';

export interface BuyerProfile {
  edad: number;
  primera_vivienda_habitual: boolean;
  /**
   * El inmueble va a ser vivienda habitual, sea o no la primera. Son cosas
   * distintas: el AJD reducido de obra nueva pide vivienda habitual a secas,
   * mientras que varias bonificaciones de ITP exigen ademas que sea la primera.
   */
  sera_vivienda_habitual: boolean;
  familia_numerosa: CategoriaFamiliaNumerosa;
  discapacidad_reconocida: boolean;
  /** Los limites de renta de las bonificaciones difieren segun el regimen. */
  tributacion_irpf: 'individual' | 'conjunta';
  /** Base imponible IRPF del ultimo ejercicio. Muchos tipos reducidos de ITP tienen limite de renta. */
  base_imponible_irpf_anual: number | null;

  ahorro_disponible: number;
  ingresos_netos_mensuales: number;
  /** Cuotas de otros prestamos ya en curso. Restan capacidad de pago. */
  deudas_mensuales_actuales: number;

  hipoteca: CondicionesHipoteca;
  objetivo: Objetivo;
}

// ---------------------------------------------------------------------------
// Entrada: datos de mercado
// ---------------------------------------------------------------------------

export type AmbitoPrecio = 'codigo_postal' | 'municipio' | 'provincia';

/** Escalon de la cascada de fuentes de T1. El motor registra cual ha usado. */
export interface PrecioM2Referencia {
  eur_m2: number;
  ambito: AmbitoPrecio;
  /** "Notariado", "MITMA serie 35103500". */
  fuente: string;
  fuente_url: string | null;
  /** ISO. Fin del trimestre al que corresponde el dato. */
  fecha_dato: string;
  /** Numero de transacciones que sustentan el dato. <15 degrada la confianza. */
  n_transacciones: number | null;
  p25: number | null;
  p75: number | null;
  /**
   * A que superficie se refiere el EUR/m2 de la fuente. MITMA: 'construida',
   * verificado contra su documento de metodologia.
   */
  base_superficie: TipoSuperficie;
}

/** Variacion del IPV (INE) para actualizar el dato base a fecha de hoy. */
export interface VariacionIPV {
  ccaa: string;
  /** Variacion acumulada en tanto por uno entre desde y hasta. */
  variacion_acumulada: number;
  desde: string;
  hasta: string;
  fuente: string;
  id_tabla_ine: string;
}

export interface PreciosAnexos {
  garaje_eur: number | null;
  trastero_eur: number | null;
  terraza_eur_m2: number | null;
  fuente: string;
  fecha_dato: string;
}

/** Datos de alquiler para T4. SERPAVI como fuente primaria. */
export interface DatosAlquiler {
  renta_mensual_estimada: number;
  fuente: string;
  fecha_dato: string;
  /**
   * Si el municipio esta declarado zona de mercado residencial tensionado,
   * el indice de referencia limita la renta de los nuevos contratos. Tumba T4.
   */
  zona_tensionada: boolean | null;
  renta_maxima_indice: number | null;
}

/**
 * Antiguedad del parque de viviendas de la zona.
 *
 * Describe la zona, no es una regla de negocio, asi que viaja con los datos de
 * mercado igual que el precio. Es la referencia contra la que T1 deprecia por
 * antiguedad: sin ella habria que depreciar contra obra nueva, y eso cuenta dos
 * veces la antiguedad porque el EUR/m2 de la zona ya la lleva dentro.
 *
 * Debe describir la MISMA poblacion que el precio: si el precio es de vivienda
 * de mas de cinco anos, la edad tiene que calcularse sobre ese mismo parque.
 */
export interface AntiguedadParque {
  edad_media_anios: number;
  ambito: AmbitoPrecio;
  fuente: string;
  fuente_url: string | null;
  fecha_dato: string;
  /** Viviendas sobre las que se ha calculado la media. */
  n_viviendas: number | null;
}

export interface MarketData {
  /** Cascada ya resuelta por el adaptador, de mas a menos granular. */
  precio_m2: PrecioM2Referencia;
  ipv: VariacionIPV | null;
  anexos: PreciosAnexos | null;
  /** P90 de superficie de la zona, para penalizar pisos atipicos por iliquidez. */
  superficie_p90_zona_m2: number | null;
  /**
   * Antiguedad del parque de la zona. Si viene, manda sobre el valor de
   * config, que solo es un respaldo global.
   */
  antiguedad_parque: AntiguedadParque | null;
  alquiler: DatosAlquiler | null;
  /** Valor de mercado una vez reformado (ARV). Necesario para T3 y flipping. */
  arv_eur_m2: number | null;
}

// ---------------------------------------------------------------------------
// Salida: los cuatro techos
// ---------------------------------------------------------------------------

export type TechoId = 'T1' | 'T2' | 'T3' | 'T4';

export interface Techo {
  id: TechoId;
  nombre: string;
  /** T3 solo si el estado != listo para entrar. T4 solo en modo inversor. */
  aplica: boolean;
  motivo_no_aplica: string | null;
  valor: TrazedValue | null;
  /** Horquilla del techo, cuando la fuente permite calcularla (P25-P75 en T1). */
  rango: { min: number; max: number } | null;
  desglose: readonly DesgloseLinea[];
  avisos: readonly Aviso[];
}

/** Metricas de inversion que acompanan a T4. */
export interface MetricasInversion {
  rentabilidad_bruta: TrazedValue;
  rentabilidad_neta: TrazedValue;
  cash_on_cash: TrazedValue;
  anios_recuperacion: TrazedValue;
  noi_anual: TrazedValue;
}

export interface PuntoArgumentario {
  /** Titular para llevar a la mesa de negociacion. */
  titular: string;
  detalle: string;
  /** TrazedValues que respaldan el punto. Sin fuentes no hay argumento. */
  respaldo: readonly TrazedValue[];
  /** Euros que este argumento justifica descontar, si aplica. */
  impacto_eur: number | null;
}

export interface MaxPriceResult {
  /** ISO. Entra como parametro: el motor no lee la fecha del sistema. */
  fecha_calculo: string;
  version_motor: string;
  version_config: string;

  /** Si hay bloqueantes, el resto viene a null: no se da un numero falso. */
  bloqueantes: readonly Bloqueante[];

  techos: Readonly<Record<TechoId, Techo>>;
  techo_limitante: TechoId | null;
  minimo_techos: TrazedValue | null;

  descuentos_riesgo: readonly DescuentoRiesgo[];
  precio_maximo: TrazedValue | null;

  /** Tipicamente precio_maximo x 0,88-0,92. Configurable. */
  precio_entrada_negociacion: { min: number; max: number } | null;

  comparativa_precio_pedido: {
    precio_pedido: number;
    diferencia_eur: number;
    diferencia_pct: number;
    veredicto: 'por_debajo_de_mercado' | 'en_precio' | 'sobrevalorado';
  } | null;

  metricas_inversion: MetricasInversion | null;

  argumentario: readonly PuntoArgumentario[];
  avisos: readonly Aviso[];
  confianza_global: Confianza;
  disclaimer: string;
}

// ---------------------------------------------------------------------------
// Contrato del motor
// ---------------------------------------------------------------------------

/**
 * Entrada unica de calcularPrecioMaximo.
 *
 * El brief lo describia como PropertyInput & BuyerProfile & MarketData. Se usa
 * un objeto compuesto en lugar de una interseccion porque la interseccion
 * colisionaria en nombres de campo y, sobre todo, porque la config tiene que
 * entrar tambien: el motor no lee ficheros (ADR-002 en CLAUDE.md).
 */
export interface CalcInput {
  /** ISO. Sin Date.now() dentro del motor: la fecha es un parametro. */
  fecha_calculo: string;
  property: PropertyInput;
  riesgos: RiesgosInput;
  buyer: BuyerProfile;
  market: MarketData;
  /** null si el inmueble esta listo para entrar: entonces T3 no aplica. */
  reforma: ReformaPrevista | null;
  /** null en modo residencia: entonces T4 no aplica. */
  inversion: InversionInput | null;
  /**
   * Config ya cargada y validada por el borde de la aplicacion.
   * Import solo de tipos: el motor no depende de @vp/config en runtime.
   */
  config: EngineConfig;
}
