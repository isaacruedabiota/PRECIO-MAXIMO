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

**Fase 1, primera entrega** — T1, T2, T3, descuentos por riesgo y bloqueantes
implementados, con 106 tests. `calcularPrecioMaximo` devuelve un resultado
completo y trazable en modo residencia.

**T4 (rentabilidad) todavía no está.** En modo inversor el motor lanza
`NotImplementedError` en lugar de devolver un precio que ignore un techo que
podría ser el que manda. Es la segunda entrega de la Fase 1.

---

## Arranque

```bash
pnpm install

# Base de datos de desarrollo (Docker Desktop tiene que estar arrancado)
pnpm db:up
cp .env.example .env
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
packages/adapters   Puertos de las fuentes de datos. Sin implementaciones aún.
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

Estado tras sembrar: **74 valores sembrados, 93 pendientes, 43 bloques sin
verificar.** Mientras quede un bloque sin verificar, la UI muestra un aviso rojo
diciendo que ninguna cifra está contrastada.

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

### ADR-005 — PostgreSQL nativo en la Pi, Docker solo en local
La Pi tiene 4 GB: meter la base en un contenedor solo añade consumo. En Windows,
Docker mantiene el desarrollo aislado y reproducible. Son dos bases distintas a
propósito — así los datos de prueba no ensucian lo que se está usando de verdad.

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

### ADR-014 — ESLint con una sola config plana en la raíz
`next lint` desapareció en Next 16, así que el linter se monta aparte:
`eslint.config.mjs` en la raíz cubre los seis proyectos y `pnpm lint` ejecuta
`eslint .`. Sin reglas de estilo — solo las que atrapan errores reales, con
`no-explicit-any` en error: un `any` en un motor que calcula euros es
exactamente lo que no queremos.

### ADR-015 — Sin Caddy delante
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
- [~] **Fase 1** — Motor puro. **La fase que decide si el proyecto sirve.**
  - [x] T1 mercado, T2 financiero-fiscal, T3 reforma, descuentos, bloqueantes, argumentario. 106 tests.
  - [ ] T4 rentabilidad: alquiler y flipping.
- [ ] **Fase 2** — Adaptador de Catastro.
- [ ] **Fase 3** — Ingesta batch: MITMA + INE.
- [ ] **Fase 4** — Web mínima: formulario → resultado → desglose trazable.
- [ ] **Fase 5** — Informe PDF con argumentario y fuentes.
- [ ] **Fase 6** — Modo inversor: SERPAVI, zonas tensionadas, flipping.
- [ ] **Fase 7** — Riesgos: CEE, checklist pre-firma, alertas bloqueantes.
