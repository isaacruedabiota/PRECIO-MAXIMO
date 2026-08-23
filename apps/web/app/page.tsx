import { auditarConfig, loadConfig } from '@vp/config';

import { Formulario } from './formulario';

/**
 * Fase 4: formulario, resultado y desglose trazable.
 *
 * La pagina no calcula nada. Carga y audita la configuracion para poder decir
 * cuanta deuda queda, y deja el resto al formulario, que llama a las acciones
 * de servidor.
 */
export const dynamic = 'force-dynamic';

export default function Home() {
  const { raw } = loadConfig();
  const { pendientes, sin_verificar, fuera_de_rango } = auditarConfig(raw);
  const bloquesSinVerificar = [...new Set(sin_verificar)];

  return (
    <div className="space-y-8">
      {/*
        Mientras quede un bloque sin contrastar, el aviso es permanente. Un
        numero con aire de rigor y sin fuente detras es justo lo que esta
        herramienta no quiere producir.
      */}
      {(bloquesSinVerificar.length > 0 || fuera_de_rango.length > 0) && (
        <aside
          role="alert"
          className="rounded-lg border-2 border-(--color-alerta) bg-(--color-alerta)/5 p-4"
        >
          <p className="text-sm font-semibold text-(--color-alerta)">
            Hay cifras sin contrastar
          </p>
          <p className="mt-1 text-sm">
            {bloquesSinVerificar.length} bloques de configuracion siguen con{' '}
            <code className="text-xs">verificado: false</code>, y {pendientes.length} valores
            estan sin fijar. Los tipos fiscales de la Comunitat Valenciana y los aranceles si
            estan leidos del BOE; lo que falta son sobre todo las otras comunidades y los
            coeficientes de homogeneizacion, que son criterio profesional y no dato oficial.
          </p>
          {fuera_de_rango.length > 0 && (
            <p className="mt-2 text-sm font-medium text-(--color-alerta)">
              Ademas hay {fuera_de_rango.length} valores fuera de su horquilla declarada.
            </p>
          )}
        </aside>
      )}

      <Formulario />
    </div>
  );
}
