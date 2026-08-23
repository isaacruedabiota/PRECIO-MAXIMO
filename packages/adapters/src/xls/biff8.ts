/**
 * Lector BIFF8: las celdas de un .xls de Excel 97-2003.
 *
 * Por que a mano y no con una libreria: la unica de npm que lee BIFF8 es
 * SheetJS, y la version publicada en npm arrastra un prototype pollution
 * (CVE-2023-30533) cuyo arreglo no esta en el registro. Como aqui se parsea un
 * fichero DESCARGADO de internet, eso es justo el escenario del fallo. El
 * formato, en cambio, lleva congelado desde 1997 y de el solo hacen falta seis
 * tipos de registro.
 *
 * Lo que se lee: nombres y posiciones de las hojas, la tabla de cadenas
 * compartidas y las celdas de texto y numero. Lo que NO: formulas sin resultado
 * cacheado, formatos, graficos y cualquier cosa que no sea un valor.
 *
 * Referencia: [MS-XLS], seccion 2.4 (records) y 2.5.293 (XLUnicodeString).
 */

import { FormatoInesperadoError, leerFlujoOle2 } from './ole2';

// --- Tipos de registro que se usan --------------------------------------
const BOF = 0x0809;
const EOF_REC = 0x000a;
const BOUNDSHEET = 0x0085;
const SST = 0x00fc;
const CONTINUE = 0x003c;
const LABELSST = 0x00fd;
const LABEL = 0x0204;
const NUMBER = 0x0203;
const RK = 0x027e;
const MULRK = 0x00bd;
const FORMULA = 0x0006;
const STRING = 0x0207;

/** Tipo de subflujo declarado en el BOF. */
const BOF_HOJA = 0x0010;

export type ValorCelda = string | number | null;

export interface HojaXls {
  nombre: string;
  /** filas[fila][columna]. Dispersa: puede haber huecos. */
  filas: ValorCelda[][];
}

// ---------------------------------------------------------------------------
// Recorrido de registros
// ---------------------------------------------------------------------------

interface Registro {
  tipo: number;
  datos: Buffer;
  /** Offset del registro dentro del flujo, que es lo que apunta BOUNDSHEET. */
  offset: number;
}

function* registros(flujo: Buffer, desde = 0): Generator<Registro> {
  let off = desde;
  while (off + 4 <= flujo.length) {
    const tipo = flujo.readUInt16LE(off);
    const longitud = flujo.readUInt16LE(off + 2);
    const fin = off + 4 + longitud;
    if (fin > flujo.length) return;
    yield { tipo, datos: flujo.subarray(off + 4, fin), offset: off };
    off = fin;
  }
}

// ---------------------------------------------------------------------------
// Numeros
// ---------------------------------------------------------------------------

/**
 * Un RK empaqueta un numero en 32 bits. Los dos bits bajos son banderas: el 0
 * dice que el valor va multiplicado por 100 y el 1 que es entero en lugar de la
 * mitad alta de un double.
 */
export function decodificarRk(rk: number): number {
  const porCien = (rk & 0x01) !== 0;
  const entero = (rk & 0x02) !== 0;
  let valor: number;
  if (entero) {
    // 30 bits con signo.
    valor = rk >> 2;
  } else {
    const b = Buffer.alloc(8);
    b.writeInt32LE(0, 0);
    b.writeInt32LE(rk & ~0x03, 4);
    valor = b.readDoubleLE(0);
  }
  return porCien ? valor / 100 : valor;
}

// ---------------------------------------------------------------------------
// Tabla de cadenas compartidas (SST)
// ---------------------------------------------------------------------------

/**
 * Lector sobre SST + sus CONTINUE.
 *
 * La parte fea del formato: una cadena puede partirse entre dos registros, y al
 * cruzar a un CONTINUE el primer byte NO es texto sino una bandera que dice si
 * lo que queda viene comprimido (1 byte por caracter) o en UTF-16. Sin eso, el
 * texto sale corrido a partir de la primera frontera.
 */
class LectorSst {
  private segmento = 0;
  private off = 0;

  constructor(private readonly segmentos: readonly Buffer[]) {}

  private actual(): Buffer {
    const s = this.segmentos[this.segmento];
    if (s === undefined) throw new FormatoInesperadoError('SST', 'se ha agotado la tabla de cadenas');
    return s;
  }

  /** true si el segmento actual se ha consumido y hay otro detras. */
  private avanzarSiHaceFalta(): boolean {
    while (this.off >= this.actual().length) {
      if (this.segmento + 1 >= this.segmentos.length) {
        throw new FormatoInesperadoError('SST', 'la tabla de cadenas termina antes de tiempo');
      }
      this.segmento += 1;
      this.off = 0;
      return true;
    }
    return false;
  }

