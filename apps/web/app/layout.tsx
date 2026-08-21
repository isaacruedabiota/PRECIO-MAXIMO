import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Precio maximo de compra',
  description: 'Motor de decision trazable para la compra de vivienda en Espana',
};

/**
 * El disclaimer es permanente y no se puede cerrar. Es la linea que separa esta
 * herramienta de una tasacion regulada por la Orden ECO/805/2003.
 */
const DISCLAIMER =
  'Valoracion orientativa. No constituye tasacion oficial a efectos de la Orden ECO/805/2003 ' +
  'ni sustituye el asesoramiento profesional.';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen antialiased">
        <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-6">
          <header className="border-b border-(--color-borde) py-6">
            <h1 className="text-lg font-semibold tracking-tight">Precio maximo de compra</h1>
            <p className="text-sm text-(--color-tenue)">
              Cuanto deberia pagar por este piso, y por que
            </p>
          </header>

          <main className="flex-1 py-10">{children}</main>

          <footer className="border-t border-(--color-borde) py-6 text-xs text-(--color-tenue)">
            {DISCLAIMER}
          </footer>
        </div>
      </body>
    </html>
  );
}
