/**
 * Puente entre la ficha catastral y el PropertyInput del motor.
 *
 * Su valor esta tanto en lo que rellena como en lo que declara que NO puede
 * rellenar. El Catastro describe el inmueble fisica y administrativamente, pero
 * no dice nada de ascensor, orientacion, estado de conservacion ni certificado
 * energetico, y esos coeficientes son los que mueven T1. Devolver un
 * PropertyInput entero con valores por defecto seria inventar; se devuelve lo
 * que hay y la lista de lo que falta.
 */

import type { Anexos, Localizacion, SuperficieInput } from '@vp/engine';
import type { EngineConfig } from '@vp/config/schemas';

import type { FichaCatastral } from '../ports';

/** Etiquetas de lcons que el Catastro usa para los anejos que el motor cuenta. */
const ANEJO_GARAJE = 'APARCAMIENTO';
const ANEJO_TRASTERO = 'ALMACEN';
const ANEJO_TERRAZA = 'TERRAZA';

/** Uso principal que corresponde a una vivienda. */
const USO_RESIDENCIAL = 'residencial';

export interface DatosDeCatastro {
  referencia_catastral: string;
  /** ccaa queda vacia si la provincia no esta en itp.json. */
  localizacion: Localizacion | null;
  /**
   * Construida sin comunes, que es la base que declara MITMA para su EUR/m2.
   * null si el Catastro no desglosa el elemento VIVIENDA.
   */
  superficie: SuperficieInput | null;
  superficie_construida_con_comunes_m2: number | null;
  /** es_atico no es deducible del Catastro y por eso no viene aqui. */
  planta: { numero: number | null; es_bajo: boolean | null };
  anio_construccion: number | null;
  anexos: Anexos;
  tiene_division_horizontal: boolean | null;
}

export interface PuenteCatastro {
  datos: DatosDeCatastro;
  /** Campos de PropertyInput que el Catastro no publica. Los pone el usuario. */
  faltan: readonly string[];
  /** Salvedades sobre lo que si se ha rellenado. */
  avisos: readonly string[];
}

/**
 * Lo que el Catastro no publica en ningun caso. No es una lista de "todavia no":
 * es que el dato no existe en la fuente.
 */
const NO_ESTAN_EN_EL_CATASTRO: readonly string[] = [
  'ascensor',
  'situacion (exterior / interior)',
  'orientacion',
  'planta.es_atico',
  'anio_rehabilitacion',
  'estado_conservacion',
  'certificado_energetico',
  'habitaciones',
  'banos',
  'precio_pedido',
  'dias_publicado',
  'valor_referencia_catastral',
  'valor_catastral',
  'es_vpo',
];

/** Codigo INE de provincia -> nombre de CCAA tal cual figura en itp.json. */
export function ccaaDeProvincia(
  codigoProvincia: string | null,
  itp: EngineConfig['itp'],
): string | null {
  if (codigoProvincia === null) return null;
  const cp = codigoProvincia.padStart(2, '0');
  const bloque = itp.ccaa.find((c) => {
    const codigos = (c as { codigos_provincia_ine?: readonly string[] }).codigos_provincia_ine;
    return codigos !== undefined && codigos.includes(cp);
  });
  return bloque?.ccaa ?? null;
}

/** "01" -> 1, "-1" -> -1, "OD" -> null. */
export function plantaANumero(pt: string | null): number | null {
  if (pt === null) return null;
  if (!/^-?\d+$/.test(pt)) return null;
  return Number(pt);
}

function contarAnejos(ficha: FichaCatastral, tipo: string): number {
  return ficha.superficies.anejos.filter((a) => a.tipo.includes(tipo)).length;
}

function metrosDeAnejo(ficha: FichaCatastral, tipo: string): number {
  return ficha.superficies.anejos
    .filter((a) => a.tipo.includes(tipo))
    .reduce((s, a) => s + a.superficie_m2, 0);
}

