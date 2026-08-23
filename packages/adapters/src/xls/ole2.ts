/**
 * Lector del contenedor OLE2 (Compound File Binary Format) que envuelve a un
 * .xls de los de siempre.
 *
 * Solo hace falta una cosa de aqui: sacar el flujo "Workbook" entero. No es un
 * lector general de OLE2 y no pretende serlo.
 */

export class FormatoInesperadoError extends Error {
  override readonly name = 'FormatoInesperadoError';

  constructor(
    readonly fichero: string,
    readonly detalle: string,
  ) {
    super(`${fichero}: ${detalle}`);
  }
}

/** D0 CF 11 E0 A1 B1 1A E1. */
const FIRMA = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const CADENA_LIBRE = 0xffffffff;
const CADENA_FIN = 0xfffffffe;

const TAMANO_ENTRADA_DIRECTORIO = 128;
const TIPO_ENTRADA_FLUJO = 2;
const TIPO_ENTRADA_RAIZ = 5;

interface Cabecera {
  tamanoSector: number;
  tamanoMiniSector: number;
  primerSectorDirectorio: number;
  corteMiniFlujo: number;
  primerSectorMiniFat: number;
  primerSectorDifat: number;
  numeroSectoresDifat: number;
  numeroSectoresFat: number;
}

function leerCabecera(buf: Buffer, fichero: string): Cabecera {
  if (buf.length < 512 || !buf.subarray(0, 8).equals(FIRMA)) {
    throw new FormatoInesperadoError(fichero, 'no empieza por la firma de un fichero OLE2 (.xls)');
  }
  const tamanoSector = 1 << buf.readUInt16LE(0x1e);
  const tamanoMiniSector = 1 << buf.readUInt16LE(0x20);
  if (tamanoSector < 128 || tamanoSector > 65536) {
    throw new FormatoInesperadoError(fichero, `tamano de sector improbable: ${tamanoSector}`);
  }
  return {
    tamanoSector,
    tamanoMiniSector,
    numeroSectoresFat: buf.readUInt32LE(0x2c),
    primerSectorDirectorio: buf.readUInt32LE(0x30),
    corteMiniFlujo: buf.readUInt32LE(0x38),
    primerSectorMiniFat: buf.readUInt32LE(0x3c),
    primerSectorDifat: buf.readUInt32LE(0x44),
    numeroSectoresDifat: buf.readUInt32LE(0x48),
  };
}

/** El sector n empieza justo despues de la cabecera de 512 bytes. */
function offsetSector(n: number, tamanoSector: number): number {
  return (n + 1) * tamanoSector;
}

function leerSector(buf: Buffer, n: number, tamanoSector: number, fichero: string): Buffer {
  const desde = offsetSector(n, tamanoSector);
  const hasta = desde + tamanoSector;
  if (hasta > buf.length) {
    throw new FormatoInesperadoError(fichero, `el sector ${n} se sale del fichero`);
  }
  return buf.subarray(desde, hasta);
}

/** Lista de sectores que forman la FAT, siguiendo el DIFAT. */
function leerDifat(buf: Buffer, cab: Cabecera, fichero: string): number[] {
  const sectores: number[] = [];

  // Los primeros 109 estan en la propia cabecera.
  for (let i = 0; i < 109; i += 1) {
    const v = buf.readUInt32LE(0x4c + i * 4);
    if (v === CADENA_LIBRE || v === CADENA_FIN) break;
    sectores.push(v);
  }

  // El resto encadenados: cada sector DIFAT guarda referencias y, al final, el
  // siguiente sector DIFAT.
  let siguiente = cab.primerSectorDifat;
  let restantes = cab.numeroSectoresDifat;
  while (siguiente !== CADENA_FIN && siguiente !== CADENA_LIBRE && restantes > 0) {
    const s = leerSector(buf, siguiente, cab.tamanoSector, fichero);
    const porSector = cab.tamanoSector / 4 - 1;
    for (let i = 0; i < porSector; i += 1) {
      const v = s.readUInt32LE(i * 4);
      if (v === CADENA_LIBRE || v === CADENA_FIN) continue;
      sectores.push(v);
    }
    siguiente = s.readUInt32LE(cab.tamanoSector - 4);
    restantes -= 1;
  }

  if (sectores.length < cab.numeroSectoresFat) {
    throw new FormatoInesperadoError(
      fichero,
      `la cabecera declara ${cab.numeroSectoresFat} sectores de FAT y solo se han localizado ${sectores.length}`,
    );
  }
  return sectores.slice(0, cab.numeroSectoresFat);
}

function leerFat(buf: Buffer, cab: Cabecera, sectores: readonly number[], fichero: string): Uint32Array {
  const porSector = cab.tamanoSector / 4;
  const fat = new Uint32Array(sectores.length * porSector);
  sectores.forEach((s, indice) => {
    const datos = leerSector(buf, s, cab.tamanoSector, fichero);
    for (let i = 0; i < porSector; i += 1) {
      fat[indice * porSector + i] = datos.readUInt32LE(i * 4);
    }
  });
  return fat;
}

