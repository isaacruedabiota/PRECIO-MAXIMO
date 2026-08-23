# CLAUDE.md

Guía de trabajo del repositorio. La especificación funcional completa está en
[PROMPT.md](PROMPT.md); aquí va cómo está construido, cómo se arranca y qué se
decidió por el camino.

---

## Qué es esto

Un motor de decisión trazable que responde a una pregunta: **dado este piso
concreto, cuál es el precio máximo que debería pagar por él, y por qué**.

No es un tasador ni un portal. Cada euro del resultado tiene que poder rastrearse
hasta una fuente oficial con fecha. Si un número no puede citar su origen, no se
muestra.

```
PRECIO_MAXIMO = min(T1, T2, T3, T4) − Σ(descuentos_riesgo)
```

| | Techo | Pregunta |
|---|---|---|
| T1 | Mercado | ¿Cuánto se paga realmente por pisos comparables? |
| T2 | Financiero-fiscal | ¿Hasta dónde llegan mi ahorro y mi capacidad de pago, impuestos incluidos? |
| T3 | Reforma | ¿Cuánto puedo pagar para que compra + reforma no supere el valor final? |
| T4 | Rentabilidad | ¿Qué precio da mi rentabilidad objetivo? (solo modo inversor) |

---

## Estado

**Fases 1 y 2 completas**, con **228 tests**.

La 1 es el motor: los cuatro techos, descuentos por riesgo, bloqueantes,
argumentario y métricas de inversión. `calcularPrecioMaximo` devuelve un
resultado completo y trazable en los tres modos: residencia, inversión en
alquiler e inversión en flipping.

La 2 es el Catastro: `pnpm ficha <RC>` da la ficha del inmueble, separa la
superficie de la vivienda de la de anejos y comunes (ADR-022), resuelve la CCAA
que fija el ITP, detecta la falta de división horizontal y **enumera lo que el
Catastro no publica** y hay que meter a mano. El valor de referencia va en modo
manual porque exige certificado (ADR-024).

Encima hay instrumental de calibración (`pnpm calibrate`), captura de respuestas
reales (`pnpm capture:fixture`) y cinco fuentes verificadas con fixture y cita:
**BOE** (ITP, IVA, IRPF, aranceles), **MITMA** (serie 35103500), **INE** (tabla
80270 y las variables 70/115) y el **Catastro**, tanto la Oficina Virtual como
INSPIRE.

**Pendiente antes de fiarse de un número**: 66 valores sin fijar y 19 bloques sin
verificar, casi todos de las otras cinco CCAA y de fuentes que aún no se usan.
Lo que sigue sin contrastar y sí se usa son los **coeficientes de
homogeneización**: no son dato oficial sino criterio profesional, y solo se
validan contra operaciones reales. Ver la sección de calibración.

Y sigue sin haber forma de valorar un piso de punta a punta: la ficha sale del
Catastro, pero el precio de mercado de T1 todavía entra a mano (Fase 3) y no hay
formulario (Fase 4).

---

## Arranque

```bash
pnpm install

# La base de datos de desarrollo es la de la Pi, por túnel SSH (ADR-005).
# Deja esto abierto en otra terminal:
pnpm db:tunnel

cp .env.example .env    # y pon la contraseña de /etc/vp/vp-web.env de la Pi
pnpm db:migrate

pnpm dev            # http://localhost:3000
```

Comprobaciones:

```bash
pnpm typecheck      # los 6 proyectos
pnpm lint           # eslint, config plana única en la raíz
pnpm test           # tests del motor
pnpm config:check   # qué falta por fijar y por verificar en la config
pnpm calibrate      # informe de calibración de T1 y T3 sobre datos reales
pnpm ingest:antiguedad 12900   # edad del parque de un municipio, del Catastro
```

Ficha de un inmueble desde el Catastro:

```bash
pnpm ficha 2004930YK5320S0009RH      # referencia de inmueble (20 caracteres)
pnpm ficha 2004930YK5320S            # de parcela (14): lista sus inmuebles
pnpm ficha --lat=39.98374 --lon=-0.04927
```

Antes de programar contra una fuente, su respuesta real:

```bash
pnpm capture:fixture --lista
pnpm capture:fixture catastro dnprc --rc=2004930YK5320S0009RH
```

`pnpm calibrate` acepta municipio y overrides sin tocar los JSON:

```bash
pnpm calibrate -- --edad-ref=40 --coef-min=0.5
pnpm calibrate "Burriana"
```

Despliegue a la Raspberry Pi: ver [infra/pi/README.md](infra/pi/README.md).

---

## Estructura

```
apps/web            Next.js App Router. Solo presentación; no calcula nada.
packages/engine     Motor. TypeScript puro, cero I/O, 100% testeable.
packages/config     JSON de negocio + esquemas Zod + cargador.
packages/adapters   Puertos de las fuentes. Catastro implementado; el resto, aún no.
packages/db         Drizzle + PostgreSQL/PostGIS.
scripts             CLI de ingesta y de captura de fixtures.
fixtures            Respuestas reales capturadas de cada API.
infra/pi            Despliegue en la Raspberry Pi.
```

---

## Las cinco reglas

Son las que hacen que la herramienta sirva para algo. Romper cualquiera de ellas
convierte el resultado en un número con aire de rigor y nada detrás.

### 1. El motor es puro

`packages/engine` no hace fetch, no toca disco, no consulta la base de datos y no
llama a `Date.now()`. La fecha de cálculo entra como parámetro. Todo lo que
necesita lo recibe en `CalcInput`.

Está impuesto por el `tsconfig.json` del paquete: `"types": []`, así que las APIs
de Node ni siquiera se ven. Por eso `@vp/engine` importa `EngineConfig` desde
`@vp/config/schemas` y no desde `@vp/config` — el índice arrastraría el cargador,
que sí hace I/O.

### 2. Ningún número de negocio en un `.ts`

Todos viven en `packages/config/data/*.json` con `vigencia_desde`, `fuente_url` y
`verificado`. Un tipo de ITP, un coeficiente de planta o un módulo de reforma
dentro del código es un bug.

### 3. Fallar ruidosamente

Cada valor configurable tiene esta forma:

```json
{ "min": 0.78, "max": 0.85, "sugerido": 0.82, "valor": null }
```

- `sugerido` es la semilla del brief. **El motor nunca cae a él.**
- `valor` es lo único que se usa en el cálculo.
- `valor: null` + el motor lo necesita → `MissingConfigError` con la ruta exacta.

Que el motor caiga al sugerido produciría resultados plausibles que nadie ha
validado. Un ITP mal puesto son 8.000 € de error en un piso de 200.000 €.

`verificado: false` es distinto: no impide calcular, genera un aviso en el
resultado. Un número presente pero sin contrastar se puede usar avisando; uno
ausente no se puede usar de ninguna manera.

`pnpm config:check` lista ambas deudas, agrupadas por fichero.

`pnpm config:seed` copia `sugerido → valor` en los valores que sigan a `null`,
para poder ejecutar el motor de punta a punta antes de haber contrastado cada
cifra. Tres límites deliberados: no toca `verificado`, no sobrescribe un `valor`
ya fijado, y **no siembra lo que no tiene `sugerido`**. Los tipos de ITP, los de
IVA y los tramos de arancel no los dio nunca el brief, así que se quedan a
`null` y el motor seguirá fallando en ellos hasta que se rellenen contra el BOE.
Para deshacerlo: `git checkout packages/config/data`.

Estado: **68 pendientes, 21 bloques sin verificar.** Los tipos de ITP y AJD de la
Comunitat Valenciana, el IVA de reforma y de obra nueva, la reducción de IRPF por
arrendamiento, los aranceles de notaría y registro y el reparto de gastos de
hipoteca de la Ley 5/2019 **sí están verificados**, leídos del BOE con cita
literal (ADR-016). Lo que queda pendiente es sobre todo las otras cinco CCAA, que
siguen como plantillas vacías.

Mientras quede un bloque sin verificar, la UI muestra un aviso rojo diciendo que
esa cifra no está contrastada.

### 4. Todo número de salida es un `TrazedValue`

