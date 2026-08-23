/**
 * Notariado: EUR/m2 de escritura por codigo postal, en modo MANUAL.
 *
 * Es el primer escalon de la cascada de T1 y el dato mas valioso que existe,
 * porque es precio PAGADO y no precio de oferta ni tasacion.
 *
 * COMPROBADO el 2026-08-23 sobre penotariado.com/inmobiliario: el portal es una
 * aplicacion de mapa sin API documentada, y su propia pagina dice que "se
 * solicita el registro del usuario [...] para acceder a consultas mas detalladas
 * sobre el mercado inmobiliario, asi como para la descarga de informes
 * estadisticos". No hay dataset descargable ni endpoint publico documentado.
 *
 * El brief daba el orden de preferencia: primero dataset o endpoint publico y,
 * si no existe, adaptador de carga manual. Estamos en el segundo caso. No se
 * ingeniería inversa de la API interna del mapa: seria rodear un registro, que
 * es justo lo que el proyecto no hace.
 *
 * Asi que el usuario consulta su codigo postal en el portal y carga la cifra con
 * pnpm notariado:cargar. Este adaptador solo la lee de la base.
 */

import type { PrecioM2Referencia, TipoSuperficie } from '@vp/engine';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '@vp/db';
import { notariadoPrecios } from '@vp/db/schema';

import { SinDatoError } from '../ports';
import type { NotariadoPort, Procedencia, Respuesta } from '../ports';

export const FUENTE_NOTARIADO = 'Notariado (Portal Estadistico, carga manual)';
export const URL_NOTARIADO = 'https://www.penotariado.com/inmobiliario/home';

export const INSTRUCCIONES_NOTARIADO: readonly string[] = [
  `Abre ${URL_NOTARIADO}`,
  'Dibuja tu zona de busqueda sobre el mapa, o busca por codigo postal.',
  'Apunta el precio medio por m2, el periodo al que se refiere y cuantas compraventas lo sustentan.',
  'Mira en la ficha a que superficie se refiere ese EUR/m2 (util o construida): no es lo mismo.',
  'Cargalo con: pnpm notariado:cargar --cp=... --eur-m2=... --periodo=2025Q4 --base=...',
];

export class NotariadoDbAdapter implements NotariadoPort {
  readonly modo = 'manual' as const;

  constructor(private readonly db: Db) {}

  instrucciones(): { url: string; pasos: readonly string[] } {
    return { url: URL_NOTARIADO, pasos: INSTRUCCIONES_NOTARIADO };
  }

  async porCodigoPostal(cp: string): Promise<Respuesta<PrecioM2Referencia>> {
    const filas = await this.db
      .select()
      .from(notariadoPrecios)
      .where(and(eq(notariadoPrecios.cp, cp)))
      .orderBy(desc(notariadoPrecios.periodo))
      .limit(1);

    const fila = filas[0];
    if (fila === undefined) {
      // Que no haya dato es lo normal: solo esta lo que se haya cargado a mano.
      throw new SinDatoError(FUENTE_NOTARIADO, `codigo postal ${cp}`);
    }

    const procedencia: Procedencia = {
      fuente: FUENTE_NOTARIADO,
      url: URL_NOTARIADO,
      fecha_dato: fila.fechaDato,
      obtenido_en: new Date().toISOString(),
      desde_cache: true,
    };

    return {
      datos: {
        eur_m2: Number(fila.eurM2),
        ambito: 'codigo_postal',
        fuente: `${FUENTE_NOTARIADO}, CP ${cp}, ${fila.periodo}`,
        fuente_url: URL_NOTARIADO,
        fecha_dato: fila.fechaDato,
        n_transacciones: fila.nTransacciones,
        p25: fila.p25 === null ? null : Number(fila.p25),
        p75: fila.p75 === null ? null : Number(fila.p75),
        base_superficie: fila.baseSuperficie as TipoSuperficie,
      },
      procedencia,
    };
  }
}
