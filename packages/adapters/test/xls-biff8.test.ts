/**
 * Tests del lector BIFF8.
 *
 * Se prueban dos cosas distintas:
 *
 *   1. La decodificacion de RK y de periodos, con vectores construidos a partir
 *      de la especificacion. Aqui no hay dato inventado: se comprueba que el
 *      decodificador cumple lo que dice [MS-XLS].
 *   2. El fichero REAL de MITMA, cuando esta descargado. No se versiona (4 MB,
 *      excluido por .gitignore), asi que ese bloque se salta con un aviso si no
 *      esta, en lugar de fallar. Se descarga con: pnpm ingest:mitma
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { abrirXls, decodificarRk } from '../src/xls/biff8';
import { FormatoInesperadoError } from '../src/xls/ole2';
import {
  fechaCierreTrimestre,
  leerTablaMunicipal,
  leerTablaTerritorial,
  periodoDeHoja,
  ultimaHojaTrimestral,
} from '../src/mitma/leer-serie';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..', '..');
const XLS_MUNICIPAL = join(RAIZ, 'fixtures', 'mitma', '35103500.XLS');
const XLS_TERRITORIAL = join(RAIZ, 'fixtures', 'mitma', '35101000.XLS');

describe('decodificacion de RK', () => {
  // Los dos bits bajos son banderas: bit1 = entero, bit0 = dividir entre 100.
  it('lee un entero', () => {
    expect(decodificarRk((100 << 2) | 0x02)).toBe(100);
  });

  it('lee un entero negativo', () => {
    expect(decodificarRk((-25 << 2) | 0x02)).toBe(-25);
  });

  it('divide entre cien cuando lo pide la bandera', () => {
    expect(decodificarRk((165660 << 2) | 0x03)).toBeCloseTo(1656.6, 6);
  });

  it('lee la mitad alta de un double', () => {
    // 1656.5 en IEEE754: los 32 bits altos, con los dos bajos a cero.
    const b = Buffer.alloc(8);
    b.writeDoubleLE(1656.5, 0);
    const alto = b.readInt32LE(4) & ~0x03;
    expect(decodificarRk(alto)).toBeCloseTo(1656.5, 6);
  });
});

describe('periodos de MITMA', () => {
  it('traduce el nombre de pestana a periodo', () => {
    expect(periodoDeHoja('T1A2026')).toBe('2026Q1');
    // Las pestanas del fichero real traen espacios de sobra.
    expect(periodoDeHoja('T4A2005  ')).toBe('2005Q4');
  });

  it('para si el nombre de pestana no tiene la forma esperada', () => {
    expect(() => periodoDeHoja('2026')).toThrow(/T<n>A<aaaa>/);
  });

  it('da la fecha de cierre del trimestre, que es la fecha_dato', () => {
    expect(fechaCierreTrimestre('2026Q1')).toBe('2026-03-31');
    expect(fechaCierreTrimestre('2025Q4')).toBe('2025-12-31');
  });
});

describe('contenedor OLE2', () => {
  it('rechaza lo que no es un .xls en vez de devolver basura', () => {
    expect(() => abrirXls(Buffer.from('<html>error</html>'), 'x.xls')).toThrow(
      FormatoInesperadoError,
    );
  });
});

// ---------------------------------------------------------------------------

const hayFicheros = existsSync(XLS_MUNICIPAL) && existsSync(XLS_TERRITORIAL);

describe.skipIf(!hayFicheros)('fichero real de MITMA', () => {
  it('abre el libro municipal y encuentra sus pestanas trimestrales', () => {
    const libro = abrirXls(readFileSync(XLS_MUNICIPAL), '35103500.XLS');
    // Una pestana por trimestre desde T1A2005.
    expect(libro.hojas.length).toBeGreaterThan(80);
    expect(libro.hojas[0]?.trim()).toBe('T1A2005');
    expect(ultimaHojaTrimestral(libro).trim()).toMatch(/^T\dA\d{4}$/);
  });

  it('lee la tabla municipal con sus tres segmentos de antiguedad', () => {
    const libro = abrirXls(readFileSync(XLS_MUNICIPAL), '35103500.XLS');
    const filas = leerTablaMunicipal(libro, ultimaHojaTrimestral(libro));

    // MITMA publica los municipios de mas de 25.000 habitantes: unos 300.
    expect(filas.length).toBeGreaterThan(250);
    expect(filas.length).toBeLessThan(400);

    const castellon = filas.find((f) => /Castell[oó]n de la Plana/i.test(f.municipio));
    expect(castellon?.eurM2MasDeCincoAnios).toBeGreaterThan(500);
    expect(castellon?.tasacionesMasDeCincoAnios).toBeGreaterThan(0);
  });

  it('convierte "n.r" en null y no en cero', () => {
    const libro = abrirXls(readFileSync(XLS_MUNICIPAL), '35103500.XLS');
    const filas = leerTablaMunicipal(libro, ultimaHojaTrimestral(libro));
    // Muchos municipios no tienen muestra suficiente en obra nueva.
    const conNr = filas.filter((f) => f.eurM2HastaCincoAnios === null);
    expect(conNr.length).toBeGreaterThan(0);
    expect(filas.every((f) => f.eurM2HastaCincoAnios !== 0)).toBe(true);
  });

  it('arrastra la provincia, incluso cuando el XLS la coloca mal', () => {
    const libro = abrirXls(readFileSync(XLS_MUNICIPAL), '35103500.XLS');
    const filas = leerTablaMunicipal(libro, ultimaHojaTrimestral(libro));
    const almunecar = filas.find((f) => /Almu.ecar/i.test(f.municipio));
    // Almunecar es de Granada, pero en el fichero cae dentro del bloque de
    // Cordoba. El lector refleja lo que pone el fichero; corregirlo es cosa del
    // emparejamiento por nombre, no de aqui.
    expect(almunecar?.provinciaArrastrada).toBe('Córdoba');
  });

  it('lee la tabla territorial sin confundir las columnas de variacion', () => {
    const libro = abrirXls(readFileSync(XLS_TERRITORIAL), '35101000.XLS');
    const hoja = libro.hojas[libro.hojas.length - 1] as string;
    const { filas, periodo } = leerTablaTerritorial(libro, hoja);

    expect(periodo).toMatch(/^\d{4}Q[1-4]$/);
    // Nacional + 19 CCAA + 50 filas de provincia, con Ceuta y Melilla juntas.
    expect(filas.length).toBeGreaterThan(60);

    // Las dos ultimas columnas de la hoja son "Variación trimestral" y
    // "Variación anual", en porcentaje. Si se colaran, el nacional saldria en
    // torno a 4 o 14 en vez de en miles de euros.
    const nacional = filas.find((f) => /TOTAL NACIONAL/i.test(f.nombre));
    expect(nacional?.eurM2).toBeGreaterThan(1000);
  });
});
