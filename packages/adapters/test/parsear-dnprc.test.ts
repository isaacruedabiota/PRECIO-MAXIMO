/**
 * Tests del parseo del Catastro contra los fixtures REALES de fixtures/catastro/.
 *
 * No hay ni un objeto de respuesta escrito a mano: si el Catastro cambia el
 * esquema, se vuelve a capturar el fixture y estos tests lo cantan. Es la razon
 * de ser de la regla 5 del proyecto.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ConsultaInvalidaError } from '../src/ports';
import { parsearDnprc, repartirSuperficies, leerDivisionHorizontal } from '../src/catastro/parsear-dnprc';
import type { RespuestaDnprc } from '../src/catastro/respuesta-dnprc';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(AQUI, '..', '..', '..', 'fixtures', 'catastro');

function fixture(nombre: string): RespuestaDnprc {
  return JSON.parse(readFileSync(join(FIXTURES, nombre), 'utf8')) as RespuestaDnprc;
}

const PISO = 'consulta-dnprc-2004930yk5320s0009rh.json';
const PARCELA = 'consulta-dnprc-2004930yk5320s.json';
const SIN_DIVISION = 'consulta-dnprc-0000902yk5300s.json';
const REFERENCIA_MALA = 'consulta-dnprc-0000000xx0000x0000xx.json';

describe('ficha de un piso', () => {
  const r = parsearDnprc(fixture(PISO), 'test');
  if (r.tipo !== 'inmueble') throw new Error('el fixture del piso deberia dar una ficha');
  const f = r.ficha;

  it('monta la referencia catastral a partir de sus cinco trozos', () => {
    expect(f.referencia_catastral).toBe('2004930YK5320S0009RH');
    expect(f.referencia_parcela).toBe('2004930YK5320S');
  });

  it('lee la direccion completa', () => {
    expect(f.direccion.tipo_via).toBe('CL');
    expect(f.direccion.via).toBe('ADZANETA');
    expect(f.direccion.numero).toBe('2');
    expect(f.direccion.escalera).toBe('1');
    expect(f.direccion.planta).toBe('01');
    expect(f.direccion.puerta).toBe('B');
    expect(f.direccion.codigo_postal).toBe('12006');
  });

  it('compone el codigo INE de municipio con el que se cruza MITMA', () => {
    // El Catastro da provincia "12" y municipio "40" por separado. Su propio
    // codigo de municipio (cmc) es 900, que NO es el del INE.
    expect(f.direccion.municipio_ine).toBe('12040');
    expect(f.direccion.codigo_provincia_ine).toBe('12');
  });

  it('lee el ano de construccion, el uso y la clase', () => {
    expect(f.anio_construccion).toBe(1998);
    expect(f.uso_principal).toBe('Residencial');
    expect(f.clase).toBe('urbana');
  });

  it('pasa la cuota de participacion de porcentaje a tanto por uno', () => {
    // El Catastro publica "3,980000". Las 27 cuotas de la parcela suman 100.
    expect(f.participacion).toBeCloseTo(0.0398, 6);
  });

  it('detecta la division horizontal, que es un bloqueante del motor', () => {
    expect(f.finca.tipo).toBe('Parcela con varios inmuebles (division horizontal)');
    expect(f.finca.division_horizontal).toBe(true);
  });

  it('conserva el enlace a la cartografia y la superficie de suelo', () => {
    expect(f.finca.superficie_suelo_m2).toBe(698);
    expect(f.finca.url_cartografia).toContain('sedecatastro.gob.es');
  });
});

describe('superficies: el campo que parece la superficie no lo es (ADR-022)', () => {
  const r = parsearDnprc(fixture(PISO), 'test');
  if (r.tipo !== 'inmueble') throw new Error('deberia ser ficha');
  const s = r.ficha.superficies;

  it('separa la vivienda de los anejos y de los comunes', () => {
    // 101 vivienda + 6 trastero + 26 garaje + 22 comunes = 155, que es sfc.
    expect(s.total_m2).toBe(155);
    expect(s.vivienda_m2).toBe(101);
    expect(s.comunes_m2).toBe(22);
    expect(s.vivienda_con_comunes_m2).toBe(123);
  });

  it('usar el total como superficie del piso lo inflaria un 53%', () => {
    const inflado = (s.total_m2 ?? 0) / (s.vivienda_m2 ?? 1) - 1;
    expect(inflado).toBeGreaterThan(0.5);
  });

  it('lista los anejos con su tipo y sus metros', () => {
    expect(s.anejos).toHaveLength(2);
    const garaje = s.anejos.find((a) => a.tipo === 'APARCAMIENTO');
    const trastero = s.anejos.find((a) => a.tipo === 'ALMACEN');
    expect(garaje?.superficie_m2).toBe(26);
    expect(garaje?.planta).toBe('-1');
    expect(trastero?.superficie_m2).toBe(6);
  });

  it('confirma que el desglose cuadra con el total', () => {
    expect(s.desglose_cuadra).toBe(true);
  });

  it('marca el desglose como no cuadrado cuando no suma', () => {
    const s2 = repartirSuperficies(200, [
      { lcd: 'VIVIENDA', dfcons: { stl: '101' } },
      { lcd: 'ELEMENTOS COMUNES', dfcons: { stl: '22' } },
    ]);
    expect(s2.desglose_cuadra).toBe(false);
  });

  it('suma los elementos VIVIENDA cuando hay mas de uno (duplex)', () => {
    const s2 = repartirSuperficies(150, [
      { lcd: 'VIVIENDA', dfcons: { stl: '80' } },
      { lcd: 'VIVIENDA', dfcons: { stl: '50' } },
      { lcd: 'ELEMENTOS COMUNES', dfcons: { stl: '20' } },
    ]);
    expect(s2.vivienda_m2).toBe(130);
    expect(s2.vivienda_con_comunes_m2).toBe(150);
    expect(s2.desglose_cuadra).toBe(true);
  });
});

describe('listado de una parcela', () => {
  const r = parsearDnprc(fixture(PARCELA), 'test');
  if (r.tipo !== 'parcela') throw new Error('una referencia de 14 con division horizontal da listado');

  it('devuelve los 27 inmuebles de la parcela', () => {
    expect(r.parcela.total).toBe(27);
    expect(r.parcela.inmuebles).toHaveLength(27);
    expect(r.parcela.referencia_parcela).toBe('2004930YK5320S');
  });

  it('las cuotas de participacion suman la unidad', () => {
    const suma = r.parcela.inmuebles.reduce((s, i) => s + (i.participacion ?? 0), 0);
    expect(suma).toBeCloseTo(1, 6);
  });

  it('el piso del caso base esta en el listado', () => {
    const piso = r.parcela.inmuebles.find(
      (i) => i.referencia_catastral === '2004930YK5320S0009RH',
    );
    expect(piso?.uso_principal).toBe('Residencial');
    expect(piso?.superficie_total_m2).toBe(155);
    expect(piso?.planta).toBe('01');
  });
});

describe('finca sin division horizontal', () => {
  const r = parsearDnprc(fixture(SIN_DIVISION), 'test');
  if (r.tipo !== 'inmueble') throw new Error('sin division horizontal devuelve ficha directa');

  it('la marca como sin division horizontal', () => {
    // Ojo al literal: aqui el Catastro escribe "division" CON tilde, y en el
    // fixture del piso la escribe SIN ella. Por eso el lector contempla las dos.
    expect(r.ficha.finca.tipo).toBe('Parcela construida sin división horizontal');
    expect(r.ficha.finca.division_horizontal).toBe(false);
  });

  it('la clasifica como rustica', () => {
    expect(r.ficha.clase).toBe('rustica');
    expect(r.ficha.uso_principal).toBe('Industrial agrario');
  });

  it('lee la direccion aunque venga por la rama rustica del arbol', () => {
    // En este caso la direccion cuelga de locs.lors.lourb, no de locs.lous.lourb.
    expect(r.ficha.direccion.via).toBe('SAN LORENZO CUBOS');
    expect(r.ficha.direccion.codigo_postal).toBe('12006');
  });
});

describe('errores', () => {
  it('una referencia mal formada es error de la consulta, no de la fuente', () => {
    expect(() => parsearDnprc(fixture(REFERENCIA_MALA), 'test')).toThrow(ConsultaInvalidaError);
  });

  it('una respuesta sin consulta_dnprcResult para en lugar de adivinar', () => {
    expect(() => parsearDnprc({}, 'test')).toThrow(/consulta_dnprcResult/);
  });
});

describe('lectura de la division horizontal', () => {
  it('decide solo cuando el literal lo dice', () => {
    expect(leerDivisionHorizontal('Parcela con varios inmuebles (division horizontal)')).toBe(true);
    expect(leerDivisionHorizontal('Parcela construida sin division horizontal')).toBe(false);
  });

  it('devuelve null ante un literal que no lo menciona, para que avise y no bloquee', () => {
    expect(leerDivisionHorizontal('Parcela sin construir')).toBeNull();
    expect(leerDivisionHorizontal(null)).toBeNull();
  });
});
