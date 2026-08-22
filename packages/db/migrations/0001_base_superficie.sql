-- La base del EUR/m2 pasa de un booleano (construida si/no) a las tres
-- superficies reales del sector: util, construida y construida con partes
-- comunes. La metodologia de MITMA distingue construida de construida con
-- comunes, y aplicarles el mismo factor de conversion mete un error de
-- alrededor del 6% en la valoracion.
--
-- Se hace como DROP + ADD y no como conversion de tipo porque la tabla esta
-- vacia: no hay ingesta todavia.
ALTER TABLE "notariado_precios" DROP COLUMN "base_construida";--> statement-breakpoint
ALTER TABLE "notariado_precios" ADD COLUMN "base_superficie" varchar(24) DEFAULT 'construida' NOT NULL;
