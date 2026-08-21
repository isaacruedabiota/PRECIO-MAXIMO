import { auditarConfig, loadConfig } from '@vp/config';
import { VERSION_MOTOR } from '@vp/engine';

/**
 * Fase 0: pagina de estado. No calcula nada.
 *
 * Sirve para algo concreto: comprueba de punta a punta que la web puede cargar
 * y validar la configuracion, y ensena cuanta deuda de configuracion queda
 * antes de que el motor pueda dar un numero.
 */
export const dynamic = 'force-dynamic';

export default function Home() {
  const { raw, dir } = loadConfig();
  const { pendientes, sin_verificar, fuera_de_rango } = auditarConfig(raw);
  const bloquesSinVerificar = [...new Set(sin_verificar)];

  return (
    <div className="space-y-8">
      {bloquesSinVerificar.length > 0 && (
        <aside
          role="alert"
          className="rounded-lg border-2 border-(--color-alerta) bg-(--color-alerta)/5 p-4"
        >
          <p className="text-sm font-semibold text-(--color-alerta)">
            Ningun dato esta contrastado
          </p>
          <p className="mt-1 text-sm">
            {bloquesSinVerificar.length} bloques de configuracion siguen con{' '}
            <code className="text-xs">verificado: false</code>. Los coeficientes vienen de
            estimaciones sembradas con <code className="text-xs">config:seed</code>, no de una
            fuente oficial. Cualquier cifra que salga de aqui es provisional hasta que se
            verifique una por una.
          </p>
        </aside>
      )}

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-(--color-tenue)">
          Estado
        </h2>
        <p className="mt-2 text-2xl font-semibold">Fase 0 — andamiaje</p>
        <p className="mt-1 text-sm text-(--color-tenue)">
          Motor <code>{VERSION_MOTOR}</code>. El calculo llega en la Fase 1.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Tarjeta
          etiqueta="Pendientes de fijar"
          valor={pendientes.length}
          detalle="Campos a null. El motor lanza si necesita alguno."
          tono={pendientes.length > 0 ? 'atencion' : 'ok'}
        />
        <Tarjeta
          etiqueta="Sin verificar"
          valor={bloquesSinVerificar.length}
          detalle="Bloques sin contrastar contra fuente oficial."
          tono={bloquesSinVerificar.length > 0 ? 'atencion' : 'ok'}
        />
        <Tarjeta
          etiqueta="Fuera de rango"
          valor={fuera_de_rango.length}
          detalle="Valores fijados fuera de su horquilla declarada."
          tono={fuera_de_rango.length > 0 ? 'alerta' : 'ok'}
        />
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-(--color-tenue)">
          Configuracion
        </h2>
        <p className="mt-2 text-sm">
          Cargada desde <code className="text-xs">{dir}</code>
        </p>
        <p className="mt-1 text-sm text-(--color-tenue)">
          Ningun numero de negocio vive en el codigo. Todo sale de estos JSON, con su
          vigencia y su fuente.
        </p>
      </section>
    </div>
  );
}

function Tarjeta({
  etiqueta,
  valor,
  detalle,
  tono,
}: {
  etiqueta: string;
  valor: number;
  detalle: string;
  tono: 'ok' | 'atencion' | 'alerta';
}) {
  const color =
    tono === 'alerta'
      ? 'text-(--color-alerta)'
      : tono === 'atencion'
        ? 'text-(--color-atencion)'
        : 'text-(--color-ok)';

  return (
    <div className="rounded-lg border border-(--color-borde) p-4">
      <p className="text-xs uppercase tracking-wide text-(--color-tenue)">{etiqueta}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${color}`}>{valor}</p>
      <p className="mt-2 text-xs text-(--color-tenue)">{detalle}</p>
    </div>
  );
}
