/**
 * Tests del lector de coordenadas, contra los XML reales capturados.
 *
 * Consulta_CPMRC y Consulta_RCCOOR no tienen interfaz JSON: la fachada
 * REST/JSON devuelve HTML de error. Ver la cabecera de parsear-coordenadas.ts.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parsearCoordenadas } from '../src/catastro/parsear-coordenadas';
import { ConsultaInvalidaError, SinDatoError } from '../src/ports';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(AQUI, '..', '..', '..', 'fixtures', 'catastro');

function xml(nombre: string): string {
  return readFileSync(join(FIXTURES, nombre), 'utf8');
}

describe('referencia catastral -> coordenadas (Consulta_CPMRC)', () => {
  const c = parsearCoordenadas(xml('consulta-cpmrc-2004930yk5320s.xml'), 'test');

  it('lee latitud, longitud y sistema de referencia', () => {
    expect(c.srs).toBe('EPSG:4326');
    expect(c.lat).toBeCloseTo(39.98374409339, 9);
    expect(c.lon).toBeCloseTo(-0.049271893410002, 9);
  });

  it('no confunde xcen con la latitud', () => {
    // xcen es la longitud. Invertirlas deja el edificio en mitad del Atlantico.
    expect(c.lat).toBeGreaterThan(35);
    expect(c.lon).toBeLessThan(0);
  });

  it('devuelve la referencia de parcela y la direccion', () => {
    expect(c.referencia_parcela).toBe('2004930YK5320S');
    expect(c.direccion_literal).toContain('LUCENA 39');
  });
});

describe('coordenadas -> referencia catastral (Consulta_RCCOOR)', () => {
  it('cierra el recorrido de ida y vuelta sobre el mismo edificio', () => {
    const ida = parsearCoordenadas(xml('consulta-cpmrc-2004930yk5320s.xml'), 'test');
    const vuelta = parsearCoordenadas(xml('consulta-rccoor-castellon-lucena-39.xml'), 'test');
    expect(vuelta.referencia_parcela).toBe(ida.referencia_parcela);
    expect(vuelta.lat).toBeCloseTo(ida.lat, 9);
  });
});

describe('errores', () => {
  const conError = (cod: string, des: string): string =>
    `<?xml version="1.0" encoding="utf-8"?>
<consulta_coordenadas xmlns="http://www.catastro.meh.es/">
  <control><cucoor>0</cucoor><cuerr>1</cuerr></control>
  <lerr><err><cod>${cod}</cod><des>${des}</des></err></lerr>
</consulta_coordenadas>`;

  it('el error 18 (referencia de 20 posiciones) es culpa de la consulta', () => {
    expect(() =>
      parsearCoordenadas(conError('18', 'LA REFERENCIA CATASTRAL DEBE SER DE 14 POSICIONES'), 'test'),
    ).toThrow(ConsultaInvalidaError);
  });

  it('el error 16 (sin referencia en esas coordenadas) es falta de dato', () => {
    expect(() =>
      parsearCoordenadas(conError('16', 'PARA ESAS COORDENADAS NO HAY REFERENCIA DISPONIBLE'), 'test'),
    ).toThrow(SinDatoError);
  });

  it('una pagina que no es consulta_coordenadas para en lugar de devolver ceros', () => {
    expect(() => parsearCoordenadas('<html><body>error</body></html>', 'test')).toThrow(SinDatoError);
  });

  it('un bloque geo incompleto no se rellena con ceros', () => {
    const truncado = `<consulta_coordenadas><coordenadas><coord>
      <pc><pc1>2004930</pc1><pc2>YK5320S</pc2></pc>
      <geo><xcen>-0.04</xcen></geo>
    </coord></coordenadas></consulta_coordenadas>`;
    expect(() => parsearCoordenadas(truncado, 'test')).toThrow(/xcen, ycen y srs/);
  });
});
