/**
 * Empareja los nombres de municipio de MITMA con el callejero del INE.
 *
 * Hace falta porque la serie 35103500 publica por NOMBRE y la base guarda por
 * codigo INE, que es lo que tambien da el Catastro.
 *
 * Por que no se usa la provincia como clave: la columna de provincia del XLS se
 * arrastra hacia abajo y el fichero real tiene filas fuera de su bloque.
 * Almunecar, que es de Granada, aparece al final del bloque de Cordoba sin
 * etiqueta; lo mismo con Almassora y Benicarlo dentro del de Alicante. Fiarse de
 * ese arrastre mete el EUR/m2 de un municipio en la provincia equivocada sin
 * que nada chille. Asi que se resuelve por nombre, que es unico en 295 de los
 * 306 casos, y la provincia solo desempata.
 *
 * Funcion pura: se prueba sin red y sin base.
 */

/** Una fila del callejero del INE. */
export interface MunicipioIne {
  codigoIne: string;
  nombre: string;
  provincia: string;
}

export interface AliasMunicipio {
  codigo_ine: string;
  nombre_ine: string;
}

export type ResultadoEmparejamiento =
  | { estado: 'unico'; codigoIne: string; nombreIne: string }
  | { estado: 'por_provincia'; codigoIne: string; nombreIne: string }
  | { estado: 'por_alias'; codigoIne: string; nombreIne: string }
  | { estado: 'ambiguo'; candidatos: readonly MunicipioIne[] }
  | { estado: 'sin_casar' };

/** Minusculas, sin tildes y sin puntuacion. */
export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Formas equivalentes de un nombre del INE.
 *
 * El callejero usa tres convenciones que MITMA no sigue:
 *   bilingue      "Alicante/Alacant"      -> "Alicante" y "Alacant"
 *   articulo      "Puerto de Santa Maria, El" -> "El Puerto de Santa Maria"
 *   parentesis    "Coruna (A)"            -> "A Coruna"
 */
export function variantesDelNombre(nombre: string): string[] {
  const salida = new Set<string>();
  for (const trozo of nombre.split('/')) {
    const p = trozo.trim();
    if (p === '') continue;
    salida.add(p);

    const conComa = /^(.*),\s*(.+)$/.exec(p);
    if (conComa !== null) salida.add(`${conComa[2]} ${conComa[1]}`);

    const conParentesis = /^(.*?)\s*\((.+)\)$/.exec(p);
    if (conParentesis !== null) salida.add(`${conParentesis[2]} ${conParentesis[1]}`);
  }
  return [...salida].map(normalizar).filter((v) => v !== '');
}

export class IndiceMunicipios {
  private readonly porNombre = new Map<string, MunicipioIne[]>();
  private readonly porCodigo = new Map<string, MunicipioIne>();

  constructor(municipios: readonly MunicipioIne[]) {
    for (const m of municipios) {
      this.porCodigo.set(m.codigoIne, m);
      for (const v of variantesDelNombre(m.nombre)) {
        const lista = this.porNombre.get(v);
        if (lista === undefined) this.porNombre.set(v, [m]);
        else lista.push(m);
      }
    }
  }

  get tamano(): number {
    return this.porCodigo.size;
  }

  porCodigoIne(codigo: string): MunicipioIne | undefined {
    return this.porCodigo.get(codigo);
  }

  /**
   * @param nombreMitma Nombre tal cual aparece en el XLS.
   * @param provinciaArrastrada Provincia heredada de la columna, solo como desempate.
   * @param alias Tabla de config, indexada por el nombre literal del XLS.
   */
  emparejar(
    nombreMitma: string,
    provinciaArrastrada: string | null,
    alias: Readonly<Record<string, AliasMunicipio>> = {},
  ): ResultadoEmparejamiento {
    // El alias manda: es una correspondencia comprobada a mano.
    const clave = normalizar(nombreMitma);
    for (const [k, v] of Object.entries(alias)) {
      if (k.startsWith('_')) continue;
      if (normalizar(k) === clave) {
        return { estado: 'por_alias', codigoIne: v.codigo_ine, nombreIne: v.nombre_ine };
      }
    }

    const candidatos = [
      ...new Map(
        variantesDelNombre(nombreMitma)
          .flatMap((v) => this.porNombre.get(v) ?? [])
          .map((m) => [m.codigoIne, m] as const),
      ).values(),
    ];

    if (candidatos.length === 0) return { estado: 'sin_casar' };
    if (candidatos.length === 1) {
      const u = candidatos[0] as MunicipioIne;
      return { estado: 'unico', codigoIne: u.codigoIne, nombreIne: u.nombre };
    }

    if (provinciaArrastrada !== null) {
      const pista = normalizar(provinciaArrastrada).split(' ')[0] ?? '';
      const filtrados =
        pista === ''
          ? []
          : candidatos.filter((c) => normalizar(c.provincia).includes(pista));
      if (filtrados.length === 1) {
        const u = filtrados[0] as MunicipioIne;
        return { estado: 'por_provincia', codigoIne: u.codigoIne, nombreIne: u.nombre };
      }
    }

    return { estado: 'ambiguo', candidatos };
  }
}
