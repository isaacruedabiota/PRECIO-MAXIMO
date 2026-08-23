'use client';

/**
 * Formulario de valoracion, en dos pasos.
 *
 * Paso 1: la referencia catastral. De ahi salen direccion, superficie, ano,
 * anejos y division horizontal, asi que no se preguntan.
 *
 * Paso 2: solo lo que el Catastro NO publica. Son catorce campos, y son
 * justamente los que mas mueven T1: ascensor, orientacion, estado y certificado
 * energetico. Rellenarlos con valores por defecto seria inventar, asi que se
 * piden, y los que no se sepan se dejan en blanco para que el motor avise en
 * lugar de suponer.
 */

import { useState, useTransition } from 'react';

import type { Expediente } from '@vp/adapters';

import { buscarFicha, calcular } from './actions';
import type { ResultadoBusqueda, ResultadoCalculo } from './actions';
import { Resultado } from './resultado';

const ORIENTACIONES = [
  'desconocida',
  'norte',
  'sur',
  'este',
  'oeste',
  'noreste',
  'noroeste',
  'sureste',
  'suroeste',
] as const;

const ESTADOS = [
  ['a_reformar', 'A reformar'],
  ['buen_estado', 'Buen estado'],
  ['reformado_reciente', 'Reformado recientemente'],
] as const;

const NIVELES_REFORMA = [
  ['', 'Sin reforma prevista'],
  ['lavado_de_cara', 'Lavado de cara'],
  ['reforma_parcial', 'Reforma parcial'],
  ['reforma_integral', 'Reforma integral'],
  ['integral_premium', 'Integral premium'],
] as const;

