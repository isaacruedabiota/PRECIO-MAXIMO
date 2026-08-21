# Calculadora de precio máximo de compra de vivienda (España)

> Brief original del proyecto, versionado como especificación de referencia.
> Cuando el código y este documento discrepen, gana este documento salvo que la
> discrepancia esté registrada como ADR en `CLAUDE.md`.
>
> **Despliegue**: self-hosted en una Raspberry Pi 4 en la LAN de casa. Ver `infra/pi/`.

---

## 0. Rol y contexto

Herramienta personal (self-hosted, sin pretensión comercial de momento) que responde a **una sola pregunta**:

> "Dado este piso concreto, ¿cuál es el precio máximo que yo debería pagar por él, y por qué?"

No es un tasador. No es un portal. No es un chatbot. Es un **motor de decisión trazable**: cada euro del resultado tiene que poder rastrearse hasta una fuente oficial con fecha.

Caso de uso primario: **Comunitat Valenciana** (Castellón), pero el diseño debe ser multi-CCAA desde el día uno.

**Idioma**: interfaz, informes y comentarios de dominio en español. Identificadores de código, nombres de fichero y commits en inglés.

---

## 1. El modelo de dominio: los cuatro techos

El precio máximo NO es "el valor de mercado". Es el **mínimo de cuatro techos independientes**, menos los descuentos por riesgo:

```
PRECIO_MAXIMO = min(T1, T2, T3, T4) - Σ(descuentos_riesgo)
```

| Techo | Nombre | Pregunta que responde |
|---|---|---|
| **T1** | Techo de mercado | ¿Cuánto se está pagando realmente por pisos comparables? |
| **T2** | Techo financiero-fiscal | ¿Hasta dónde llega mi ahorro y mi capacidad de pago, con todos los impuestos y gastos dentro? |
| **T3** | Techo de reforma | Si hay que reformarlo, ¿cuánto puedo pagar para que el total (compra + reforma) no supere el valor final? |
| **T4** | Techo de rentabilidad | Si es inversión, ¿qué precio hace que la operación dé mi rentabilidad objetivo? |

T4 solo aplica en modo inversor. T3 solo si el estado del inmueble ≠ "listo para entrar".

La salida además incluye un **precio de entrada en negociación** (típicamente `PRECIO_MAXIMO × 0.88–0.92`) y un **argumentario** con las fuentes citadas para llevar a la mesa.

---

## 2. Especificación del motor de cálculo

### T1 — Techo de mercado

**Paso 1: precio base €/m².** Cascada de fuentes, de más a menos granular. Registra siempre cuál se ha usado:

1. Notariado (penotariado) — €/m² de escritura por **código postal**. Es el dato rey: precio real, no de oferta.
2. MITMA — valor tasado de vivienda libre por **municipio** (>25.000 hab).
3. MITMA — **provincia**.

**Paso 2: actualización temporal.** Los datos vienen con retraso trimestral. Aplica la variación del IPV (INE) de la CCAA desde la fecha del dato hasta hoy:
`precio_base_actualizado = precio_base × (1 + Δ_IPV)`

**Paso 3: homogeneización.** Coeficientes multiplicativos sobre el €/m². **Todos configurables**, ninguno hardcodeado. Valores semilla (verificables y ajustables):

| Factor | Rango | Notas |
|---|---|---|
| Estado de conservación | 0.78–1.15 | A reformar 0.78–0.85 · Buen estado 1.00 · Reformado reciente 1.08–1.15 |
| Planta | 0.90–1.08 | Bajo 0.90 · 1ª–2ª 0.98 · Intermedia 1.00 · Ático 1.05–1.08 |
| Ascensor | 0.85–1.00 | Sin ascensor: penaliza progresivamente por planta (3ª −10%, 4ª −13%, 5ª+ −15%) |
| Exterior/interior | 0.92–1.00 | Interior 0.92 |
| Orientación | 0.97–1.03 | Norte 0.97 · Sur 1.03 |
| Certificado energético | 0.93–1.05 | A/B +3–5% · C/D 1.00 · E 0.98 · F/G −3–7% |
| Antigüedad | curva | Depreciación por vida útil residual (metodología art. 18 ECO/805). Edificio pre-1980 sin rehabilitar penaliza extra por instalaciones |
| Superficie atípica | 0.95–1.00 | Si supera el P90 de la zona, penaliza por menor liquidez |