```typescript
{ valor, fuente, fecha_dato, metodo, confianza, unidad, notas? }
```

`fecha_dato` es la fecha a la que se refiere el dato, no la de descarga. En la
base de datos el equivalente es la tabla `fuentes_datos`: ninguna ingesta inserta
un precio sin crear antes su fila de procedencia.

### 4 bis. Calibración: el modelo se contrasta, no se ajusta a ojo

`packages/engine/src/calibration/` son funciones puras que responden a tres
preguntas distintas:

- **Sensibilidad** — qué valor de config mueve más el resultado de este caso.
  Con 93 valores pendientes, dice cuáles verificar primero y cuáles pueden
  esperar. Perturba cada valor a los extremos de su horquilla (o ±10% si no la
  declara) y ordena por recorrido en euros.
- **Coherencia estado ↔ reforma** — el coeficiente de estado de T1 y el coste de
  obra de T3 hablan de lo mismo desde lados opuestos. Da el €/m² a partir del
  cual reformar compensa. Si ningún nivel compensa, T3 mandará siempre y el
  motor dirá que reformar destruye valor; puede ser cierto o puede ser que los
  coeficientes estén mal.
- **Contraste con comparables** — operaciones reales con su precio de cierre
  frente a lo que estima T1. Separa **sesgo** (el modelo se equivoca siempre en
  la misma dirección: coeficientes mal puestos) de **dispersión** (falla arriba
  y abajo: falta información en el modelo).

Los comparables salen de escrituras del Notariado por código postal o de pisos
que se han visitado. Nunca de un portal.

### 5. Nada de datos inventados

Antes de escribir código contra una API: petición real, respuesta guardada en
`fixtures/<fuente>/<caso>.json`, y se programa contra esa respuesta. Si un
endpoint no responde o ha cambiado, **se para y se avisa**. No se mockea en
silencio algo que parezca funcionar.

Y **no se scrapean portales inmobiliarios** (idealista, Fotocasa, Habitaclia,
pisos.com). Sus términos lo prohíben, y hacerlo vía Apify o servicios de terceros
subcontrata el riesgo en lugar de eliminarlo. Los datos de un anuncio los
introduce el usuario a mano.

---

## Convenciones

**Idioma.** El dominio inmobiliario y fiscal español va en español: `ITP`,
`derrama`, `valor_referencia`, `superficie_util`, `techo_limitante`. No tienen
equivalente inglés sin perder precisión jurídica, y el brief ya los usaba así en
sus ejemplos de tipos. La fontanería va en inglés: nombres de fichero, tipos de
infraestructura, puertos de adaptadores, mensajes de commit.

**Ficheros y commits.** `kebab-case.ts`. Commits pequeños, en inglés, en
imperativo.

**Errores.** Clases con nombre y contexto estructurado, nunca `throw new Error`
pelado: `MissingConfigError(ruta, detalle)`, `SourceUnavailableError(fuente,
motivo, url)`, `SinDatoError(fuente, consulta)`.

**Sin acentos en el código.** Los ficheros `.ts` y `.json` van sin tildes en
comentarios e identificadores para no depender de la codificación de la consola.
La documentación en Markdown y los textos de la UI sí llevan acentos.

---

## Decisiones (ADR)

### ADR-001 — Drizzle en lugar de Prisma
Drizzle es SQL-first y TypeScript puro. Pesa dos cosas: PostGIS se usa con SQL
tipado sin pelearse con el ORM, y en la Pi arm64 no hay query engines binarios
que descargar ni compilar. Prisma habría dado mejor DX a cambio de fricción en el
despliegue y de `$queryRaw` sin tipar para toda la parte geográfica.

### ADR-002 — `CalcInput` compuesto, no intersección
El brief describía `calcularPrecioMaximo(input: PropertyInput & BuyerProfile &
MarketData)`. Se usa un objeto compuesto porque la intersección colisionaría en
nombres de campo y porque la configuración tiene que entrar también: el motor no
lee ficheros, así que recibe la config ya cargada y validada.