const CEE = ['', 'A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;

const ESTADOS_ITE = [
  ['desconocido', 'No lo se'],
  ['no_aplica', 'No le toca todavia'],
  ['favorable', 'Pasada y favorable'],
  ['desfavorable', 'Pasada y desfavorable'],
  ['no_pasada', 'Le tocaba y no la ha pasado'],
] as const;

// ---------------------------------------------------------------------------

function Campo({
  etiqueta,
  ayuda,
  children,
}: {
  etiqueta: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium">{etiqueta}</span>
      {ayuda !== undefined && (
        <span className="block text-xs text-(--color-tenue)">{ayuda}</span>
      )}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

const clasesEntrada =
  'w-full rounded-md border border-(--color-borde) bg-transparent px-3 py-2 text-sm ' +
  'focus:border-(--color-acento) focus:outline-none';

function Numero({
  valor,
  onChange,
  placeholder,
  min,
  step,
}: {
  valor: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  min?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      className={clasesEntrada}
      value={valor ?? ''}
      min={min}
      step={step}
      placeholder={placeholder}
      onChange={(e) => {
        // Vacio es null, no cero. Un cero silencioso en el ahorro o en el IBI
        // cambia el resultado sin que nadie lo haya dicho.
        onChange(e.target.value === '' ? null : Number(e.target.value));
      }}
    />
  );
}

function Casilla({
  etiqueta,
  ayuda,
  valor,
  onChange,
}: {
  etiqueta: string;
  ayuda?: string;
  valor: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={valor}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
      <span>
        {etiqueta}
        {ayuda !== undefined && (
          <span className="block text-xs text-(--color-tenue)">{ayuda}</span>
        )}
      </span>
    </label>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-(--color-borde) p-4">
      <legend className="px-2 text-sm font-medium uppercase tracking-wide text-(--color-tenue)">
        {titulo}
      </legend>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function ErrorCaja({ mensaje, sugerencia }: { mensaje: string; sugerencia: string | null }) {
  return (
    <div
      role="alert"
      className="rounded-lg border-2 border-(--color-alerta) bg-(--color-alerta)/5 p-4"
    >
      <p className="text-sm">{mensaje}</p>
      {sugerencia !== null && (
        <p className="mt-2 text-xs text-(--color-tenue)">{sugerencia}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Formulario() {
  const [rc, setRc] = useState('');
  const [busqueda, setBusqueda] = useState<ResultadoBusqueda | null>(null);
  const [expediente, setExpediente] = useState<Expediente | null>(null);
  const [calculo, setCalculo] = useState<ResultadoCalculo | null>(null);
  const [pendiente, empezar] = useTransition();

  function buscar(referencia: string): void {
    setCalculo(null);
    empezar(async () => {
      const r = await buscarFicha(referencia);
      setBusqueda(r);
      setExpediente(r.estado === 'inmueble' ? r.expediente : null);
    });
  }

  function editarPiso<K extends keyof Expediente['piso']>(
    campo: K,
    valor: Expediente['piso'][K],
  ): void {
    setExpediente((e) => (e === null ? e : { ...e, piso: { ...e.piso, [campo]: valor } }));
  }

  function editarComprador<K extends keyof Expediente['comprador']>(
    campo: K,
    valor: Expediente['comprador'][K],
  ): void {
    setExpediente((e) =>
      e === null ? e : { ...e, comprador: { ...e.comprador, [campo]: valor } },
    );
  }

  function editarRiesgo<K extends keyof Expediente['riesgos']>(
    campo: K,
    valor: Expediente['riesgos'][K],
  ): void {
    setExpediente((e) => (e === null ? e : { ...e, riesgos: { ...e.riesgos, [campo]: valor } }));
  }

  return (
    <div className="space-y-8">
      {/* --- Paso 1 --- */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const limpia = rc.replace(/[\s.-]/g, '').toUpperCase();
          // Se valida al enviar y NO deshabilitando el boton. Un boton
          // deshabilitado desde el HTML del servidor se queda muerto si la
          // pagina todavia no ha hidratado, y desde fuera eso parece que la
          // aplicacion esta rota.
          if (limpia.length !== 14 && limpia.length !== 20) {
            setBusqueda({
              estado: 'error',
              mensaje:
                limpia === ''
                  ? 'Escribe una referencia catastral.'
                  : `"${rc}" tiene ${limpia.length} caracteres. Una referencia catastral tiene 20 (un piso) o 14 (la parcela entera).`,
              sugerencia: 'La encuentras en el recibo del IBI, en la nota simple o en la escritura.',
            });
            return;
          }
          buscar(limpia);
        }}
        className="space-y-3"
      >
        {/*
          El boton va FUERA del <label>. Dentro, el navegador reenvia el clic al
          primer control etiquetable del label —el input— y el boton no llega a
          activarse nunca. Por eso aqui no se usa <Campo>.
        */}
        <label className="block" htmlFor="referencia-catastral">
          <span className="block text-sm font-medium">Referencia catastral</span>
          <span className="block text-xs text-(--color-tenue)">
            20 caracteres para un piso, 14 para la parcela entera. Sale en el recibo del IBI o
            en la nota simple.
          </span>
        </label>
        <div className="flex gap-2">
          <input
            id="referencia-catastral"
            name="referencia-catastral"
            className={clasesEntrada}
            value={rc}
            autoComplete="off"
            spellCheck={false}
            placeholder="2004930YK5320S0009RH"
            onChange={(e) => {
              setRc(e.target.value);
            }}
          />
          <button
            type="submit"
            disabled={pendiente}
            className="rounded-md bg-(--color-acento) px-4 py-2 text-sm font-medium whitespace-nowrap text-white disabled:opacity-40"
          >
            {pendiente ? 'Buscando…' : 'Buscar'}
          </button>
        </div>
      </form>

      {busqueda?.estado === 'error' && (
        <ErrorCaja mensaje={busqueda.mensaje} sugerencia={busqueda.sugerencia} />
      )}

      {/* La referencia era de parcela: se listan sus inmuebles para elegir. */}
      {busqueda?.estado === 'parcela' && (
        <section className="rounded-lg border border-(--color-borde) p-4">
          <p className="text-sm">
            Esa referencia es de la parcela entera, con {busqueda.parcela.total} inmuebles.
            Elige el piso:
          </p>
          <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto">
            {busqueda.parcela.inmuebles.map((i) => (
              <li key={i.referencia_catastral}>
                <button
                  type="button"
                  onClick={() => {
                    setRc(i.referencia_catastral);
                    buscar(i.referencia_catastral);
                  }}
                  className="w-full rounded px-2 py-1 text-left text-sm hover:bg-(--color-borde)/40"
                >
                  <code className="text-xs">{i.referencia_catastral}</code>{' '}
                  {[
                    i.escalera === null ? null : `Es ${i.escalera}`,
                    i.planta === null ? null : `Pl ${i.planta}`,
                    i.puerta === null ? null : `Pt ${i.puerta}`,
                  ]
                    .filter((x) => x !== null)
                    .join(' ')}{' '}
                  <span className="text-(--color-tenue)">
                    {i.superficie_total_m2 ?? '?'} m² · {i.uso_principal ?? '?'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- La ficha --- */}
      {busqueda?.estado === 'inmueble' && expediente !== null && (
        <>
          <section className="rounded-lg border border-(--color-borde) p-4">
            <h2 className="text-sm font-medium uppercase tracking-wide text-(--color-tenue)">
              Lo que dice el Catastro
            </h2>
            <p className="mt-2 text-sm">{busqueda.ficha.direccion.literal}</p>
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <Dato
                etiqueta="Superficie de la vivienda"
                valor={
                  busqueda.ficha.superficies.vivienda_m2 === null
                    ? '(no consta)'
                    : `${busqueda.ficha.superficies.vivienda_m2} m² construidos`
                }
              />
              <Dato
                etiqueta="Ano de construccion"
                valor={busqueda.ficha.anio_construccion ?? '(no consta)'}
              />
              <Dato etiqueta="Planta" valor={busqueda.ficha.direccion.planta ?? '(no consta)'} />
              <Dato etiqueta="Uso" valor={busqueda.ficha.uso_principal ?? '(no consta)'} />
              <Dato
                etiqueta="Anejos"
                valor={
                  busqueda.ficha.superficies.anejos.length === 0
                    ? 'ninguno'
                    : busqueda.ficha.superficies.anejos
                        .map((a) => `${a.tipo.toLowerCase()} ${a.superficie_m2} m²`)
                        .join(', ')
                }
              />
              <Dato
                etiqueta="Division horizontal"
                valor={
                  busqueda.ficha.finca.division_horizontal === null
                    ? 'no se puede decidir'
                    : busqueda.ficha.finca.division_horizontal
                      ? 'si'
                      : 'NO'
                }
              />
            </dl>
            {busqueda.avisos.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-(--color-tenue)">
                {busqueda.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
          </section>

          {/* --- Paso 2 --- */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              empezar(async () => {
                setCalculo(await calcular(expediente));
              });
            }}
            className="space-y-6"
          >
            <p className="text-sm text-(--color-tenue)">
              Lo que sigue es lo que el Catastro no publica, y es lo que mas mueve el
              resultado. Lo que no sepas, dejalo en blanco: el motor prefiere avisar a
              suponer.
            </p>

            <Seccion titulo="El piso">
              <Casilla
                etiqueta="Tiene ascensor"
                valor={expediente.piso.ascensor}
                onChange={(v) => {
                  editarPiso('ascensor', v);
                }}
              />
              <Casilla
                etiqueta="Es atico"
                ayuda="El Catastro no lo dice: haria falta saber cual es la ultima planta."
                valor={expediente.piso.es_atico}
                onChange={(v) => {
                  editarPiso('es_atico', v);
                }}
              />
              <Campo etiqueta="Situacion" ayuda="Un interior vale menos por luz, no por metros.">
                <select
                  className={clasesEntrada}
                  value={expediente.piso.situacion}
                  onChange={(e) => {
                    editarPiso('situacion', e.target.value as 'exterior' | 'interior');
                  }}
                >
                  <option value="exterior">Exterior</option>
                  <option value="interior">Interior</option>
                </select>
              </Campo>
              <Campo etiqueta="Orientacion">
                <select
                  className={clasesEntrada}
                  value={expediente.piso.orientacion}
                  onChange={(e) => {
                    editarPiso(
                      'orientacion',
                      e.target.value as Expediente['piso']['orientacion'],
                    );
                  }}
                >
                  {ORIENTACIONES.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo etiqueta="Estado de conservacion">
                <select
                  className={clasesEntrada}
                  value={expediente.piso.estado_conservacion}
                  onChange={(e) => {
                    editarPiso(
                      'estado_conservacion',
                      e.target.value as Expediente['piso']['estado_conservacion'],
                    );
                  }}
                >
                  {ESTADOS.map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo
                etiqueta="Certificado energetico"
                ayuda="Vacio = no disponible. Es obligatorio en el anuncio."
              >
                <select
                  className={clasesEntrada}
                  value={
                    expediente.piso.certificado_energetico.estado === 'registrado'
                      ? expediente.piso.certificado_energetico.letra_consumo
                      : ''
                  }
                  onChange={(e) => {
                    editarPiso(
                      'certificado_energetico',
                      e.target.value === ''
                        ? { estado: 'no_disponible' }
                        : {
                            estado: 'registrado',
                            letra_consumo: e.target
                              .value as 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G',
                          },
                    );
                  }}
                >
                  {CEE.map((l) => (
                    <option key={l} value={l}>
                      {l === '' ? 'No disponible' : l}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo etiqueta="Ano de rehabilitacion" ayuda="Del edificio, si la hubo.">
                <Numero
                  valor={expediente.piso.anio_rehabilitacion}
                  onChange={(v) => {
                    editarPiso('anio_rehabilitacion', v);
                  }}
                />
              </Campo>
              <Campo etiqueta="Habitaciones">
                <Numero
                  valor={expediente.piso.habitaciones}
                  min={0}
                  onChange={(v) => {
                    editarPiso('habitaciones', v);
                  }}
                />
              </Campo>
            </Seccion>

            <Seccion titulo="El anuncio">
              <Campo etiqueta="Precio que piden (€)">
                <Numero
                  valor={expediente.piso.precio_pedido === 0 ? null : expediente.piso.precio_pedido}
                  min={0}
                  onChange={(v) => {
                    editarPiso('precio_pedido', v ?? 0);
                  }}
                />
              </Campo>
              <Campo
                etiqueta="Dias publicado"
                ayuda="Un anuncio largo suele indicar precio por encima de mercado."
              >
                <Numero
                  valor={expediente.piso.dias_publicado}
                  min={0}
                  onChange={(v) => {
                    editarPiso('dias_publicado', v);
                  }}
                />
              </Campo>
              <Campo
                etiqueta="Valor de referencia del Catastro (€)"
                ayuda="Exige Cl@ve o certificado. Desde la Ley 11/2021 fija la base del ITP."
              >
                <Numero
                  valor={expediente.piso.valor_referencia_catastral}
                  min={0}
                  onChange={(v) => {
                    editarPiso('valor_referencia_catastral', v);
                  }}
                />
              </Campo>
              <Campo etiqueta="Valor catastral (€)" ayuda="Del recibo del IBI. Lo usa el IVA de reforma.">
                <Numero
                  valor={expediente.piso.valor_catastral}
                  min={0}
                  onChange={(v) => {
                    editarPiso('valor_catastral', v);
                  }}
                />
              </Campo>
            </Seccion>

            <Seccion titulo="Tu situacion">
              <Campo etiqueta="Edad">
                <Numero
                  valor={expediente.comprador.edad === 0 ? null : expediente.comprador.edad}
                  min={18}
                  onChange={(v) => {
                    editarComprador('edad', v ?? 0);
                  }}
                />
              </Campo>
              <Campo etiqueta="Ahorro disponible (€)">
                <Numero
                  valor={
                    expediente.comprador.ahorro_disponible === 0
                      ? null
                      : expediente.comprador.ahorro_disponible
                  }
                  min={0}
                  onChange={(v) => {
                    editarComprador('ahorro_disponible', v ?? 0);
                  }}
                />
              </Campo>
              <Campo etiqueta="Ingresos netos al mes (€)">
                <Numero
                  valor={
                    expediente.comprador.ingresos_netos_mensuales === 0
                      ? null
                      : expediente.comprador.ingresos_netos_mensuales
                  }
                  min={0}
                  onChange={(v) => {
                    editarComprador('ingresos_netos_mensuales', v ?? 0);
                  }}
                />
              </Campo>
              <Campo etiqueta="Otras cuotas al mes (€)" ayuda="Prestamos en curso. Restan capacidad.">
                <Numero
                  valor={expediente.comprador.deudas_mensuales_actuales}
                  min={0}
                  onChange={(v) => {
                    editarComprador('deudas_mensuales_actuales', v ?? 0);
                  }}
                />
              </Campo>
              <Campo
                etiqueta="Base imponible IRPF anual (€)"
                ayuda="Muchos tipos reducidos de ITP tienen limite de renta."
              >
                <Numero
                  valor={expediente.comprador.base_imponible_irpf_anual}
                  min={0}
                  onChange={(v) => {
                    editarComprador('base_imponible_irpf_anual', v);
                  }}
                />
              </Campo>
              <Campo etiqueta="TIN de la hipoteca (%)">
                <Numero
                  valor={
                    expediente.comprador.hipoteca.tin_anual === 0
                      ? null
                      : expediente.comprador.hipoteca.tin_anual * 100
                  }
                  step={0.01}
                  min={0}
                  onChange={(v) => {
                    editarComprador('hipoteca', {
                      ...expediente.comprador.hipoteca,
                      tin_anual: (v ?? 0) / 100,
                    });
                  }}
                />
              </Campo>
              <Casilla
                etiqueta="Sera mi vivienda habitual"
                valor={expediente.comprador.sera_vivienda_habitual}
                onChange={(v) => {
                  editarComprador('sera_vivienda_habitual', v);
                }}
              />
              <Casilla
                etiqueta="Es mi primera vivienda habitual"
                ayuda="Varias bonificaciones de ITP lo exigen, no basta con que sea habitual."
                valor={expediente.comprador.primera_vivienda_habitual}
                onChange={(v) => {
                  editarComprador('primera_vivienda_habitual', v);
                }}
              />
            </Seccion>

            <Seccion titulo="Riesgos">
              <Campo
                etiqueta="Derramas aprobadas (€)"
                ayuda="Del acta de la junta. Es el argumento mas solido de la mesa."
              >
                <Numero
                  valor={expediente.riesgos.derramas_aprobadas_eur}
                  min={0}
                  onChange={(v) => {
                    editarRiesgo('derramas_aprobadas_eur', v ?? 0);
                  }}
                />
              </Campo>
              <Campo etiqueta="Cargas registrales (€)" ayuda="De la nota simple: hipoteca viva, embargos.">
                <Numero
                  valor={expediente.riesgos.cargas_registrales_eur}
                  min={0}
                  onChange={(v) => {
                    editarRiesgo('cargas_registrales_eur', v ?? 0);
                  }}
                />
              </Campo>
              <Campo etiqueta="Inspeccion tecnica del edificio">
                <select
                  className={clasesEntrada}
                  value={expediente.riesgos.ite}
                  onChange={(e) => {
                    editarRiesgo('ite', e.target.value as Expediente['riesgos']['ite']);
                  }}
                >
                  {ESTADOS_ITE.map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo etiqueta="Reforma prevista">
                <select
                  className={clasesEntrada}
                  value={expediente.reforma?.nivel ?? ''}
                  onChange={(e) => {
                    setExpediente((x) =>
                      x === null
                        ? x
                        : {
                            ...x,
                            reforma:
                              e.target.value === ''
                                ? null
                                : {
                                    nivel: e.target
                                      .value as NonNullable<Expediente['reforma']>['nivel'],
                                    partidas_singulares: [],
                                    hay_proyecto_cerrado: false,
                                    destinatario_particular: true,
                                    coste_materiales_pct: null,
                                  },
                          },
                    );
                  }}
                >
                  {NIVELES_REFORMA.map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </Campo>
            </Seccion>

            <button
              type="submit"
              disabled={pendiente}
              className="rounded-md bg-(--color-acento) px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {pendiente ? 'Calculando…' : 'Calcular el precio maximo'}
            </button>
          </form>
        </>
      )}

      {/* --- Resultado --- */}
      {calculo?.estado === 'error' && (
        <ErrorCaja mensaje={calculo.mensaje} sugerencia={calculo.sugerencia} />
      )}
      {calculo?.estado === 'ok' && (
        <Resultado r={calculo.resultado} avisosEntrada={calculo.avisosEntrada} />
      )}
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | number }) {
  return (
    <div className="flex justify-between gap-3 border-b border-(--color-borde) py-1">
      <dt className="text-(--color-tenue)">{etiqueta}</dt>
      <dd className="text-right">{valor}</dd>
    </div>
  );
}