**Anexos como valor absoluto, no coeficiente**: garaje, trastero, terraza >8 m² se suman al final con su propio €/unidad de zona.

**Paso 4: superficie.** Trabaja SIEMPRE en **superficie útil**. Si solo tienes construida, aplica factor 0.78–0.85 y **márcalo como estimación**. La diferencia entre 80 m² construidos y 65 m² útiles son decenas de miles de euros.

**Salida de T1**: `{ valor_central, rango_p25, rango_p75, n_comparables, confianza: alta|media|baja, fuente_usada, fecha_dato }`

La confianza baja automáticamente si: se ha usado fallback provincial, hay menos de 15 transacciones en el CP, o la superficie es estimada.

---

### T2 — Techo financiero-fiscal

**Gastos de compra** (todos sobre segunda mano; obra nueva es otra rama: IVA 10% + AJD):

```
ITP        = base_imponible × tipo_ITP(CCAA, perfil_comprador)
notaría    ≈ arancel por escalado sobre precio (configurable)
registro   ≈ arancel por escalado sobre precio (configurable)
gestoría   ≈ 300–500 € (fijo configurable)
tasación   ≈ 300–600 € (fijo configurable)
```

**REGLA CRÍTICA — base imponible del ITP.** Desde la Ley 11/2021, la base imponible de ITP en transmisiones de inmuebles es el **valor de referencia del Catastro**, salvo que el precio escriturado sea superior, en cuyo caso manda el precio. Es decir:

```
base_imponible_ITP = max(precio_escriturado, valor_referencia_catastral)
```

Esto tiene una consecuencia enorme y poca gente la modela: **si el valor de referencia está por encima del precio que negocias, pagas ITP sobre el valor de referencia**. El motor debe avisarlo de forma destacada, porque cambia el coste real de la operación y por tanto el máximo que puedes ofrecer.

**Resolución del techo.** Dos restricciones, se coge la menor:

*(a) Restricción de ahorro* — con LTV máximo del 80%, la entrada más los gastos tienen que caber en el ahorro:
```
ahorro_disponible ≥ 0.20 × P + gastos(P)
```
Resuelve para `P`. Ojo: `gastos(P)` depende de `P` de forma no lineal por los aranceles escalados y por el `max()` del valor de referencia → resuelve numéricamente (bisección), no algebraicamente.

*(b) Restricción de cuota* — cuota hipotecaria ≤ ratio de esfuerzo × ingresos netos mensuales:
```
cuota = C × i / (1 − (1+i)^−n)        [sistema francés]
donde C = 0.80 × P, i = tipo_mensual, n = meses
```
Ratio de esfuerzo por defecto 30%, configurable hasta 35%. Con tipo variable, **calcula también el escenario de estrés** (euríbor +2 pp) y avisa si la cuota estresada rompe el 40%.

`T2 = min(P_ahorro, P_cuota)`

**Tipos de ITP.** NUNCA los hardcodees. Van en `packages/config/itp.json`. Deja **todos** los tipos a `null` y `verificado: false`. Si el motor recibe un tipo `null`, debe **fallar ruidosamente**, no asumir un valor por defecto. Un ITP mal puesto son 8.000 € de error en un piso de 200.000 €.

Semilla mínima de CCAA a estructurar (aunque vacías): Comunitat Valenciana, Madrid, Cataluña, Andalucía, Murcia, Aragón.

---

### T3 — Techo de reforma

```
coste_reforma = Σ(partidas) × (1 + imprevistos) × (1 + IVA)
T3 = valor_mercado_reformado − coste_reforma − margen_seguridad
```

**Módulos €/m² útil** (configurables, semilla orientativa):

| Nivel | €/m² | Qué incluye |
|---|---|---|
| Lavado de cara | 150–250 | Pintura, suelos flotantes, carpintería interior |
| Reforma parcial | 300–500 | Lo anterior + un baño + cocina |
| Reforma integral | 700–900 | Todo + fontanería + electricidad + ventanas + distribución |
| Integral premium | 1.000–1.400 | Con calidades altas, aerotermia, domótica |

