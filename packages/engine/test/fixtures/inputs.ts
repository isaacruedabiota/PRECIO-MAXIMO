import type {
  BuyerProfile,
  CalcInput,
  DatosAlquiler,
  InversionInput,
  MarketData,
  PropertyInput,
  ReformaPrevista,
  RiesgosInput,
} from '../../src/types';
import { configDeTest } from './config';

/**
 * Constructores de input para tests. Cada uno devuelve un caso base neutro que
 * el test modifica solo en lo que esta comprobando, para que quede claro que
 * variable mueve el resultado.
 */

export function propiedadBase(over: Partial<PropertyInput> = {}): PropertyInput {
  return {
    referencia_catastral: null,
    localizacion: {
      codigo_postal: '12100',
      municipio_ine: '12040',
      municipio_nombre: 'Castello de la Plana',
      provincia: 'Castellon',
      ccaa: 'Comunitat Valenciana',
    },
    superficie: { tipo: 'util', m2: 70 },
    superficie_construida_con_comunes_m2: null,
    planta: { numero: 2, es_atico: false, es_bajo: false },
    ascensor: true,
    situacion: 'exterior',
    orientacion: 'desconocida',
    anio_construccion: 2000,
    anio_rehabilitacion: null,
    estado_conservacion: 'buen_estado',
    certificado_energetico: { estado: 'registrado', letra_consumo: 'D' },
    anexos: { plazas_garaje: 0, trasteros: 0, terraza_m2: 0 },
    habitaciones: 3,
    banos: 1,
    precio_pedido: 150000,
    dias_publicado: null,
    valor_referencia_catastral: null,
    valor_catastral: null,
    es_obra_nueva: false,
    tiene_division_horizontal: true,
    es_vpo: false,
    ...over,
  };
}

export function compradorBase(over: Partial<BuyerProfile> = {}): BuyerProfile {
  return {
    edad: 40,
    primera_vivienda_habitual: false,
    familia_numerosa: 'no',
    discapacidad_reconocida: false,
    tributacion_irpf: 'individual',
    base_imponible_irpf_anual: null,
    ahorro_disponible: 60000,
    ingresos_netos_mensuales: 2500,
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
    ...over,
  };
}

export function mercadoBase(over: Partial<MarketData> = {}): MarketData {
  return {
    precio_m2: {
      eur_m2: 1400,
      ambito: 'codigo_postal',
      fuente: 'Notariado CP 12100 (dato de test)',
      fuente_url: null,
      fecha_dato: '2026-06-30',
      n_transacciones: 40,
      p25: 1200,
      p75: 1650,
      base_superficie: 'util',
    },
    ipv: null,
    anexos: null,
    superficie_p90_zona_m2: null,
    alquiler: null,
    arv_eur_m2: null,
    ...over,
  };
}

export function riesgosBase(over: Partial<RiesgosInput> = {}): RiesgosInput {
  return {
    derramas_aprobadas_eur: 0,
    ite: 'no_aplica',
    cargas_registrales_eur: 0,
    fibrocemento_en_cubierta: false,
    zona_inundable: 'no',
    suelo_contaminado: false,
    afeccion_urbanistica: false,
    metros_fachada_edificio: null,
    ...over,
  };
}

export function reformaBase(over: Partial<ReformaPrevista> = {}): ReformaPrevista {
  return {
    nivel: 'reforma_integral',
    partidas_singulares: [],
    hay_proyecto_cerrado: true,
    destinatario_particular: true,
    coste_materiales_pct: null,
    ...over,
  };
}

export function inversionBase(over: Partial<InversionInput> = {}): InversionInput {
  return {
    gestion: 'autogestion',
    ibi_anual_eur: 400,
    comunidad_mensual_eur: 45,
    rentabilidad_objetivo: null,
    tipo_marginal_irpf: 0.3,
    ...over,
  };
}

export function alquilerBase(over: Partial<DatosAlquiler> = {}): DatosAlquiler {
  return {
    renta_mensual_estimada: 700,
    fuente: 'SERPAVI (dato de test)',
    fecha_dato: '2026-06-30',
    zona_tensionada: false,
    renta_maxima_indice: null,
    ...over,
  };
}

export function entradaBase(over: Partial<CalcInput> = {}): CalcInput {
  return {
    fecha_calculo: '2026-08-22',
    property: propiedadBase(),
    riesgos: riesgosBase(),
    buyer: compradorBase(),
    market: mercadoBase(),
    reforma: null,
    inversion: null,
    config: configDeTest(),
    ...over,
  };
}
