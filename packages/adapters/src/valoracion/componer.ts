/**
 * Monta el CalcInput del motor a partir de un expediente y de las fuentes.
 *
 * Es la pieza que faltaba: hasta ahora el Catastro daba la ficha y la base daba
 * el EUR/m2, pero nadie los juntaba. La juntan aqui la CLI y la web, para que no
 * haya dos maneras distintas de construir la misma entrada.
 *
 * Lo que NO hace: rellenar huecos. Si falta la CCAA, si no hay precio de
 * mercado o si el uso no es residencial, lo dice y para o avisa, segun cuanto
 * comprometa el resultado.
 */

import type {
  AntiguedadParque,
  CalcInput,
  MarketData,
  PropertyInput,
  SuperficieInput,
} from '@vp/engine';
import type { EngineConfig } from '@vp/config/schemas';

import { fichaAPropertyInput } from '../catastro/ficha-a-property-input';
import { SinDatoError } from '../ports';
import type {
  CatastroPort,
  FichaCatastral,
  InePort,
  PrecioMercadoPort,
} from '../ports';
import type { Expediente } from './expediente';

export class ExpedienteIncompletoError extends Error {
  override readonly name = 'ExpedienteIncompletoError';

  constructor(
    readonly campo: string,
    readonly detalle: string,
  ) {
    super(`No se puede valorar: ${campo}. ${detalle}`);
  }
}

export interface ResultadoComposicion {
  input: CalcInput;
  ficha: FichaCatastral;
  /** Salvedades sobre como se ha montado la entrada, no sobre el calculo. */
  avisos: readonly string[];
}

export interface FuentesDeValoracion {
  catastro: CatastroPort;
  precios: PrecioMercadoPort;
  /** null = no se actualiza el precio con el IPV, y se avisa. */
  ipv: InePort | null;
  /**
   * Antiguedad del parque de la zona. Se pasa desde fuera porque cada
   * consumidor la tiene en un sitio: la CLI en un fixture, la web en la base.
   * null = el motor cae al valor de respaldo de config y avisa (ADR-015).
   */
  antiguedadParque?: ((municipioCatastro: string) => AntiguedadParque | null) | undefined;
}