**Partidas singulares** (importe absoluto, no €/m²): sustitución de bajante comunitaria, refuerzo estructural, retirada de fibrocemento, instalación de ascensor, aerotermia, rehabilitación de fachada.

**Provisión de imprevistos: 15% por defecto**, subible al 25% si el edificio es anterior a 1970 o no hay proyecto cerrado.

**IVA**: 10% en obras de rehabilitación de vivienda que cumplan el art. 91 LIVA (vivienda con ≥2 años de antigüedad, destino particular, y coste que no supere el doble del valor catastral). Si no se cumplen las condiciones, 21%. Modela ambos casos y avisa cuál aplica.

**Margen de seguridad**: 10% del valor reformado por defecto.

---

### T4 — Techo de rentabilidad (modo inversor)

**Modo alquiler (buy & hold):**
```
ingresos_brutos_anuales = renta_mensual × 12 × (1 − tasa_vacancia)
gastos_anuales = IBI + comunidad + seguro + mantenimiento + gestión + IRPF_estimado
NOI = ingresos_brutos_anuales − gastos_anuales
T4 = (NOI / rentabilidad_neta_objetivo) − gastos_compra − coste_reforma
```

Valores por defecto: vacancia 6%, mantenimiento 1% del valor/año, gestión 0% (autogestión) u 8% (agencia), seguro 250 €/año, rentabilidad neta objetivo 4,5% (parametrizable).

Renta de mercado: SERPAVI como fuente primaria. **Comprueba si el municipio está declarado zona de mercado residencial tensionado** — si lo está, el índice de referencia limita la renta de nuevos contratos y eso tumba T4. Es un input, no un adorno.

Calcula y muestra también: rentabilidad bruta, rentabilidad neta, cash-on-cash con apalancamiento, y años de recuperación.

**Modo flipping:**
```
T4 = ARV × 0.72 − coste_reforma
```
Donde ARV = valor de mercado una vez reformado. El 0,72 es configurable; ese 28% cubre gastos de compra, financieros, fiscales, de comercialización y el margen. Muestra el desglose de a dónde va ese 28%.

---

### Descuentos por riesgo

Se restan del mínimo de los cuatro techos. Cada uno con su importe y su justificación:

| Riesgo | Tratamiento |
|---|---|
| Derramas aprobadas en junta | Importe absoluto (input del usuario, del acta) |
| ITE desfavorable o no pasada | Estimación configurable por m² de fachada/edificio |
| Cargas registrales (hipoteca, embargo, servidumbre) | Importe absoluto de la nota simple |
| Fibrocemento en cubierta | Coste de retirada estimado |
| Zona inundable / suelo contaminado | Descuento porcentual + aviso destacado |
| Afección urbanística (fuera de ordenación, alineación) | Aviso **bloqueante**: puede impedir reformar o rehipotecar |
| Sin división horizontal | **Bloqueante**: imposibilita la hipoteca |
| VPO con precio máximo vigente | **Bloqueante**: el precio lo fija la administración |

Los bloqueantes no descuentan: paran el cálculo y muestran una alerta roja.

---

## 3. Fuentes de datos

> **Regla absoluta**: antes de escribir una sola línea de código contra cualquiera de estas APIs, haz una petición real, guarda la respuesta en `fixtures/<fuente>/<caso>.json` y programa contra la respuesta real. Si un endpoint no responde o ha cambiado de dominio o esquema, **para y dilo**. No mockees en silencio algo que parezca funcionar.

### 3.1 Catastro — Oficina Virtual (gratis, sin registro, datos no protegidos)

Da: superficie construida, año de construcción, uso, coordenadas, tipología, participación, referencia catastral.

**SOAP** (documentación: `Webservices_Libres.pdf` en catastro.hacienda.gob.es):
- `OVCCallejero.asmx` → `Consulta_DNPRC` (por referencia catastral), `Consulta_DNPLOC` (por dirección), `ConsultaProvincia`, `ConsultaMunicipio`, `ConsultaVia`, `ConsultaNumero`
- `OVCCoordenadas.asmx` → `Consulta_RCCOOR`, `Consulta_CPMRC`, `Consulta_RCCOOR_Distancia`

