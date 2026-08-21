import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://vp:vp_dev_password@localhost:55432/vp',
  },
  // Las columnas geometry y la extension postgis las gestionamos nosotros en
  // migrate.ts; drizzle-kit no debe intentar tocar el esquema de postgis.
  schemaFilter: ['public'],
  verbose: true,
  strict: true,
});