export async function componerCalcInput(
  expediente: Expediente,
  config: EngineConfig,
  fuentes: FuentesDeValoracion,
  fechaCalculo: string,
): Promise<ResultadoComposicion> {
  const avisos: string[] = [];

  // --- 1. Ficha catastral -------------------------------------------------
  const respuesta = await fuentes.catastro.consultar(expediente.referencia_catastral);
  if (respuesta.datos.tipo !== 'inmueble') {
    throw new ExpedienteIncompletoError(
      'la referencia es de parcela, no de inmueble',
      `Esa parcela tiene ${respuesta.datos.parcela.total} inmuebles. Usa la referencia de 20 caracteres del que quieras valorar.`,
    );
  }
  const ficha = respuesta.datos.ficha;

  const puente = fichaAPropertyInput(ficha, config);
  avisos.push(...puente.avisos);

  const localizacion = puente.datos.localizacion;
  if (localizacion === null) {
    throw new ExpedienteIncompletoError(
      'no se puede resolver la comunidad autonoma del inmueble',
      'Sin ella no hay tipo de ITP, y sin ITP no hay T2. Comprueba que la provincia ' +
        'esta en packages/config/data/itp.json (ADR-025).',
    );
  }

  // --- 2. Superficie ------------------------------------------------------
  // Por defecto la del Catastro: el elemento VIVIENDA, construida sin comunes,
  // que es la misma base que declara MITMA (ADR-022).
  const superficie: SuperficieInput | null =
    expediente.piso.superficie_declarada ?? puente.datos.superficie;
  if (superficie === null) {
    throw new ExpedienteIncompletoError(
      'no hay superficie utilizable',
      'El Catastro no desglosa el elemento VIVIENDA de este inmueble. Indica la ' +
        'superficie a mano en el expediente.',
    );
  }
  if (expediente.piso.superficie_declarada !== null) {
    avisos.push(
      `Se usa la superficie del expediente (${superficie.m2} m2 ${superficie.tipo}) ` +
        `en lugar de la del Catastro (${puente.datos.superficie?.m2 ?? '?'} m2 construida).`,
    );
  }

  // --- 3. Datos de mercado ------------------------------------------------
  const precio = await fuentes.precios.resolver({
    codigo_postal: localizacion.codigo_postal,
    municipio_ine: localizacion.municipio_ine,
    codigo_provincia: ficha.direccion.codigo_provincia_ine ?? localizacion.municipio_ine?.slice(0, 2) ?? '',
  });

  let ipv: MarketData['ipv'] = null;
  if (fuentes.ipv === null) {
    avisos.push(
      'Sin IPV: el precio de mercado se usa tal cual, sin traerlo a fecha de hoy.',
    );
  } else {
    try {
      const r = await fuentes.ipv.variacionIPV(
        localizacion.ccaa,
        precio.datos.fecha_dato,
        fechaCalculo,
      );
      ipv = r.datos;
    } catch (e) {
      if (!(e instanceof SinDatoError)) throw e;
      avisos.push(
        `Sin IPV para ${localizacion.ccaa}: el precio se usa tal cual, sin actualizar. (${e.message})`,
      );
    }
  }

  const antiguedad =
    fuentes.antiguedadParque === undefined || ficha.direccion.municipio_catastro === null
      ? null
      : fuentes.antiguedadParque(
          `${ficha.direccion.codigo_provincia_ine ?? ''}${ficha.direccion.municipio_catastro}`,
        );
  if (antiguedad === null) {
    avisos.push(
      'Sin antiguedad del parque de la zona: T1 usara el valor de respaldo de config, ' +
        'que es global y no describe este municipio (ADR-015). Se calcula con: pnpm ingest:antiguedad.',
    );
  }

  const market: MarketData = {
    precio_m2: precio.datos,
    ipv,
    anexos: null,
    superficie_p90_zona_m2: null,
    antiguedad_parque: antiguedad,
    alquiler: null,
    arv_eur_m2: null,
  };

  // --- 4. El inmueble -----------------------------------------------------
  const planta = puente.datos.planta;
  if (planta.numero === null) {
    throw new ExpedienteIncompletoError(
      'no se puede determinar la planta',
      `El Catastro da "${ficha.direccion.planta ?? 'nada'}", que no es un numero. ` +
        'La planta cambia el coeficiente de T1, asi que no se supone.',
    );
  }

  const property: PropertyInput = {
    referencia_catastral: ficha.referencia_catastral,
    localizacion,
    superficie,
    superficie_construida_con_comunes_m2: puente.datos.superficie_construida_con_comunes_m2,
    planta: {
      numero: planta.numero,
      es_atico: expediente.piso.es_atico,
      es_bajo: planta.numero === 0,
    },
    ascensor: expediente.piso.ascensor,
    situacion: expediente.piso.situacion,
    orientacion: expediente.piso.orientacion,
    anio_construccion: puente.datos.anio_construccion,
    anio_rehabilitacion: expediente.piso.anio_rehabilitacion,
    estado_conservacion: expediente.piso.estado_conservacion,
    certificado_energetico: expediente.piso.certificado_energetico,
    anexos: puente.datos.anexos,
    habitaciones: expediente.piso.habitaciones,
    banos: expediente.piso.banos,
    precio_pedido: expediente.piso.precio_pedido,
    dias_publicado: expediente.piso.dias_publicado,
    valor_referencia_catastral: expediente.piso.valor_referencia_catastral,
    valor_catastral: expediente.piso.valor_catastral,
    es_obra_nueva: false,
    tiene_division_horizontal: puente.datos.tiene_division_horizontal,
    es_vpo: expediente.piso.es_vpo,
  };

  if (expediente.piso.valor_referencia_catastral === null) {
    avisos.push(
      'Sin valor de referencia catastral: la base imponible del ITP se calcula solo ' +
        'sobre el precio, y desde la Ley 11/2021 manda el mayor de los dos. ' +
        'Consultalo con Cl@ve en la sede (ADR-024).',
    );
  }

  return {
    input: {
      fecha_calculo: fechaCalculo,
      property,
      riesgos: expediente.riesgos,
      buyer: expediente.comprador,
      market,
      reforma: expediente.reforma,
      inversion: expediente.inversion,
      config,
    },
    ficha,
    avisos,
  };
}