**REST/JSON** (más cómodo, mismo servicio):
- `.../OVCServWeb/OVCWcfCallejero/COVCCallejero.svc/json/Consulta_DNPRC?Provincia=&Municipio=&RC=`

**INSPIRE (geometrías):** WFS de Buildings (`wfsBU`), Cadastral Parcels (`wfsCP`) y Addresses (`wfsAD`), más descarga ATOM completa por municipio.

⚠️ Los dominios han migrado (`minhap` → `hacienda`) y hay mezcla http/https con certificados problemáticos. **Verifica cada endpoint antes de usarlo.**

### 3.2 Valor de referencia del Catastro

Necesario para el ITP (ver regla crítica en T2). Investiga si es consultable sin certificado digital para un inmueble ajeno. **Si requiere autenticación, no intentes rodearlo**: diseña el flujo para que el usuario lo consulte manualmente en la sede y lo introduzca a mano, con un enlace directo y las instrucciones.

### 3.3 Notariado — penotariado.com

Precio real de escritura por código postal. Público y gratuito, sin API documentada. Opciones, por orden de preferencia:
1. Buscar dataset descargable o endpoint JSON público documentado.
2. Si no existe, **adaptador con carga manual/CSV**: el usuario consulta su CP en el portal y pega el €/m².

Diseña `NotariadoAdapter` detrás de una interfaz para poder cambiar la implementación sin tocar el motor.

### 3.4 MITMA — Ministerio de Transportes

Serie **35103500**, valor tasado de vivienda libre por municipio y provincia, trimestral, XLS descargable. Ingesta batch a la BD.

### 3.5 INE

API JSON pública, sin clave: `https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/{idTabla}?nult=N`
Necesitas el IPV por CCAA, general / nueva / segunda mano. Localiza los IDs de tabla correctos y guárdalos en config.

### 3.6 Geocodificación

- CartoCiudad / IGN: `https://geolocalizador.idee.es/v1/reverse?point.lat=&point.lon=&size=1` (GeoJSON)
- Y el propio Catastro para dirección ↔ RC ↔ coordenadas

### 3.7 Certificados de eficiencia energética

Registros autonómicos, cada CCAA por su cuenta. Empieza por el de la Generalitat Valenciana y busca el resto vía datos.gob.es. Es el dato que más se está moviendo en valoración desde la reforma de 2025 de la ECO/805.

### 3.8 SERPAVI y zonas tensionadas

Índice estatal de referencia del alquiler + listado de municipios declarados zona de mercado residencial tensionado por CCAA. Input directo de T4.

### 3.9 Euríbor

Banco de España o BCE, serie histórica del euríbor a 12 meses. Para el escenario de estrés de T2.

### 3.10 ❌ PROHIBIDO

**No scrapees idealista, Fotocasa, Habitaclia, pisos.com ni ningún portal.** Sus términos prohíben expresamente el uso de mecanismos automáticos de extracción de contenido. Tampoco vía Apify ni servicios de scraping de terceros: eso subcontrata el riesgo, no lo elimina.

En su lugar: **formulario donde el usuario introduce a mano los datos del anuncio que está mirando** (precio pedido, m², planta, estado, extras, días publicado).

---

## 4. Stack y arquitectura

Monorepo pnpm.

```
/apps
  /web              Next.js (App Router) + TypeScript + Tailwind + shadcn/ui
/packages
  /engine           Motor de cálculo. TypeScript PURO. CERO I/O. 100% testeable.
  /adapters         Un adaptador por fuente. Interfaz común. Caché en BD.
  /config           JSON versionado: itp.json, coeficientes.json, reforma.json, aranceles.json
  /db               PostgreSQL + PostGIS.
/scripts            CLI de ingesta: ingest:mitma, ingest:ine, ingest:cee...
/fixtures           Respuestas reales capturadas de cada API
docker-compose.yml  Postgres + PostGIS
CLAUDE.md
```

**Contrato del motor.** `packages/engine` expone una única función pura:

```typescript
calcularPrecioMaximo(input: PropertyInput & BuyerProfile & MarketData): MaxPriceResult
```

Sin fetch, sin BD, sin fecha del sistema (la fecha entra como parámetro).

**Trazabilidad.** Todo valor numérico del resultado es:

```typescript
type TrazedValue = {
  valor: number;
  fuente: string;        // "Notariado CP 12100" | "MITMA municipal" | "input usuario"
  fecha_dato: string;    // ISO
  metodo: string;        // "comparación homogeneizada" | "arancel escalado"
  confianza: 'alta' | 'media' | 'baja';
}
```

**Si no puedes decir de dónde sale un número, no lo muestres.**

---

## 5. Restricciones legales (no negociables)

- La herramienta **no es una tasación**. La Orden ECO/805/2003 (modificada por ECM/599/2025) regula las tasaciones de entidades de crédito y sociedades homologadas para finalidades financieras. Esto es soporte a la decisión de un particular.
- Disclaimer **visible y permanente** en la UI y en cada informe: *"Valoración orientativa. No constituye tasación oficial a efectos de la Orden ECO/805/2003 ni sustituye el asesoramiento profesional."*
- No scraping de portales (ver 3.10).
- Sin datos personales de terceros. Solo el inmueble y el perfil del propio usuario.
- Si algún día se publica: RGPD, aviso legal, política de privacidad.

---

## 6. Plan por fases

**Al terminar cada fase, PARAR y esperar visto bueno antes de seguir.**

- **Fase 0** — Andamiaje: monorepo, Docker Compose, esquema de BD, `CLAUDE.md`, tipos del dominio. Sin lógica todavía.
- **Fase 1** — Motor puro. Los cuatro techos + descuentos, con tests unitarios. Datos de mercado entran a mano. **Esta es la fase más importante: si el motor no está bien, lo demás da igual.**
- **Fase 2** — Adaptador de Catastro. Una referencia catastral por CLI y sale la ficha del inmueble.
- **Fase 3** — Ingesta batch: MITMA + INE. Scripts CLI, tablas, caché.
- **Fase 4** — Web mínima. Formulario → resultado → desglose de los cuatro techos con trazabilidad.
- **Fase 5** — Informe: PDF descargable con el argumentario de negociación y todas las fuentes citadas.
- **Fase 6** — Modo inversor: SERPAVI, zonas tensionadas, flipping, comparativa de escenarios.
- **Fase 7** — Riesgos: CEE, checklist pre-firma, alertas bloqueantes.

---

## 7. Cómo trabajar

1. **No inventar nada.** Ni endpoints, ni esquemas de respuesta, ni tipos impositivos, ni coeficientes con aire de precisión. Si no está verificado, marcarlo como `verificado: false` y decirlo.
2. **Fallar ruidosamente.** Un dato ausente lanza error. Nunca un valor por defecto silencioso en algo fiscal o de mercado.
3. **Config sobre código.** Ningún número de negocio dentro de un `.ts`. Todo en `packages/config/*.json` con `vigencia_desde`, `fuente_url` y `verificado`.
4. **Tests primero en el motor.** Cada techo con sus casos límite antes de tocar la UI.
5. **Una fase cada vez.** No adelantarse. No generar 40 ficheros de golpe.
6. **Preguntar** cuando una decisión de producto no esté clara en este documento. Mejor cuatro preguntas que una suposición.
7. **Commits pequeños** con mensaje descriptivo en inglés.
8. **`CLAUDE.md`** en la raíz, mantenido al día: arquitectura, convenciones, cómo arrancar, decisiones tomadas y por qué.

---

## 8. Criterio de aceptación de la Fase 1

Debe pasar este caso:

> Piso en Castellón, código postal 12100 (El Grao). 85 m² construidos, sin dato de útiles. Planta 3ª sin ascensor. Edificio de 1978. Estado: a reformar. Certificado energético G. Precio pedido: 135.000 €. Derrama aprobada de 4.000 € para fachada. Comprador de 27 años, primera vivienda habitual, 45.000 € de ahorro, 2.100 €/mes netos.

Salida esperada:
- Los cuatro techos calculados y visibles por separado
- El mínimo identificado y el porqué
- Descuento de la derrama aplicado
- Aviso de que la superficie útil es estimada (confianza degradada)
- Aviso si el valor de referencia catastral supera el precio negociado
- Precio máximo + precio de entrada en negociación
- Argumentario con fuentes y fechas
