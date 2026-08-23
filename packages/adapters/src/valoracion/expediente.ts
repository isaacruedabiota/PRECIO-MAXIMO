/**
 * El expediente: todo lo que hay que saber de un piso y de su comprador que el
 * Catastro no publica.
 *
 * Existe porque la ficha catastral se queda a mitad de camino. Da metros, ano y
 * direccion, pero no dice si hay ascensor, si el piso es exterior, en que
 * estado esta ni que certificado energetico tiene, y esos son justamente los
 * coeficientes que mueven T1. El expediente es el hueco que rellena la persona.
 *
 * Lo consumen tanto la CLI (pnpm valorar) como la web, para que no haya dos
 * maneras distintas de montar un CalcInput.
 */

import type {
  BuyerProfile,
  CertificadoEnergetico,
  EstadoConservacion,
  InversionInput,
  Orientacion,
  ReformaPrevista,
  RiesgosInput,
  SuperficieInput,
} from '@vp/engine';

/** Lo que el Catastro no publica y hay que aportar. */
export interface DatosDelPiso {
  ascensor: boolean;
  situacion: 'exterior' | 'interior';
  orientacion: Orientacion;
  /**
   * No es deducible del Catastro: haria falta saber cual es la ultima planta
   * del edificio, y el desglose constructivo no lo dice.
   */
  es_atico: boolean;
  anio_rehabilitacion: number | null;
  estado_conservacion: EstadoConservacion;
  certificado_energetico: CertificadoEnergetico;
  habitaciones: number | null;
  banos: number | null;
  /** Lo que pide el vendedor. Referencia para negociar, no entra en el calculo. */
  precio_pedido: number;
  dias_publicado: number | null;
  /**
   * Del certificado de la sede, que exige Cl@ve o certificado digital (ADR-024).
   * null = desconocido, y entonces el motor avisa en vez de suponer.
   */
  valor_referencia_catastral: number | null;
  /** Distinto del de referencia. Lo necesita el art. 91 LIVA en T3. */
  valor_catastral: number | null;
  es_vpo: boolean | null;
  /**
   * Superficie del anuncio, si difiere de la del Catastro y se prefiere usarla.
   * null = se usa la del Catastro, que es construida sin comunes (ADR-022).
   */
  superficie_declarada: SuperficieInput | null;
}

export interface Expediente {
  referencia_catastral: string;
  piso: DatosDelPiso;
  riesgos: RiesgosInput;
  comprador: BuyerProfile;
  /** null = el piso esta listo para entrar y T3 no aplica. */
  reforma: ReformaPrevista | null;
  /** null salvo en los dos modos de inversion. */
  inversion: InversionInput | null;
}

/**
 * Expediente de partida, para que un formulario o una CLI tengan de donde
 * arrancar.
 *
 * OJO: aqui no hay ningun numero de negocio. Lo que se fija son opciones
 * neutras y datos personales a cero, que el usuario tiene que cambiar de todas
 * formas. El precio pedido va a cero a proposito: si alguien lo deja asi, el
 * veredicto frente al precio pedido saldra absurdo y se vera.
 */
export function expedienteVacio(referenciaCatastral: string): Expediente {
  return {
    referencia_catastral: referenciaCatastral,
    piso: {
      ascensor: false,
      situacion: 'exterior',
      orientacion: 'desconocida',
      es_atico: false,
      anio_rehabilitacion: null,
      estado_conservacion: 'buen_estado',
      certificado_energetico: { estado: 'no_disponible' },
      habitaciones: null,
      banos: null,
      precio_pedido: 0,
      dias_publicado: null,
      valor_referencia_catastral: null,
      valor_catastral: null,
      es_vpo: null,
      superficie_declarada: null,
    },
    riesgos: {
      derramas_aprobadas_eur: 0,
      ite: 'desconocido',
      cargas_registrales_eur: 0,
      fibrocemento_en_cubierta: false,
      zona_inundable: 'desconocido',
      suelo_contaminado: false,
      afeccion_urbanistica: false,
      metros_fachada_edificio: null,
    },
    comprador: {
      edad: 0,
      primera_vivienda_habitual: false,
      sera_vivienda_habitual: false,
      familia_numerosa: 'no',
      discapacidad_reconocida: false,
      tributacion_irpf: 'individual',
      base_imponible_irpf_anual: null,
      ahorro_disponible: 0,
      ingresos_netos_mensuales: 0,
      deudas_mensuales_actuales: 0,
      hipoteca: {
        ltv_max: 0.8,
        plazo_anios: 30,
        tipo: 'fijo',
        tin_anual: 0,
        diferencial: null,
        euribor_actual: null,
      },
      objetivo: 'residencia',
    },
    reforma: null,
    inversion: null,
  };
}
