-- MITMA no publica un EUR/m2 por municipio: publica tres, segun la antiguedad
-- de la vivienda tasada (hasta cinco anos, mas de cinco, y total). No son
-- intercambiables: en Castellon capital van de 1.445 a mas de 2.000 EUR/m2.
--
-- Guardar solo uno obligaba a elegir por el motor, y ademas choca con ADR-015:
-- si el precio es de vivienda de mas de cinco anos, la edad del parque contra la
-- que T1 deprecia tiene que describir esa misma poblacion. Asi que se guardan
-- los tres y quien consulta elige.
--
-- n_tasaciones es el tamano de muestra. T1 degrada la confianza por debajo de
-- 15, y sin esta columna esa regla no se podia aplicar al dato de MITMA.
--
-- base_superficie se fija a 'construida': la metodologia de MITMA dice que su
-- EUR/m2 es el "cociente entre el valor de tasacion y la superficie construida".
ALTER TABLE "mitma_precios" ADD COLUMN "segmento" varchar(16) DEFAULT 'total' NOT NULL;--> statement-breakpoint
ALTER TABLE "mitma_precios" ADD COLUMN "n_tasaciones" integer;--> statement-breakpoint
ALTER TABLE "mitma_precios" ADD COLUMN "base_superficie" varchar(24) DEFAULT 'construida' NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "uq_mitma_ambito_codigo_periodo";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mitma_ambito_codigo_periodo_segmento" ON "mitma_precios" ("ambito","codigo","periodo","segmento");
