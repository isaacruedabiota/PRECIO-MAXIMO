import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Configuracion unica para todo el monorepo.
 *
 * Sin reglas de estilo: de eso ya se encarga el formateador y no aportan nada a
 * un proyecto de una persona. Aqui solo van reglas que atrapan errores reales.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/migrations/**',
      'fixtures/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // El proyecto usa el prefijo _ para lo que aun no se consume (Fase 0).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Un `any` en un motor que calcula euros es justo lo que no queremos.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },

  {
    // Los scripts CLI son puntos de entrada: pueden escribir en consola y salir.
    files: ['scripts/**/*.ts', 'packages/*/src/check.ts', 'packages/*/src/migrate.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
