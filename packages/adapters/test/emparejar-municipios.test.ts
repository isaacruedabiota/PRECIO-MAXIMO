/**
 * Tests del emparejamiento MITMA -> callejero del INE.
 *
 * Los casos no son inventados: todos salen de nombres que aparecen de verdad en
 * la serie 35103500 y en la variable 19 del INE.
 */

import { describe, expect, it } from 'vitest';

import {
  IndiceMunicipios,
  normalizar,
  variantesDelNombre,
} from '../src/mitma/emparejar-municipios';
import type { MunicipioIne } from '../src/mitma/emparejar-municipios';

const CALLEJERO: MunicipioIne[] = [
  { codigoIne: '12040', nombre: 'Castelló de la Plana/Castellón de la Plana', provincia: 'Castellón/Castelló' },
  { codigoIne: '12009', nombre: 'Almassora/Almazora', provincia: 'Castellón/Castelló' },
  { codigoIne: '11027', nombre: 'Puerto de Santa María, El', provincia: 'Cádiz' },
  { codigoIne: '15030', nombre: 'Coruña, A', provincia: 'Coruña, A' },
  { codigoIne: '18017', nombre: 'Almuñécar', provincia: 'Granada' },
  { codigoIne: '01059', nombre: 'Vitoria-Gasteiz', provincia: 'Araba/Álava' },
  // Dos municipios homonimos en provincias distintas: el caso que obliga a
  // desempatar. Ambos existen.
  { codigoIne: '37274', nombre: 'Salamanca', provincia: 'Salamanca' },
  { codigoIne: '28079', nombre: 'Madrid', provincia: 'Madrid' },
  { codigoIne: '19171', nombre: 'Madrid', provincia: 'Guadalajara' },
];

const ALIAS = {
  _doc: 'ignorado',
  'Puerto de Santa Maria': { codigo_ine: '11027', nombre_ine: 'Puerto de Santa María, El' },
  Vitoria: { codigo_ine: '01059', nombre_ine: 'Vitoria-Gasteiz' },
} as unknown as Record<string, { codigo_ine: string; nombre_ine: string }>;

const indice = new IndiceMunicipios(CALLEJERO);

describe('variantes de un nombre del INE', () => {
  it('parte los nombres bilingues', () => {
    expect(variantesDelNombre('Castelló de la Plana/Castellón de la Plana')).toContain(
      'castellon de la plana',
    );
    expect(variantesDelNombre('Castelló de la Plana/Castellón de la Plana')).toContain(
      'castello de la plana',
    );
  });

  it('reordena el articulo pospuesto con coma', () => {
    expect(variantesDelNombre('Puerto de Santa María, El')).toContain('el puerto de santa maria');
  });

  it('reordena el articulo entre parentesis', () => {
    expect(variantesDelNombre('Coruña (A)')).toContain('a coruna');
  });

  it('quita tildes y puntuacion', () => {
    expect(normalizar('Almuñécar')).toBe('almunecar');
  });
});

describe('emparejamiento', () => {
  it('casa un nombre unico sin necesitar la provincia', () => {
    const r = indice.emparejar('Castellón de la Plana', null);
    expect(r.estado).toBe('unico');
    if (r.estado === 'unico') expect(r.codigoIne).toBe('12040');
  });

  it('casa la otra mitad del nombre bilingue', () => {
    const r = indice.emparejar('Almazora/Almassora', 'Alicante');
    expect(r.estado).toBe('unico');
    if (r.estado === 'unico') expect(r.codigoIne).toBe('12009');
  });

  it('no se deja llevar por la provincia equivocada del XLS', () => {
    // Almunecar es de Granada y MITMA lo pone al final del bloque de Cordoba.
    const r = indice.emparejar('Almuñecar', 'Córdoba');
    expect(r.estado).toBe('unico');
    if (r.estado === 'unico') expect(r.codigoIne).toBe('18017');
  });

  it('usa la provincia solo para desempatar homonimos', () => {
    const r = indice.emparejar('Madrid', 'Guadalajara');
    expect(r.estado).toBe('por_provincia');
    if (r.estado === 'por_provincia') expect(r.codigoIne).toBe('19171');
  });

  it('declara ambiguo lo que no puede desempatar, en vez de elegir', () => {
    const r = indice.emparejar('Madrid', null);
    expect(r.estado).toBe('ambiguo');
    if (r.estado === 'ambiguo') expect(r.candidatos).toHaveLength(2);
  });

  it('resuelve por alias lo que el callejero no reconoce', () => {
    const r = indice.emparejar('Puerto de Santa María', 'Cádiz', ALIAS);
    expect(r.estado).toBe('por_alias');
    if (r.estado === 'por_alias') expect(r.codigoIne).toBe('11027');
  });

  it('el alias manda sobre la busqueda por nombre', () => {
    const r = indice.emparejar('Vitoria', 'Araba/Alava', ALIAS);
    expect(r.estado).toBe('por_alias');
    if (r.estado === 'por_alias') expect(r.codigoIne).toBe('01059');
  });

  it('ignora las claves de documentacion de la tabla de alias', () => {
    const r = indice.emparejar('_doc', null, ALIAS);
    expect(r.estado).toBe('sin_casar');
  });

  it('declara sin casar lo que no encuentra, en vez de aproximar', () => {
    expect(indice.emparejar('Villa Inventada del Monte', 'Soria').estado).toBe('sin_casar');
  });
});