  u8(): number {
    this.avanzarSiHaceFalta();
    const v = this.actual().readUInt8(this.off);
    this.off += 1;
    return v;
  }

  u16(): number {
    this.avanzarSiHaceFalta();
    const v = this.actual().readUInt16LE(this.off);
    this.off += 2;
    return v;
  }

  u32(): number {
    this.avanzarSiHaceFalta();
    const v = this.actual().readUInt32LE(this.off);
    this.off += 4;
    return v;
  }

  saltar(n: number): void {
    let quedan = n;
    while (quedan > 0) {
      this.avanzarSiHaceFalta();
      const disponible = this.actual().length - this.off;
      const paso = Math.min(disponible, quedan);
      this.off += paso;
      quedan -= paso;
    }
  }

  /** Lee cch caracteres respetando los cambios de codificacion en cada CONTINUE. */
  caracteres(cch: number, anchoDoble: boolean): string {
    let doble = anchoDoble;
    let quedan = cch;
    const trozos: string[] = [];

    while (quedan > 0) {
      const cambioDeSegmento = this.avanzarSiHaceFalta();
      if (cambioDeSegmento) {
        // Primer byte del CONTINUE: la bandera de codificacion del resto.
        doble = (this.actual().readUInt8(this.off) & 0x01) !== 0;
        this.off += 1;
        continue;
      }

      const buf = this.actual();
      const disponibleBytes = buf.length - this.off;
      const anchoBytes = doble ? 2 : 1;
      const cabenAqui = Math.min(quedan, Math.floor(disponibleBytes / anchoBytes));

      if (cabenAqui === 0) {
        // Queda un byte suelto de un caracter de dos: se fuerza el salto.
        this.off = buf.length;
        continue;
      }

      const desde = this.off;
      const hasta = desde + cabenAqui * anchoBytes;
      trozos.push(
        doble
          ? buf.subarray(desde, hasta).toString('utf16le')
          : // El modo comprimido es latin1 en el rango bajo de Unicode.
            buf.subarray(desde, hasta).toString('latin1'),
      );
      this.off = hasta;
      quedan -= cabenAqui;
    }

    return trozos.join('');
  }
}

function leerSst(segmentos: readonly Buffer[]): string[] {
  const r = new LectorSst(segmentos);
  r.u32(); // total de referencias, no hace falta
  const unicas = r.u32();

  const cadenas: string[] = [];
  for (let i = 0; i < unicas; i += 1) {
    const cch = r.u16();
    const banderas = r.u8();
    const anchoDoble = (banderas & 0x01) !== 0;
    const rica = (banderas & 0x08) !== 0;
    const extendida = (banderas & 0x04) !== 0;

    const cRun = rica ? r.u16() : 0;
    const cbExt = extendida ? r.u32() : 0;

    cadenas.push(r.caracteres(cch, anchoDoble));

    if (cRun > 0) r.saltar(cRun * 4);
    if (cbExt > 0) r.saltar(cbExt);
  }
  return cadenas;
}

/** XLUnicodeString con longitud de 1 byte, como la del nombre de hoja. */
function leerCadenaCorta(datos: Buffer, off: number): { texto: string; siguiente: number } {
  const cch = datos.readUInt8(off);
  const banderas = datos.readUInt8(off + 1);
  const doble = (banderas & 0x01) !== 0;
  const bytes = cch * (doble ? 2 : 1);
  const trozo = datos.subarray(off + 2, off + 2 + bytes);
  return {
    texto: doble ? trozo.toString('utf16le') : trozo.toString('latin1'),
    siguiente: off + 2 + bytes,
  };
}

// ---------------------------------------------------------------------------
// Entrada publica
// ---------------------------------------------------------------------------

interface Boundsheet {
  nombre: string;
  offsetBof: number;
}

function ponerCelda(filas: ValorCelda[][], fila: number, columna: number, valor: ValorCelda): void {
  let f = filas[fila];
  if (f === undefined) {
    f = [];
    filas[fila] = f;
  }
  f[columna] = valor;
}

