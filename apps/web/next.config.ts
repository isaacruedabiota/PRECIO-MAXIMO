import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const raizMonorepo = fileURLToPath(new URL('../../', import.meta.url));

const config: NextConfig = {
  // standalone deja un bundle autocontenido que se copia tal cual a la Pi.
  output: 'standalone',

  // Los paquetes internos se publican como TypeScript sin compilar.
  transpilePackages: ['@vp/engine', '@vp/config', '@vp/adapters', '@vp/db'],

  outputFileTracingRoot: raizMonorepo,
  outputFileTracingIncludes: {
    // @vp/config lee los JSON con readFileSync: hay que incluirlos en el bundle
    // o la app arranca en la Pi y revienta al primer calculo.
    '/**/*': ['../../packages/config/data/**/*.json'],
  },
};

export default config;