### ADR-003 — Next 16, no 15
El brief pedía Next.js 15. Se usa 16.3.2, la estable actual: proyecto nuevo, sin
código heredado que migrar, y App Router es el mismo. Con Tailwind v4. `shadcn`
se añadirá en la Fase 4, cuando haya formularios reales que vestir; los tokens de
color de `globals.css` ya están puestos para que encaje sin repintar.

### ADR-004 — Los paquetes internos se publican como TypeScript sin compilar
`exports` apunta directamente a `src/index.ts`, sin paso de build. Next los
transpila vía `transpilePackages`, y `tsx` y Vitest los leen nativamente. Un paso
de compilación por paquete no aportaría nada en un monorepo privado.

### ADR-005 — PostgreSQL nativo en la Pi, y el desarrollo va por túnel SSH
En la Pi la base va nativa desde apt: con 4 GB, meterla en un contenedor solo
añade consumo.

En local **no hay base propia**, y no por gusto. Docker Desktop de esta máquina
está en modo *contenedores Windows* porque ahí vive un entorno de Business
Central, y la imagen de PostGIS es Linux: levantarla exige cambiar el daemon y
dejar ese entorno inaccesible hasta volver a cambiarlo. No compensa. El
desarrollo apunta al PostgreSQL de la Pi a través de un túnel SSH
(`pnpm db:tunnel`), que mapea su 5432 al 55432 local — el mismo puerto que
usaría el contenedor, así que el `DATABASE_URL` es idéntico.

El PostgreSQL de la Pi **sigue escuchando solo en localhost**: el túnel evita
abrirlo a la LAN, que era la alternativa y es peor.

Contrapartida, y hay que tenerla presente: desarrollo y producción comparten
base. Hoy da igual porque ahí no hay datos reales todavía, pero **en cuanto la
Fase 3 empiece a ingestar MITMA e INE habrá que separarlas** — segunda base en la
misma Pi, o volver a Docker si para entonces el modo Linux no estorba.

`docker-compose.yml` se queda en el repo: funciona tal cual si algún día el
daemon está en modo Linux.

### ADR-006 — `VP_CONFIG_DIR` explícito en producción
`@vp/config` lee los JSON con `readFileSync` resolviendo desde `import.meta.url`.
El bundle standalone de Next mueve los ficheros compilados, así que esa ruta
relativa deja de apuntar a `data/`. En la Pi el servicio arranca con
`VP_CONFIG_DIR=/home/isaac/vp/packages/config/data`. Efecto secundario útil:
ajustar un tipo de ITP es editar un JSON y reiniciar, sin reconstruir. Si el
directorio no existe, `configDir()` lanza en el arranque en lugar de fallar tres
capas más abajo.

### ADR-007 — La depreciación por antigüedad es relativa, no absoluta
El brief pedía depreciación por vida útil residual (art. 18 ECO/805). Aplicada en
absoluto sobre el €/m² de la zona hay **doble conteo**: ese €/m² ya incorpora la
antigüedad media del parque del barrio, así que un piso viejo se penaliza dos
veces. El coeficiente se calcula relativo a
`coeficientes.antiguedad.edad_referencia_zona_anios`; con 0 el resultado es
exactamente la depreciación absoluta del brief y el motor emite el aviso
`ANTIGUEDAD_ABSOLUTA`. Poner ahí la antigüedad media del parque de la zona lo
corrige.

### ADR-008 — Ante la duda fiscal, el tipo menos favorable
Cuando no se puede comprobar si una bonificación de ITP aplica (falta el límite
de renta del comprador, por ejemplo), se calcula con el tipo general y se emite
aviso. Un techo calculado sobre una bonificación que luego no te conceden te
lleva a ofrecer de más, que es el error caro; al revés solo deja margen de sobra.
Lo mismo con el IVA de la reforma cuando no hay valor catastral.

### ADR-009 — El valor de referencia se contrasta con el precio final
El aviso `VALOR_REFERENCIA_MANDA` compara el valor de referencia catastral con el
**precio máximo recomendado**, no con el techo de T2. T2 suele quedar muy por
encima del precio final, así que comprobarlo solo ahí dejaba el aviso sin
dispararse justo en el caso que más importa: pagas 42.000 y tributas sobre
120.000. El aviso de T2 se sustituye por el final para no dar dos cifras
distintas bajo el mismo código.

