/**
 * Forma de la respuesta de Consulta_DNPRC, transcrita de respuestas REALES.
 *
 * Fixtures de los que sale cada campo:
 *   fixtures/catastro/consulta-dnprc-2004930yk5320s0009rh.json  (bico, piso)
 *   fixtures/catastro/consulta-dnprc-2004930yk5320s.json        (lrcdnp, parcela)
 *   fixtures/catastro/consulta-dnprc-0000902yk5300s.json        (bico, sin division horizontal)
 *   fixtures/catastro/consulta-dnprc-0000000xx0000x0000xx.json  (lerr, error)
 *
 * Todo es opcional porque el servicio omite las claves que no aplican en lugar
 * de mandarlas a null: un inmueble sin anejos no trae lcons, uno rustico no
 * trae lourb sino lorus. Declararlo obligatorio seria mentir sobre el contrato.
 */

/** Referencia catastral partida en sus cinco trozos. */
export interface RcCruda {
  /** 7 caracteres de parcela. */
  pc1?: string;
  /** 7 caracteres de parcela. */
  pc2?: string;
  /** 4 caracteres de cargo: identifican el inmueble dentro de la parcela. */
  car?: string;
  /** Digitos de control. */
  cc1?: string;
  cc2?: string;
}

export interface DireccionUrbanaCruda {
  dir?: {
    /** Codigo de via. */
    cv?: string;
    /** Sigla del tipo de via: CL, AV, GR... */
    tv?: string;
    /** Nombre de la via. */
    nv?: string;
    /** Primer numero de policia. */
    pnp?: string;
    snp?: string;
  };
  /** Localizacion interior: escalera, planta, puerta. */
  loint?: { es?: string; pt?: string; pu?: string };
  /** Codigo postal. */
  dp?: string;
  dm?: string;
}

export interface DatosTerritorialesCrudos {
  /** Codigos INE: cp = provincia (2 digitos), cm = municipio (3 digitos). */
  loine?: { cp?: string; cm?: string };
  /** Codigo de municipio del Catastro, que NO es el del INE. */
  cmc?: string;
  /** Nombre de provincia. */
  np?: string;
  /** Nombre de municipio. */
  nm?: string;
  locs?: {
    /** Urbano, en la respuesta de ficha. */
    lous?: { lourb?: DireccionUrbanaCruda };
    /** Rustico. */
    lors?: { lorus?: Record<string, unknown>; lourb?: DireccionUrbanaCruda };
  };
}

/** Datos economicos y de superficie del bien inmueble. */
export interface DebiCrudo {
  /** Uso principal: 'Residencial', 'Almacen-Estacionamiento', 'Comercial'... */
  luso?: string;
  /**
   * Superficie construida TOTAL del inmueble, en m2 y como cadena. Incluye
   * anejos y parte proporcional de elementos comunes. Ver ADR-022.
   */
  sfc?: string;
  /** Cuota de participacion, en PORCENTAJE y con coma decimal: "3,980000". */
  cpt?: string;
  /** Ano de construccion. */
  ant?: string;
}

/** Elemento constructivo: la vivienda, cada anejo y los elementos comunes. */
export interface ConstruccionCruda {
  /** 'VIVIENDA', 'ALMACEN', 'APARCAMIENTO', 'ELEMENTOS COMUNES'... */
  lcd?: string;
  dt?: { lourb?: { loint?: { es?: string; pt?: string; pu?: string } } };
  /** Superficie del elemento, en m2 y como cadena. */
  dfcons?: { stl?: string };
  dvcons?: { dtip?: string };
}

export interface BienInmuebleCrudo {
  idbi?: {
    /** 'UR' urbana, 'RU' rustica. */
    cn?: string;
    rc?: RcCruda;
  };
  dt?: DatosTerritorialesCrudos;
  /** Direccion completa en una linea. */
  ldt?: string;
  debi?: DebiCrudo;
}

export interface FincaCruda {
  ldt?: string;
  /** Tipo de parcela. Es donde se lee si hay division horizontal. */
  ltp?: string;
  /** Datos fisicos: ss = superficie de suelo en m2. */
  dff?: { ss?: string };
  infgraf?: { igraf?: string };
}

/** Ficha completa: bien inmueble, finca y desglose constructivo. */
export interface BicoCrudo {
  bi?: BienInmuebleCrudo;
  finca?: FincaCruda;
  /**
   * En los fixtures capturados siempre llega como array, tambien con un solo
   * elemento (0000902YK5300S trae lcons de longitud 1). El tipo admite ademas el
   * objeto suelto por prudencia, no porque se haya visto.
   */
  lcons?: ConstruccionCruda[] | ConstruccionCruda;
}

/** Una linea del listado de inmuebles de una parcela. */
export interface InmuebleParcelaCrudo {
  rc?: RcCruda;
  dt?: DatosTerritorialesCrudos;
  debi?: DebiCrudo;
  ldt?: string;
}

export interface ErrorCrudo {
  cod?: string;
  des?: string;
}

export interface ConsultaDnprcResult {
  control?: {
    /** Numero de inmuebles devueltos. */
    cudnp?: number;
    /** Numero de elementos constructivos. */
    cucons?: number;
    /** Numero de errores. */
    cuerr?: number;
  };
  /** Presente cuando la referencia identifica un unico inmueble. */
  bico?: BicoCrudo;
  /** Presente cuando la referencia es de parcela con varios inmuebles. */
  lrcdnp?: { rcdnp?: InmuebleParcelaCrudo[] | InmuebleParcelaCrudo };
  lerr?: ErrorCrudo[] | ErrorCrudo;
}

export interface RespuestaDnprc {
  consulta_dnprcResult?: ConsultaDnprcResult;
}
