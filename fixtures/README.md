# fixtures

Respuestas **reales** capturadas de cada fuente de datos.

## La regla

Antes de escribir una sola línea de código contra una API:

1. Hacer una petición real.
2. Guardar la respuesta aquí, en `<fuente>/<caso>.json`.
3. Programar contra esa respuesta.

Si un endpoint no responde, ha cambiado de dominio o ha cambiado de esquema:
**parar y avisar**. No se mockea en silencio algo que parezca funcionar. Un
adaptador escrito contra un esquema supuesto pasa los tests y falla el día que se
usa de verdad, que es el único día que importa.

Es especialmente relevante en el Catastro: los dominios migraron de `minhap` a
`hacienda` y hay mezcla de http/https con certificados problemáticos. Cada
endpoint hay que verificarlo antes de darlo por bueno.

## Metadatos obligatorios

Un fixture sin procedencia no permite detectar que la fuente ha cambiado. Cada
uno lleva su `.meta.json` al lado:

```json
{
  "url": "https://...",
  "metodo": "GET",
  "parametros": { "...": "..." },
  "codigo_estado": 200,
  "content_type": "application/json",
  "capturado_en": "2026-08-22T10:30:00Z",
  "notas": "Piso en el Grao de Castellon, caso base de la Fase 1"
}
```

## Estructura prevista

```
catastro/          Consulta_DNPRC, Consulta_RCCOOR, DNPLOC
mitma/             XLS de la serie 35103500
ine/               DATOS_TABLA del IPV por CCAA
notariado/         EUR/m2 por codigo postal
cartociudad/       Geocodificacion inversa
serpavi/           Renta de referencia
cee/               Certificados energeticos autonomicos
```

## Qué NO va aquí

Nada procedente de un portal inmobiliario. Ver `PROMPT.md` §3.10.

Tampoco datos personales de terceros: si una respuesta del Catastro incluye
titularidad, se recorta antes de guardarla. Solo se guarda lo que describe al
inmueble.