### ADR-012 — El margen de seguridad de T3 va sobre el coste de obra
El brief lo definía como 10% del valor reformado. Protege de que **la obra** se
desvíe, así que tiene que escalar con la obra: sobre el valor del inmueble, un
lavado de cara de 17.000 € cargaba los mismos 9.400 € de margen que una reforma
premium de 105.000 €. Además consumía el 38% del salto entre los coeficientes
de estado, y con ello T3 quedaba por debajo de T1 en cualquier mercado por
debajo de ~1.400 €/m², haciendo que el motor concluyera siempre que reformar
destruye valor. Con el cambio, el equilibrio del nivel más barato pasa de 1.285
a 872 €/m². Ojo: el margen se apila sobre `imprevistos`, que tiene la misma base.

### ADR-013 — El tope global de coeficientes no debe hacer el trabajo del modelo
Estaba en 0,60. Un piso a reformar, sin ascensor, con CEE G y de los 70 da un
producto de 0,39, así que el tope se tragaba todo: **37 de los 39 coeficientes
dejaban de mover el resultado**. La valoración la decidían el tope y la edad de
referencia, no las características del piso. Bajado a 0,45 con horquilla
0,40-0,70, y sigue emitiendo `COEFICIENTE_GLOBAL_TOPADO` cuando actúa: si salta
a menudo, o el tope está mal puesto o los coeficientes penalizan de más.

### ADR-015 — La antigüedad del parque es dato de mercado, no config
Describe la zona, igual que el precio, así que viaja en `MarketData.antiguedad_parque`
y el valor de `coeficientes.json` queda solo como respaldo. Se calcula con
`pnpm ingest:antiguedad <codigoCatastro>` desde el dataset INSPIRE de edificios,
**ponderando por número de viviendas y no por edificios**: el precio de
referencia es por vivienda, así que un bloque de 40 pisos pesa cuarenta veces
más que un unifamiliar del mismo año. Y debe describir la misma población que el
precio: si el precio es de vivienda de más de cinco años, la edad también.

Para Castellón de la Plana salen **44,8 años** sobre 86.887 viviendas. Con ese
dato, el parámetro que antes decidía el 88% de T1 desaparece del ranking de
sensibilidad y el tope global deja de atar.

Con el dataset de direcciones se cruza además por código postal. El contraste
dentro del municipio es grande —casco antiguo 12001 en 62,7 años frente a 37,7
en el 12006— pero **el Grao (12100) sale en 43,95, casi la media municipal**, así
que ahí el ajuste por barrio cambia T1 un 1,5%. El desglose queda guardado sin
usar: con precio municipal hay que usar edad municipal, y mezclar el precio medio
de la ciudad con la edad de un barrio es peor que no afinar.

### ADR-021 — El factor construida→útil se cancela más veces de las que parece
Cuando la superficie declarada del piso y la base del precio de referencia son
del **mismo tipo**, el factor de conversión multiplica los metros y divide el
€/m² en la misma proporción: **se cancela y no afecta a T1 en absoluto**. Con
0,78, 0,82 o 0,90 sale exactamente el mismo techo, y hay tests que lo fijan.

Solo importa cuando las bases difieren —el caso típico, precio de MITMA en
construida sin comunes contra superficie de anuncio con comunes— y entonces lo
que entra en el resultado no es cada factor sino **la razón entre los dos**. El
motor emite `CONVERSION_SUPERFICIE_ASIMETRICA` justo en ese caso.

Consecuencia práctica: no merece la pena verificar el factor absoluto. Y no se
puede sacar del Catastro: su dataset INSPIRE publica **solo `grossFloorArea`**,
23.033 de 23.033 edificios; la superficie útil no es un dato catastral. La única
vía es contrastar pares (construida, útil) de notas simples de pisos reales.