function leerHoja(flujo: Buffer, hoja: Boundsheet, sst: readonly string[]): HojaXls {
  const filas: ValorCelda[][] = [];
  let esperandoCadenaDeFormula: { fila: number; columna: number } | null = null;

  for (const reg of registros(flujo, hoja.offsetBof)) {
    // El primer registro es el BOF de la hoja; el EOF cierra el subflujo.
    if (reg.tipo === EOF_REC) break;
    const d = reg.datos;

    switch (reg.tipo) {
      case LABELSST: {
        const indice = d.readUInt32LE(6);
        ponerCelda(filas, d.readUInt16LE(0), d.readUInt16LE(2), sst[indice] ?? null);
        break;
      }
      case LABEL: {
        const { texto } = leerCadenaCorta(d, 6);
        ponerCelda(filas, d.readUInt16LE(0), d.readUInt16LE(2), texto);
        break;
      }
      case NUMBER: {
        ponerCelda(filas, d.readUInt16LE(0), d.readUInt16LE(2), d.readDoubleLE(6));
        break;
      }
      case RK: {
        ponerCelda(filas, d.readUInt16LE(0), d.readUInt16LE(2), decodificarRk(d.readUInt32LE(6)));
        break;
      }
      case MULRK: {
        const fila = d.readUInt16LE(0);
        const primera = d.readUInt16LE(2);
        // (xf u16 + rk u32) por celda, y al final la ultima columna en u16.
        const cuantas = (d.length - 6) / 6;
        for (let i = 0; i < cuantas; i += 1) {
          const rk = d.readUInt32LE(4 + i * 6 + 2);
          ponerCelda(filas, fila, primera + i, decodificarRk(rk));
        }
        break;
      }
      case FORMULA: {
        const fila = d.readUInt16LE(0);
        const columna = d.readUInt16LE(2);
        // Si los dos ultimos bytes del resultado son FFFF, el valor no es un
        // numero: viene en el registro siguiente o es booleano/error.
        if (d.readUInt16LE(12) === 0xffff) {
          if (d.readUInt8(6) === 0x00) {
            esperandoCadenaDeFormula = { fila, columna };
          } else {
            ponerCelda(filas, fila, columna, null);
          }
        } else {
          ponerCelda(filas, fila, columna, d.readDoubleLE(6));
        }
        break;
      }
      case STRING: {
        if (esperandoCadenaDeFormula !== null) {
          const cch = d.readUInt16LE(0);
          const doble = (d.readUInt8(2) & 0x01) !== 0;
          const trozo = d.subarray(3, 3 + cch * (doble ? 2 : 1));
          ponerCelda(
            filas,
            esperandoCadenaDeFormula.fila,
            esperandoCadenaDeFormula.columna,
            doble ? trozo.toString('utf16le') : trozo.toString('latin1'),
          );
          esperandoCadenaDeFormula = null;
        }
        break;
      }
      default:
        break;
    }
  }

  return { nombre: hoja.nombre, filas };
}

export interface LibroXls {
  hojas: readonly string[];
  hoja(nombre: string): HojaXls;
}

/**
 * Abre un .xls y devuelve un lector perezoso: los nombres de hoja salen de
 * inmediato y las celdas solo se recorren cuando se piden, que con 80 hojas
 * trimestrales importa.
 */
export function abrirXls(contenido: Buffer, fichero = 'fichero.xls'): LibroXls {
  const flujo = leerFlujoOle2(contenido, ['Workbook', 'Book'], fichero);

  const boundsheets: Boundsheet[] = [];
  const segmentosSst: Buffer[] = [];
  let enSst = false;

  for (const reg of registros(flujo)) {
    if (reg.tipo === BOUNDSHEET) {
      const offsetBof = reg.datos.readUInt32LE(0);
      const { texto } = leerCadenaCorta(reg.datos, 6);
      boundsheets.push({ nombre: texto, offsetBof });
      continue;
    }
    if (reg.tipo === SST) {
      segmentosSst.push(reg.datos);
      enSst = true;
      continue;
    }
    if (reg.tipo === CONTINUE && enSst) {
      segmentosSst.push(reg.datos);
      continue;
    }
    if (reg.tipo === BOF && reg.offset > 0) {
      // Empieza el primer subflujo de hoja: los globales han terminado.
      const tipoBof = reg.datos.length >= 4 ? reg.datos.readUInt16LE(2) : 0;
      if (tipoBof === BOF_HOJA) break;
    }
    if (reg.tipo !== SST && reg.tipo !== CONTINUE) enSst = false;
  }

  if (boundsheets.length === 0) {
    throw new FormatoInesperadoError(fichero, 'no declara ninguna hoja (sin registros BOUNDSHEET)');
  }

  const sst = segmentosSst.length > 0 ? leerSst(segmentosSst) : [];

  return {
    hojas: boundsheets.map((b) => b.nombre),
    hoja(nombre: string): HojaXls {
      const b = boundsheets.find((x) => x.nombre === nombre);
      if (b === undefined) {
        throw new FormatoInesperadoError(
          fichero,
          `no tiene ninguna hoja "${nombre}". Las que hay: ${boundsheets.map((x) => x.nombre).join(', ')}`,
        );
      }
      return leerHoja(flujo, b, sst);
    },
  };
}

export { FormatoInesperadoError } from './ole2';