/** Recorre una cadena de sectores y concatena su contenido. */
function seguirCadena(
  buf: Buffer,
  fat: Uint32Array,
  primero: number,
  cab: Cabecera,
  fichero: string,
): Buffer {
  const trozos: Buffer[] = [];
  let actual = primero;
  const vistos = new Set<number>();
  while (actual !== CADENA_FIN && actual !== CADENA_LIBRE) {
    if (vistos.has(actual)) {
      throw new FormatoInesperadoError(fichero, `la cadena de sectores tiene un ciclo en ${actual}`);
    }
    vistos.add(actual);
    trozos.push(leerSector(buf, actual, cab.tamanoSector, fichero));
    const siguiente = fat[actual];
    if (siguiente === undefined) {
      throw new FormatoInesperadoError(fichero, `la FAT no cubre el sector ${actual}`);
    }
    actual = siguiente;
  }
  return Buffer.concat(trozos);
}

interface EntradaDirectorio {
  nombre: string;
  tipo: number;
  primerSector: number;
  tamano: number;
}

function leerDirectorio(directorio: Buffer): EntradaDirectorio[] {
  const entradas: EntradaDirectorio[] = [];
  for (let off = 0; off + TAMANO_ENTRADA_DIRECTORIO <= directorio.length; off += TAMANO_ENTRADA_DIRECTORIO) {
    const longitudNombre = directorio.readUInt16LE(off + 0x40);
    const tipo = directorio.readUInt8(off + 0x42);
    if (tipo !== TIPO_ENTRADA_FLUJO && tipo !== TIPO_ENTRADA_RAIZ) continue;
    // El nombre es UTF-16LE e incluye el terminador en la longitud.
    const nombre =
      longitudNombre > 2
        ? directorio.subarray(off, off + longitudNombre - 2).toString('utf16le')
        : '';
    entradas.push({
      nombre,
      tipo,
      primerSector: directorio.readUInt32LE(off + 0x74),
      // El tamano es de 64 bits; en la practica de un .xls cabe de sobra en 32.
      tamano: directorio.readUInt32LE(off + 0x78),
    });
  }
  return entradas;
}

/**
 * Devuelve el contenido de un flujo del contenedor, por nombre.
 *
 * Un .xls de Excel 97-2003 llama a su flujo principal "Workbook"; los de Excel
 * 5.0 lo llamaban "Book". Se aceptan los dos porque cuesta una linea.
 */
export function leerFlujoOle2(
  buf: Buffer,
  nombres: readonly string[],
  fichero = 'fichero',
): Buffer {
  const cab = leerCabecera(buf, fichero);
  const fat = leerFat(buf, cab, leerDifat(buf, cab, fichero), fichero);
  const directorio = leerDirectorio(seguirCadena(buf, fat, cab.primerSectorDirectorio, cab, fichero));

  const raiz = directorio.find((e) => e.tipo === TIPO_ENTRADA_RAIZ);
  const entrada = directorio.find((e) => e.tipo === TIPO_ENTRADA_FLUJO && nombres.includes(e.nombre));

  if (entrada === undefined) {
    const disponibles = directorio.map((e) => e.nombre).filter((n) => n !== '');
    throw new FormatoInesperadoError(
      fichero,
      `no contiene ningun flujo llamado ${nombres.join(' ni ')}. Los que hay: ${disponibles.join(', ')}`,
    );
  }

  // Los flujos por debajo del corte viven en el mini-flujo, que a su vez es el
  // flujo de la entrada raiz. Un libro de Excel real nunca cae aqui, pero
  // resolverlo cuesta poco y evita un fallo raro el dia que ocurra.
  if (entrada.tamano < cab.corteMiniFlujo) {
    if (raiz === undefined) {
      throw new FormatoInesperadoError(fichero, 'flujo corto sin entrada raiz para el mini-flujo');
    }
    const miniFlujo = seguirCadena(buf, fat, raiz.primerSector, cab, fichero);
    const miniFat = leerMiniFat(buf, fat, cab, fichero);
    return seguirCadenaMini(miniFlujo, miniFat, entrada.primerSector, cab, fichero).subarray(
      0,
      entrada.tamano,
    );
  }

  return seguirCadena(buf, fat, entrada.primerSector, cab, fichero).subarray(0, entrada.tamano);
}

function leerMiniFat(buf: Buffer, fat: Uint32Array, cab: Cabecera, fichero: string): Uint32Array {
  if (cab.primerSectorMiniFat === CADENA_FIN) return new Uint32Array(0);
  const datos = seguirCadena(buf, fat, cab.primerSectorMiniFat, cab, fichero);
  const mini = new Uint32Array(datos.length / 4);
  for (let i = 0; i < mini.length; i += 1) mini[i] = datos.readUInt32LE(i * 4);
  return mini;
}

function seguirCadenaMini(
  miniFlujo: Buffer,
  miniFat: Uint32Array,
  primero: number,
  cab: Cabecera,
  fichero: string,
): Buffer {
  const trozos: Buffer[] = [];
  let actual = primero;
  const vistos = new Set<number>();
  while (actual !== CADENA_FIN && actual !== CADENA_LIBRE) {
    if (vistos.has(actual)) {
      throw new FormatoInesperadoError(fichero, `ciclo en la mini-FAT en ${actual}`);
    }
    vistos.add(actual);
    const desde = actual * cab.tamanoMiniSector;
    trozos.push(miniFlujo.subarray(desde, desde + cab.tamanoMiniSector));
    const siguiente = miniFat[actual];
    if (siguiente === undefined) {
      throw new FormatoInesperadoError(fichero, `la mini-FAT no cubre el sector ${actual}`);
    }
    actual = siguiente;
  }
  return Buffer.concat(trozos);
}
