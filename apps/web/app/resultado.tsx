/**
 * Presentacion del resultado del motor.
 *
 * Regla del proyecto: ningun numero se muestra sin poder decir de donde sale.
 * Por eso cada techo trae su desglose desplegable y cada TrazedValue se pinta
 * con su fuente, su fecha y su confianza.
 */

import type {
  Aviso,
  DesgloseLinea,
  MaxPriceResult,
  TechoId,
  TrazedValue,
} from '@vp/engine';

const ORDEN: readonly TechoId[] = ['T1', 'T2', 'T3', 'T4'];

const eur = (n: number): string =>
  `${Math.round(n).toLocaleString('es-ES')} €`;

function colorDeAviso(nivel: Aviso['nivel']): string {
  return nivel === 'critico'
    ? 'text-(--color-alerta)'
    : nivel === 'atencion'
      ? 'text-(--color-atencion)'
      : 'text-(--color-tenue)';
}

function Trazado({ v }: { v: TrazedValue }) {
  return (
    <div className="text-xs text-(--color-tenue)">
      <span className="font-medium">{v.fuente}</span>
      {' · '}
      {v.metodo}
      {' · '}
      <time dateTime={v.fecha_dato}>{v.fecha_dato}</time>
      {' · confianza '}
      {v.confianza}
      {v.notas !== undefined && v.notas.length > 0 && (
        <ul className="mt-1 list-disc pl-4">
          {v.notas.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Desglose({ lineas }: { lineas: readonly DesgloseLinea[] }) {
  if (lineas.length === 0) return null;
  return (
    <table className="mt-3 w-full text-sm">
      <tbody>
        {lineas.map((l, i) => (
          <tr key={`${l.concepto}-${i}`} className="border-t border-(--color-borde)">
            <td className="py-1.5 pr-3">
              {l.concepto}
              {l.formula !== undefined && (
                <span className="block text-xs text-(--color-tenue)">= {l.formula}</span>
              )}
            </td>
            <td className="py-1.5 text-right tabular-nums whitespace-nowrap">
              {l.valor.unidad === 'coeficiente'
                ? l.valor.valor.toFixed(4)
                : Math.round(l.valor.valor).toLocaleString('es-ES')}{' '}
              <span className="text-xs text-(--color-tenue)">{l.valor.unidad}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Avisos({ avisos }: { avisos: readonly Aviso[] }) {
  if (avisos.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2">
      {avisos.map((a) => (
        <li key={a.codigo} className="text-sm">
          <span className={`font-medium ${colorDeAviso(a.nivel)}`}>{a.titulo}</span>
          <p className="text-(--color-tenue)">{a.detalle}</p>
          {a.referencia_legal !== undefined && (
            <p className="text-xs text-(--color-tenue)">{a.referencia_legal}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function Resultado({
  r,
  avisosEntrada,
}: {
  r: MaxPriceResult;
  avisosEntrada: readonly string[];
}) {
  // Un bloqueante no descuenta: para el calculo. Dar un numero aqui seria dar
  // una cifra falsa con apariencia de rigor.
  if (r.bloqueantes.length > 0) {
    return (
      <section
        role="alert"
        className="rounded-lg border-2 border-(--color-alerta) bg-(--color-alerta)/5 p-5"
      >
        <h2 className="font-semibold text-(--color-alerta)">Calculo bloqueado</h2>
        <p className="mt-1 text-sm">
          No se da un precio hasta aclarar esto. Un numero aqui seria falso con apariencia
          de rigor.
        </p>
        <ul className="mt-4 space-y-4">
          {r.bloqueantes.map((b) => (
            <li key={b.codigo}>
              <p className="font-medium">{b.titulo}</p>
              <p className="text-sm text-(--color-tenue)">{b.detalle}</p>
              <p className="mt-1 text-sm">
                <span className="font-medium">Como verificarlo:</span> {b.como_verificar}
              </p>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const descuentos = r.descuentos_riesgo.reduce((s, d) => s + d.importe.valor, 0);

  return (
    <div className="space-y-8">
      {/* --- Cifra principal --- */}
      <section className="rounded-lg border border-(--color-borde) p-5">
        <p className="text-xs uppercase tracking-wide text-(--color-tenue)">
          Precio maximo recomendado
        </p>
        <p className="mt-1 text-4xl font-semibold tabular-nums">
          {r.precio_maximo === null ? '—' : eur(r.precio_maximo.valor)}
        </p>
        {r.precio_maximo !== null && (
          <div className="mt-2">
            <Trazado v={r.precio_maximo} />
          </div>
        )}

        {r.precio_entrada_negociacion !== null && (
          <p className="mt-4 text-sm">
            <span className="text-(--color-tenue)">Entra ofreciendo</span>{' '}
            <span className="font-medium tabular-nums">
              {eur(r.precio_entrada_negociacion.min)} – {eur(r.precio_entrada_negociacion.max)}
            </span>
          </p>
        )}

        {r.comparativa_precio_pedido !== null && (
          <p className="mt-1 text-sm">
            <span className="text-(--color-tenue)">Piden</span>{' '}
            <span className="tabular-nums">{eur(r.comparativa_precio_pedido.precio_pedido)}</span>
            {' — '}
            <span
              className={
                r.comparativa_precio_pedido.veredicto === 'sobrevalorado'
                  ? 'text-(--color-alerta)'
                  : r.comparativa_precio_pedido.veredicto === 'por_debajo_de_mercado'
                    ? 'text-(--color-ok)'
                    : ''
              }
            >
              {r.comparativa_precio_pedido.veredicto.replace(/_/g, ' ')}
            </span>{' '}
            <span className="tabular-nums text-(--color-tenue)">
              ({r.comparativa_precio_pedido.diferencia_pct > 0 ? '+' : ''}
              {(r.comparativa_precio_pedido.diferencia_pct * 100).toFixed(1)}%)
            </span>
          </p>
        )}
      </section>

      {/* --- Los cuatro techos --- */}
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-(--color-tenue)">
          Los cuatro techos
        </h2>
        <p className="mt-1 text-sm text-(--color-tenue)">
          El precio maximo es el menor de los cuatro, menos los descuentos por riesgo.
        </p>

        <div className="mt-4 space-y-3">
          {ORDEN.map((id) => {
            const t = r.techos[id];
            const manda = r.techo_limitante === id;
            return (
              <details
                key={id}
                open={manda}
                className={`rounded-lg border p-4 ${
                  manda ? 'border-(--color-acento)' : 'border-(--color-borde)'
                }`}
              >
                <summary className="flex cursor-pointer items-baseline justify-between gap-4">
                  <span>
                    <span className="text-xs text-(--color-tenue)">{id}</span>{' '}
                    <span className="font-medium">{t.nombre}</span>
                    {manda && (
                      <span className="ml-2 rounded bg-(--color-acento)/10 px-1.5 py-0.5 text-xs text-(--color-acento)">
                        manda
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums whitespace-nowrap">
                    {!t.aplica ? (
                      <span className="text-sm text-(--color-tenue)">no aplica</span>
                    ) : t.valor === null ? (
                      '—'
                    ) : (
                      eur(t.valor.valor)
                    )}
                  </span>
                </summary>

                {!t.aplica ? (
                  <p className="mt-2 text-sm text-(--color-tenue)">{t.motivo_no_aplica}</p>
                ) : (
                  <>
                    {t.rango !== null && (
                      <p className="mt-2 text-sm text-(--color-tenue) tabular-nums">
                        Rango {eur(t.rango.min)} – {eur(t.rango.max)}
                      </p>
                    )}
                    <Desglose lineas={t.desglose} />
                    {t.valor !== null && (
                      <div className="mt-3">
                        <Trazado v={t.valor} />
                      </div>
                    )}
                    <Avisos avisos={t.avisos} />
                  </>
                )}
              </details>
            );
          })}
        </div>
      </section>

      {/* --- Descuentos --- */}
      {r.descuentos_riesgo.length > 0 && (
        <section>
          <h2 className="text-sm font-medium uppercase tracking-wide text-(--color-tenue)">
            Descuentos por riesgo — {eur(descuentos)}
          </h2>
          <ul className="mt-3 space-y-3">
            {r.descuentos_riesgo.map((d) => (
              <li key={d.codigo} className="rounded-lg border border-(--color-borde) p-4">
                <p className="flex items-baseline justify-between gap-4">
                  <span className="font-medium">{d.concepto}</span>
                  <span className="tabular-nums whitespace-nowrap">−{eur(d.importe.valor)}</span>
                </p>
                <p className="mt-1 text-sm text-(--color-tenue)">{d.justificacion}</p>
                <div className="mt-2">
                  <Trazado v={d.importe} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- Metricas de inversion --- */}
      {r.metricas_inversion !== null && (
        <section>
          <h2 className="text-sm font-medium uppercase tracking-wide text-(--color-tenue)">
            Metricas de inversion
          </h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {Object.entries(r.metricas_inversion).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-(--color-borde) p-3">
                <dt className="text-xs uppercase tracking-wide text-(--color-tenue)">
                  {k.replace(/_/g, ' ')}
                </dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">
                  {v.valor.toFixed(2)}{' '}
                  <span className="text-sm font-normal text-(--color-tenue)">{v.unidad}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* --- Argumentario --- */}
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-(--color-tenue)">
          Que llevar a la negociacion
        </h2>
        <ul className="mt-3 space-y-4">
          {r.argumentario.map((p) => (
            <li key={p.titular} className="rounded-lg border border-(--color-borde) p-4">
              <p className="flex items-baseline justify-between gap-4">
                <span className="font-medium">{p.titular}</span>
                {p.impacto_eur !== null && (
                  <span className="tabular-nums whitespace-nowrap text-(--color-tenue)">
                    {eur(p.impacto_eur)}
                  </span>
                )}
              </p>
              <p className="mt-1 text-sm text-(--color-tenue)">{p.detalle}</p>
              <div className="mt-2 space-y-1">
                {p.respaldo.map((t, i) => (
                  <Trazado key={`${t.fuente}-${i}`} v={t} />
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* --- Avisos --- */}
      {(r.avisos.length > 0 || avisosEntrada.length > 0) && (
        <section>
          <h2 className="text-sm font-medium uppercase tracking-wide text-(--color-tenue)">
            Avisos
          </h2>
          {avisosEntrada.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-(--color-tenue)">
              {avisosEntrada.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          <Avisos avisos={r.avisos} />
        </section>
      )}

      {/* --- Procedencia --- */}
      <section className="rounded-lg border border-(--color-borde) p-4 text-xs text-(--color-tenue)">
        <p>
          Motor <code>{r.version_motor}</code> · configuracion <code>{r.version_config}</code> ·
          calculado el <time dateTime={r.fecha_calculo}>{r.fecha_calculo}</time> · confianza
          global {r.confianza_global}
        </p>
        <p className="mt-2">{r.disclaimer}</p>
      </section>
    </div>
  );
}
