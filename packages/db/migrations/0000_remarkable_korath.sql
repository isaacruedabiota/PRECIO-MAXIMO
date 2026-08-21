CREATE TYPE "public"."ambito_precio" AS ENUM('codigo_postal', 'municipio', 'provincia');--> statement-breakpoint
CREATE TYPE "public"."origen_dato" AS ENUM('api', 'descarga_batch', 'csv_manual', 'entrada_usuario');--> statement-breakpoint
CREATE TABLE "catastro_cache" (
	"referencia_catastral" varchar(20) PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"ficha" jsonb,
	"obtenido_en" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_en" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "certificados_energeticos" (
	"id" serial PRIMARY KEY NOT NULL,
	"referencia_catastral" varchar(20) NOT NULL,
	"ccaa" text NOT NULL,
	"numero_registro" text,
	"letra_consumo" varchar(1) NOT NULL,
	"letra_emisiones" varchar(1),
	"fecha_registro" date,
	"fuente_id" integer
);
--> statement-breakpoint
CREATE TABLE "codigos_postales" (
	"id" serial PRIMARY KEY NOT NULL,
	"cp" varchar(5) NOT NULL,
	"municipio_ine" varchar(5),
	"geom" geometry(MultiPolygon, 4326)
);
--> statement-breakpoint
CREATE TABLE "fuentes_datos" (
	"id" serial PRIMARY KEY NOT NULL,
	"fuente" varchar(64) NOT NULL,
	"origen" "origen_dato" NOT NULL,
	"url" text,
	"periodo" varchar(16),
	"descargado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"checksum" varchar(64),
	"filas_importadas" integer,
	"notas" text
);
--> statement-breakpoint
CREATE TABLE "ine_ipv" (
	"id" serial PRIMARY KEY NOT NULL,
	"ccaa" text NOT NULL,
	"serie" varchar(24) NOT NULL,
	"periodo" varchar(16) NOT NULL,
	"fecha_dato" date NOT NULL,
	"indice" real NOT NULL,
	"variacion_trimestral" real,
	"variacion_anual" real,
	"id_tabla_ine" varchar(24) NOT NULL,
	"fuente_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mitma_precios" (
	"id" serial PRIMARY KEY NOT NULL,
	"ambito" "ambito_precio" NOT NULL,
	"codigo" varchar(5) NOT NULL,
	"periodo" varchar(16) NOT NULL,
	"fecha_dato" date NOT NULL,
	"eur_m2" numeric(10, 2) NOT NULL,
	"fuente_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "municipios" (
	"codigo_ine" varchar(5) PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"codigo_provincia" varchar(2) NOT NULL,
	"provincia" text NOT NULL,
	"ccaa" text NOT NULL,
	"poblacion" integer,
	"tiene_dato_mitma_municipal" boolean DEFAULT false NOT NULL,
	"centroide" geometry(Point, 4326)
);
--> statement-breakpoint
CREATE TABLE "notariado_precios" (
	"id" serial PRIMARY KEY NOT NULL,
	"cp" varchar(5) NOT NULL,
	"periodo" varchar(16) NOT NULL,
	"fecha_dato" date NOT NULL,
	"eur_m2" numeric(10, 2) NOT NULL,
	"n_transacciones" integer,
	"p25" numeric(10, 2),
	"p75" numeric(10, 2),
	"base_construida" boolean DEFAULT true NOT NULL,
	"fuente_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "precios_anexos" (
	"id" serial PRIMARY KEY NOT NULL,
	"ambito" "ambito_precio" NOT NULL,
	"codigo" varchar(5) NOT NULL,
	"periodo" varchar(16) NOT NULL,
	"garaje_eur" numeric(10, 2),
	"trastero_eur" numeric(10, 2),
	"terraza_eur_m2" numeric(10, 2),
	"fuente_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "serpavi_rentas" (
	"id" serial PRIMARY KEY NOT NULL,
	"ambito" "ambito_precio" NOT NULL,
	"codigo" varchar(5) NOT NULL,
	"periodo" varchar(16) NOT NULL,
	"renta_min_eur_m2_mes" numeric(8, 3),
	"renta_max_eur_m2_mes" numeric(8, 3),
	"fuente_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valoraciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"alias" text,
	"referencia_catastral" varchar(20),
	"input" jsonb NOT NULL,
	"resultado" jsonb NOT NULL,
	"version_motor" varchar(32) NOT NULL,
	"version_config" varchar(32) NOT NULL,
	"precio_maximo_eur" bigint
);
--> statement-breakpoint
CREATE TABLE "valores_referencia" (
	"id" serial PRIMARY KEY NOT NULL,
	"referencia_catastral" varchar(20) NOT NULL,
	"ejercicio" integer NOT NULL,
	"valor_eur" numeric(12, 2) NOT NULL,
	"origen" "origen_dato" DEFAULT 'entrada_usuario' NOT NULL,
	"introducido_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zonas_tensionadas" (
	"municipio_ine" varchar(5) PRIMARY KEY NOT NULL,
	"declarado_desde" date,
	"declarado_hasta" date,
	"fuente_id" integer
);
--> statement-breakpoint
ALTER TABLE "certificados_energeticos" ADD CONSTRAINT "certificados_energeticos_fuente_id_fuentes_datos_id_fk" FOREIGN KEY ("fuente_id") REFERENCES "public"."fuentes_datos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codigos_postales" ADD CONSTRAINT "codigos_postales_municipio_ine_municipios_codigo_ine_fk" FOREIGN KEY ("municipio_ine") REFERENCES "public"."municipios"("codigo_ine") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ine_ipv" ADD CONSTRAINT "ine_ipv_fuente_id_fuentes_datos_id_fk" FOREIGN KEY ("fuente_id") REFERENCES "public"."fuentes_datos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mitma_precios" ADD CONSTRAINT "mitma_precios_fuente_id_fuentes_datos_id_fk" FOREIGN KEY ("fuente_id") REFERENCES "public"."fuentes_datos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notariado_precios" ADD CONSTRAINT "notariado_precios_fuente_id_fuentes_datos_id_fk" FOREIGN KEY ("fuente_id") REFERENCES "public"."fuentes_datos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precios_anexos" ADD CONSTRAINT "precios_anexos_fuente_id_fuentes_datos_id_fk" FOREIGN KEY ("fuente_id") REFERENCES "public"."fuentes_datos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serpavi_rentas" ADD CONSTRAINT "serpavi_rentas_fuente_id_fuentes_datos_id_fk" FOREIGN KEY ("fuente_id") REFERENCES "public"."fuentes_datos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zonas_tensionadas" ADD CONSTRAINT "zonas_tensionadas_fuente_id_fuentes_datos_id_fk" FOREIGN KEY ("fuente_id") REFERENCES "public"."fuentes_datos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_catastro_expira" ON "catastro_cache" USING btree ("expira_en");--> statement-breakpoint
CREATE INDEX "idx_cee_rc" ON "certificados_energeticos" USING btree ("referencia_catastral");--> statement-breakpoint
CREATE INDEX "idx_cp_cp" ON "codigos_postales" USING btree ("cp");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cp_municipio" ON "codigos_postales" USING btree ("cp","municipio_ine");--> statement-breakpoint
CREATE INDEX "idx_fuentes_fuente_periodo" ON "fuentes_datos" USING btree ("fuente","periodo");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ipv_ccaa_serie_periodo" ON "ine_ipv" USING btree ("ccaa","serie","periodo");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mitma_ambito_codigo_periodo" ON "mitma_precios" USING btree ("ambito","codigo","periodo");--> statement-breakpoint
CREATE INDEX "idx_municipios_nombre" ON "municipios" USING btree ("nombre");--> statement-breakpoint
CREATE INDEX "idx_municipios_ccaa" ON "municipios" USING btree ("ccaa");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notariado_cp_periodo" ON "notariado_precios" USING btree ("cp","periodo");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_anexos_ambito_codigo_periodo" ON "precios_anexos" USING btree ("ambito","codigo","periodo");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_serpavi_ambito_codigo_periodo" ON "serpavi_rentas" USING btree ("ambito","codigo","periodo");--> statement-breakpoint
CREATE INDEX "idx_valoraciones_creado" ON "valoraciones" USING btree ("creado_en");--> statement-breakpoint
CREATE INDEX "idx_valoraciones_rc" ON "valoraciones" USING btree ("referencia_catastral");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_vref_rc_ejercicio" ON "valores_referencia" USING btree ("referencia_catastral","ejercicio");