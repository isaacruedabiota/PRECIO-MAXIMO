/**
 * Tests del puente ficha catastral -> PropertyInput.
 *
 * Lo que se comprueba aqui es tanto lo que rellena como lo que declara que NO
 * puede rellenar: un puente que devolviera un PropertyInput entero estaria
 * inventando ascensor, orientacion y estado de conservacion.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parsearDnprc } from '../src/catastro/parsear-dnprc';
import {
  ccaaDeProvincia,
  fichaAPropertyInput,
  plantaANumero,
} from '../src/catastro/ficha-a-property-input';
import type { FichaCatastral } from '../src/ports';
import type { RespuestaDnprc } from '../src/catastro/respuesta-dnprc';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..', '..');

function fichaDelFixture(nombre: string): FichaCatastral {
  const cruda = JSON.parse(
    readFileSync(join(RAIZ, 'fixtures', 'catastro', nombre), 'utf8'),
  ) as RespuestaDnprc;
  const r = parsearDnprc(cruda, 'test');
  if (r.tipo !== 'inmueble') throw new Error('el fixture deberia dar una ficha');
  return r.ficha;
}

/**
 * Se lee la config REAL, no una de test: lo que se comprueba es justamente que
 * los codigos de provincia que hay en itp.json resuelven la CCAA.
 */
function itpReal(): { ccaa: { ccaa: string; codigos_provincia_ine?: readonly string[] }[] } {
  return JSON.parse(
    readFileSync(join(RAIZ, 'packages', 'config', 'data', 'itp.json'), 'utf8'),
  ) as { ccaa: { ccaa: string; codigos_provincia_ine?: readonly string[] }[] };
}

// El puente solo mira config.itp, asi que basta con esa parte.
const config = { itp: itpReal() } as unknown as Parameters<typeof fichaAPropertyInput>[1];

describe('piso residencial', () => {
  const p = fichaAPropertyInput(fichaDelFixture('consulta-dnprc-2004930yk5320s0009rh.json'), config);

  it('resuelve la CCAA a partir de la provincia, que es lo que fija el ITP', () => {
    expect(p.datos.localizacion?.ccaa).toBe('Comunitat Valenciana');
    expect(p.datos.localizacion?.municipio_ine).toBe('12040');
    expect(p.datos.localizacion?.codigo_postal).toBe('12006');
  });

  it('lleva a T1 la superficie de la VIVIENDA, no el total del inmueble', () => {
    expect(p.datos.superficie).toEqual({ tipo: 'construida', m2: 101 });
    expect(p.datos.superficie_construida_con_comunes_m2).toBe(123);
  });

  it('avisa de que ha descartado los metros de anejos y comunes', () => {
    expect(p.avisos.some((a) => a.includes('155') && a.includes('101'))).toBe(true);
  });

  it('cuenta garaje y trastero como anexos', () => {
    expect(p.datos.anexos.plazas_garaje).toBe(1);
    expect(p.datos.anexos.trasteros).toBe(1);
  });

  it('avisa de que la terraza no viene desglosada', () => {
    expect(p.datos.anexos.terraza_m2).toBe(0);
    expect(p.avisos.some((a) => a.toLowerCase().includes('terraza'))).toBe(true);
  });

  it('traduce la planta y no se inventa si es atico', () => {
    expect(p.datos.planta.numero).toBe(1);
    expect(p.datos.planta.es_bajo).toBe(false);
    expect(p.faltan).toContain('planta.es_atico');
  });

  it('trae el ano de construccion y la division horizontal', () => {
    expect(p.datos.anio_construccion).toBe(1998);
    expect(p.datos.tiene_division_horizontal).toBe(true);
  });

  it('declara lo que el Catastro no publica en lugar de rellenarlo', () => {
    for (const campo of [
      'ascensor',
      'orientacion',
      'estado_conservacion',
      'certificado_energetico',
      'valor_referencia_catastral',
      'precio_pedido',
    ]) {
      expect(p.faltan).toContain(campo);
    }
  });

  it('no da por bueno un uso que no sea residencial', () => {
    expect(p.avisos.some((a) => a.includes('no residencial'))).toBe(false);
  });
});

describe('finca rustica de uso industrial', () => {
  const p = fichaAPropertyInput(fichaDelFixture('consulta-dnprc-0000902yk5300s.json'), config);

  it('avisa de que el uso no es residencial y el resultado no significaria nada', () => {
    expect(p.avisos.some((a) => a.includes('Industrial agrario'))).toBe(true);
  });

  it('avisa de que la planta que da el Catastro no es un numero', () => {
    // En este inmueble la planta es "OD".
    expect(p.datos.planta.numero).toBeNull();
    expect(p.avisos.some((a) => a.includes('"OD"'))).toBe(true);
  });
});

describe('provincia -> CCAA', () => {
  const itp = config.itp;

  it('resuelve las tres provincias de la Comunitat Valenciana', () => {
    for (const cp of ['03', '12', '46']) {
      expect(ccaaDeProvincia(cp, itp)).toBe('Comunitat Valenciana');
    }
  });

  it('resuelve Madrid, Barcelona, Sevilla, Murcia y Zaragoza', () => {
    expect(ccaaDeProvincia('28', itp)).toBe('Comunidad de Madrid');
    expect(ccaaDeProvincia('08', itp)).toBe('Cataluna');
    expect(ccaaDeProvincia('41', itp)).toBe('Andalucia');
    expect(ccaaDeProvincia('30', itp)).toBe('Region de Murcia');
    expect(ccaaDeProvincia('50', itp)).toBe('Aragon');
  });

  it('devuelve null en una provincia cuya CCAA no esta en la config', () => {
    // Lugo (27) pertenece a Galicia, que aun no tiene bloque en itp.json.
    expect(ccaaDeProvincia('27', itp)).toBeNull();
  });
});

describe('lectura de la planta', () => {
  it('traduce los codigos numericos, incluidos los sotanos', () => {
    expect(plantaANumero('00')).toBe(0);
    expect(plantaANumero('01')).toBe(1);
    expect(plantaANumero('-1')).toBe(-1);
  });

  it('devuelve null en un codigo que no es numero', () => {
    expect(plantaANumero('OD')).toBeNull();
    expect(plantaANumero(null)).toBeNull();
  });
});