export function fichaAPropertyInput(
  ficha: FichaCatastral,
  config: Pick<EngineConfig, 'itp'>,
): PuenteCatastro {
  const avisos: string[] = [];
  const faltan: string[] = [...NO_ESTAN_EN_EL_CATASTRO];

  // --- Localizacion -------------------------------------------------------
  const ccaa = ccaaDeProvincia(ficha.direccion.codigo_provincia_ine, config.itp);
  if (ccaa === null && ficha.direccion.provincia !== null) {
    avisos.push(
      `La provincia "${ficha.direccion.provincia}" (codigo ${ficha.direccion.codigo_provincia_ine ?? '?'}) ` +
        'no esta en itp.json, asi que no se puede resolver la CCAA ni por tanto el tipo de ITP.',
    );
  }

  const localizacion: Localizacion | null =
    ficha.direccion.codigo_postal !== null &&
    ficha.direccion.municipio !== null &&
    ficha.direccion.provincia !== null &&
    ccaa !== null
      ? {
          codigo_postal: ficha.direccion.codigo_postal,
          municipio_ine: ficha.direccion.municipio_ine,
          municipio_nombre: ficha.direccion.municipio,
          provincia: ficha.direccion.provincia,
          ccaa,
        }
      : null;
  if (localizacion === null) faltan.push('localizacion');

  // --- Superficie ---------------------------------------------------------
  // Se usa el elemento VIVIENDA, no debi.sfc. Ver ADR-022.
  const viviendaM2 = ficha.superficies.vivienda_m2;
  const superficie: SuperficieInput | null =
    viviendaM2 === null ? null : { tipo: 'construida', m2: viviendaM2 };

  if (viviendaM2 === null) {
    faltan.push('superficie');
    avisos.push(
      'El desglose constructivo no trae elemento VIVIENDA, asi que no se puede separar ' +
        'la superficie del piso de la de sus anejos y comunes. Hay que mirar la ficha a mano.',
    );
  } else if (ficha.superficies.total_m2 !== null && ficha.superficies.total_m2 !== viviendaM2) {
    avisos.push(
      `El Catastro imputa ${ficha.superficies.total_m2} m2 al inmueble, pero solo ${viviendaM2} ` +
        'son de la vivienda; el resto son anejos y parte proporcional de elementos comunes. ' +
        'Se usa la de la vivienda.',
    );
  }

  if (!ficha.superficies.desglose_cuadra && ficha.superficies.anejos.length > 0) {
    avisos.push(
      'La suma del desglose constructivo no cuadra con la superficie total del inmueble. ' +
        'Conviene comprobar la ficha en la sede antes de fiarse del reparto.',
    );
  }

  // --- Anejos -------------------------------------------------------------
  const terrazaM2 = metrosDeAnejo(ficha, ANEJO_TERRAZA);
  const anexos: Anexos = {
    plazas_garaje: contarAnejos(ficha, ANEJO_GARAJE),
    trasteros: contarAnejos(ficha, ANEJO_TRASTERO),
    terraza_m2: terrazaM2,
  };
  if (terrazaM2 === 0) {
    avisos.push(
      'El Catastro no desglosa terraza en este inmueble. Puede que no la tenga o que ' +
        'este computada dentro de la vivienda: si la hay, hay que meterla a mano.',
    );
  }

  // --- Uso ----------------------------------------------------------------
  const uso = ficha.uso_principal;
  if (uso !== null && !uso.toLowerCase().includes(USO_RESIDENCIAL)) {
    avisos.push(
      `El uso principal que consta en el Catastro es "${uso}", no residencial. ` +
        'El motor valora vivienda: sobre otro uso el resultado no significa nada.',
    );
  }

  // --- Planta -------------------------------------------------------------
  const numeroPlanta = plantaANumero(ficha.direccion.planta);
  if (numeroPlanta === null && ficha.direccion.planta !== null) {
    avisos.push(
      `La planta que da el Catastro es "${ficha.direccion.planta}", que no es un numero. ` +
        'Hay que indicarla a mano.',
    );
  }

  return {
    datos: {
      referencia_catastral: ficha.referencia_catastral,
      localizacion,
      superficie,
      superficie_construida_con_comunes_m2: ficha.superficies.vivienda_con_comunes_m2,
      planta: {
        numero: numeroPlanta,
        es_bajo: numeroPlanta === null ? null : numeroPlanta === 0,
      },
      anio_construccion: ficha.anio_construccion,
      anexos,
      tiene_division_horizontal: ficha.finca.division_horizontal,
    },
    faltan,
    avisos,
  };
}