### ADR-022 — El campo que parece la superficie del piso no lo es
`debi.sfc` de la ficha catastral es el **total imputado al inmueble**: vivienda
más anejos más parte proporcional de elementos comunes. En el caso base son
155 m², que se desglosan en `lcons` como 101 de vivienda, 6 de trastero, 26 de
garaje y 22 de comunes — suman 155 exactos. Llevar esos 155 a T1 como si fueran
los metros del piso **infla el techo de mercado un 53%**, y encima valora garaje
y trastero al €/m² de la vivienda.

El adaptador reparte el desglose y da las tres cifras por separado. A T1 va la
de la **vivienda**, que es construida sin comunes, la misma base que declara
MITMA. `vivienda + comunes` queda disponible como `construida_con_comunes` para
cuando el precio de referencia venga en esa base. Si el desglose no cuadra con
el total, `desglose_cuadra: false` y se avisa en vez de repartir a ojo.

De paso: la cuota de participación (`cpt`) viene en **porcentaje** con coma
decimal, no en tanto por uno. Comprobado sobre la parcela entera: las 27 cuotas
suman 100,000000 exacto.

### ADR-023 — Los servicios web del Catastro siguen en `meh`, y el brief traía tres erratas
El brief avisaba de la migración `minhap` → `hacienda`. Es cierta para el portal
y para INSPIRE, pero **no alcanzó a los servicios web**: `ovc.catastro.meh.es`
responde y `ovc.catastro.hacienda.gob.es` ni siquiera resuelve. Además:

- El parámetro de `Consulta_DNPRC` es **`RefCat`**, no `RC`. Con `RC` devuelve
  el error 17, «la referencia catastral es obligatoria».
- `Consulta_RCCOOR` y `Consulta_CPMRC` **no tienen interfaz JSON**. La fachada
  `CoordenadasDistancia.svc/json` devuelve una página HTML de error con
  cualquier combinación de parámetros. La que responde es la HttpGet del
  `.asmx`, en XML. Su WSDL declara `CoorX`/`CoorY`, pero la HttpGet los espera
  como `Coordenada_X`/`Coordenada_Y`, y `Coordenada_X` es la **longitud**.
- `Consulta_CPMRC` solo acepta referencias de 14 caracteres: las coordenadas son
  de la parcela, no del inmueble.

Por esos dos endpoints XML **no se añade un parser al proyecto**: son 638 bytes,
un solo espacio de nombres y sin atributos en los datos. El lector es
deliberadamente estrecho y lanza si no encuentra lo que espera, en lugar de
devolver ceros; los tests contra el fixture cantan cualquier cambio de formato.

La Oficina Virtual responde **200 con HTML** cuando rechaza una petición, así
que tanto el adaptador como `capture:fixture` detectan el HTML y paran. Guardar
esa página como fixture sería programar contra basura.

### ADR-024 — El valor de referencia exige certificado, y no se rodea
Comprobado sobre la sede: la consulta pide «Certificado electrónico de
identificación o DNI electrónico» o «Cl@ve PIN - Cl@ve permanente», también
para un inmueble propio. No hay vía anónima.

El brief era explícito: si requiere autenticación, no se intenta rodear. El
adaptador es `modo: 'manual'` — da el enlace y los pasos, y recoge la cifra que
el usuario haya leído con su ejercicio y su fecha. Sin ese dato **lanza**, no
devuelve cero: desde la Ley 11/2021 la base imponible del ITP es
`max(precio, valor de referencia)`, así que un valor inventado son euros de
impuesto mal calculados.

### ADR-025 — La correspondencia provincia → CCAA vive en la config, no en el código
El Catastro da provincia; el tipo de ITP depende de la comunidad. Esa
correspondencia es un dato administrativo y por la regla 2 no puede estar en un
`.ts`: se ha añadido `codigos_provincia_ine` a cada bloque de `itp.json`,
tomado de la **API del INE** (variables 70 y 115, con fixture guardado), no
escrito de memoria. Las seis comunidades de la config resuelven; una provincia
de las otras trece devuelve `null` y el puente lo dice en vez de suponer.

### ADR-016 — Los datos fiscales se leen del BOE, no de resúmenes
Los tipos de ITP, IVA, IRPF y los aranceles vienen de los textos **consolidados**
del BOE, leídos por su API de legislación consolidada:

```
https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/{ID}/texto/indice   (Accept: application/json)
https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/{ID}/texto/bloque/{BLOQUE}   (Accept: application/xml)
```

El bloque devuelve **todas las versiones históricas** del artículo: hay que
quedarse con la última cuya `fecha_vigencia` sea anterior o igual a hoy. Cada
valor lleva en su JSON `_fuente`, `_cita` con el texto literal, `articulo` y
`vigencia_desde`.

Esto no es pedantería. La página de la Agència Tributària Valenciana daba una
tabla más simple que la ley: se saltaba el tramo del 11% por encima del millón y
la partición de cada bonificación en dos tramos por valor. Un resumen no sirve.

### ADR-017 — El brief se equivocaba en la condición del IVA de reforma
Decía que el tipo reducido exige que el coste de la obra no supere el doble del
valor catastral. Esa regla **no aparece** en el art. 91.Uno.2.10 LIVA. La tercera
condición real es que los **materiales aportados por quien ejecuta la obra no
superen el 40% de la base imponible**. Se ha corregido: `ReformaPrevista` lleva
ahora `coste_materiales_pct` y la config el límite legal. Sin ese desglose en el
presupuesto se aplica el tipo general y se avisa.

### ADR-018 — El modelo de config tuvo que crecer para representar la ley
Tres cosas no cabían en el esquema original y se han añadido:
`tipo_general.tramos` (el tipo depende del valor del inmueble y se aplica al
total, no es escala progresiva), `valor_inmueble_desde` (las bonificaciones se
parten en dos tramos por valor, y sin este campo el motor cogía siempre el tipo
más bajo de los dos), y `limite_base_imponible_irpf` como `{individual,
conjunta}` (la norma da dos cifras y usar la que no toca decide mal la
bonificación).

### ADR-019 — ESLint con una sola config plana en la raíz
`next lint` desapareció en Next 16, así que el linter se monta aparte:
`eslint.config.mjs` en la raíz cubre los seis proyectos y `pnpm lint` ejecuta
`eslint .`. Sin reglas de estilo — solo las que atrapan errores reales, con
`no-explicit-any` en error: un `any` en un motor que calcula euros es
exactamente lo que no queremos.

### ADR-020 — Sin Caddy delante
La Pi tiene Caddy instalado pero parado, y otras aplicaciones en 8080 y 8129. La
app escucha directamente en el 8090. Un proxy inverso para una herramienta
personal en LAN añade una pieza que puede fallar sin aportar nada. Queda
`infra/pi/Caddyfile.example` para cuando haga falta TLS o autenticación.

---

## Restricciones legales

- **No es una tasación.** La Orden ECO/805/2003 (modificada por ECM/599/2025)
  regula las tasaciones de entidades de crédito y sociedades homologadas para
  finalidades financieras. Esto es soporte a la decisión de un particular.
- El disclaimer es **permanente y no cerrable**, en la UI y en cada informe. Está
  en el `layout.tsx` raíz y en `negociacion.json`.
- Sin scraping de portales.
- Sin datos personales de terceros: solo el inmueble y el perfil del propio
  usuario.
- Si algún día se publica fuera de la LAN: RGPD, aviso legal y política de
  privacidad antes de abrir el puerto.

---

## Plan por fases

Al terminar cada fase se para y se espera visto bueno.

- [x] **Fase 0** — Andamiaje: monorepo, Docker Compose, esquema de BD, tipos del dominio, despliegue en la Pi.
- [x] **Fase 1** — Motor puro, los cuatro techos, 181 tests. **La fase que decide si el proyecto sirve.**
- [x] **Fase 2** — Adaptador de Catastro: `pnpm ficha <RC>`, 47 tests contra fixtures reales.
- [ ] **Fase 3** — Ingesta batch: MITMA + INE.
- [ ] **Fase 4** — Web mínima: formulario → resultado → desglose trazable.
- [ ] **Fase 5** — Informe PDF con argumentario y fuentes.
- [ ] **Fase 6** — Modo inversor: SERPAVI, zonas tensionadas, flipping.
- [ ] **Fase 7** — Riesgos: CEE, checklist pre-firma, alertas bloqueantes.
