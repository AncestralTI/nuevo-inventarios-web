# Nuevo Inventarios — versión web

Réplica web del dashboard de Power BI **"Nuevo Inventarios"** (`Nuevo Inventarios.pbix`), construida a partir del análisis directo del archivo: mismas páginas, mismos filtros y las mismas medidas y fuentes de datos.

> **Estado actual: los 5 módulos reales del dashboard están completos y validados** — "An. Insumos", "An. Vinos", "An. Bebidas" (lado Ancestral) y "Om. Insumos", "Om. Bebidas" (lado omuH). Los cinco tienen datos y medidas reales (pipeline Node.js + frontend), construidos y verificados número por número contra el modelo Power BI real. "An. Vinos"/"An. Bebidas" comparten un pipeline (`pipeline/lib/anc-beb-vin-pipeline.mjs`); "Om. Insumos"/"Om. Bebidas" comparten otro (`pipeline/lib/omuh-pipeline.mjs` + `pipeline/lib/measures-omuh.mjs`), porque las medidas de "Omuh Beb" reutilizan literalmente medidas de "Omuh Insumos" (`[Vtas Anc Izi Om Ins]`, `[Cortesias Om Ins]`). Ver [ANALISIS_PBIX.md](./ANALISIS_PBIX.md) para el análisis exhaustivo del modelo original.

## Estructura confirmada del dashboard original

El PBIX compara dos marcas/negocios, cada una con sus propias páginas:

- **Ancestral**: **An. Bebidas** (✅ datos reales), **An. Vinos** (✅ datos reales), **An. Insumos** (✅ datos reales)
- **omuH**: **Om. Insumos** (✅ datos reales), **Om. Bebidas** (✅ datos reales)

(Existen además una página duplicada "Duplicate of Om. Insumos" y una página oculta de trabajo "Página 1", que no se muestran al usuario final en Power BI y tampoco se replican aquí.)

## Estructura del proyecto

```
nuevo-inventarios-web/
├── index.html                     # Shell de la aplicación (navegación por marca/página)
├── css/styles.css                  # Estilos
├── js/app.js                       # Lógica de navegación; delega "An. Insumos"/"An. Vinos"/"An. Bebidas" a sus módulos reales
├── js/pages/an-insumos.js          # Renderer de "An. Insumos" (slicers, tablas, gráfico)
├── js/pages/an-vinos.js            # Renderer de "An. Vinos" (mismo patrón, agrupado por Producto)
├── js/pages/an-bebidas.js          # Renderer de "An. Bebidas" (copia literal de an-vinos.js, mismo patrón)
├── data/an-insumos.json            # Salida del pipeline de An. Insumos (se regenera cada corrida)
├── data/an-vinos.json              # Salida del pipeline de An. Vinos (se regenera cada corrida)
├── data/an-bebidas.json            # Salida del pipeline de An. Bebidas (se regenera cada corrida)
├── data/om-insumos.json            # Salida del pipeline de Om. Insumos (se regenera cada corrida)
├── data/om-bebidas.json            # Salida del pipeline de Om. Bebidas (se regenera cada corrida)
├── js/pages/om-insumos.js          # Renderer de "Om. Insumos" (sin slicer Filtro Dif; agrupa por Tabla[Insumo])
├── js/pages/om-bebidas.js          # Renderer de "Om. Bebidas" (con Filtro Dif; agrupa por Producto)
├── pipeline/
│   ├── package.json
│   ├── build-an-insumos.mjs        # Orquestador: fetch + transform + medidas -> data/an-insumos.json
│   ├── build-an-vinos.mjs          # Wrapper delgado (fija categorías) -> data/an-vinos.json
│   ├── build-an-bebidas.mjs        # Wrapper delgado (fija categorías) -> data/an-bebidas.json
│   ├── build-om-insumos.mjs        # Wrapper delgado -> data/om-insumos.json
│   ├── build-om-bebidas.mjs        # Wrapper delgado -> data/om-bebidas.json
│   └── lib/
│       ├── sheets.mjs              # fetch + parseo CSV (Google Sheets publicados) + unpivot genérico
│       ├── izi-api.mjs             # login + fetch de ventas/Dim_Producto_iZi/movimientos (API iZi Soluciones)
│       ├── calendar.mjs            # réplica de la tabla calculada Calendar (WeekYear, WEEKNUM tipo Excel 2, etc.)
│       ├── measures-an-insumos.mjs # réplica en JS puro de las 13 medidas DAX de "Anc. Insumos"
│       ├── measures-anc-beb.mjs    # réplica en JS puro de las 15 medidas DAX de "Anc. Beb y Vin"
│       ├── anc-beb-vin-pipeline.mjs # orquestador COMPARTIDO de "An. Vinos"/"An. Bebidas" (fetch +
│       │                              cálculo, parametrizado por lista de categorías de página)
│       ├── measures-omuh.mjs       # réplica en JS puro de las 24 medidas DAX de "Omuh Insumos" (9)
│       │                              + "Omuh Beb" (15), con las funciones de atribución compartidas
│       │                              (insumoPorCodProducto, vtasAncIziOmuh, cortesiasOmuh, etc.)
│       └── omuh-pipeline.mjs       # orquestador COMPARTIDO de "Om. Insumos"/"Om. Bebidas" (fetch +
│                                      cálculo; ambos exponen build*Data() independientes pero
│                                      reutilizan los mismos loaders/funciones de atribución)
└── ANALISIS_PBIX.md                # Análisis exhaustivo del modelo PBIX (fuente de verdad)
```

## Cómo ejecutar localmente

Es HTML/CSS/JS plano, sin build step para el frontend. El pipeline sí es Node.js (>=20, usa `fetch` nativo, sin dependencias npm).

### 1. Correr el pipeline (genera/actualiza `data/an-insumos.json`)

```bash
# Bash / Git Bash
export IZI_EMAIL="..."
export IZI_PASSWORD="..."
node pipeline/build-an-insumos.mjs
```

```powershell
# PowerShell
$env:IZI_EMAIL = "..."
$env:IZI_PASSWORD = "..."
node pipeline/build-an-insumos.mjs
```

Qué hace: descarga las 4 hojas de Google Sheets publicadas de Ancestral (Compras Insumos, Salidas y
Mermas Ancestral, Matriz_de_Relaciones Ancestral, Inventarios Unitarios GS), hace login en la API de
iZi Soluciones y trae las ventas de los últimos 60 días, replica las tablas calculadas del modelo
(`Peso Porcion`, `PromedioSinOutliers`, columnas `Porciones calculadas`, `Calendar[WeekYear]`), calcula
las 13 medidas de la carpeta "Anc. Insumos" por insumo y semana (últimas 10 semanas), y escribe
`data/an-insumos.json` con el resumen semanal, el detalle diario (semana actual + anterior) y las
series para el gráfico.

Si se omiten `IZI_EMAIL`/`IZI_PASSWORD`, el pipeline igual corre pero `Vtas Anc Ins` (y las medidas que
dependen de ella: `Vtas Tot`, `Cierre`, `Dif`) quedan en 0/incompletas — se imprime una advertencia.

**Credenciales**: nunca se escriben en archivos del repo. Si se usa un `.env` local para probar, ya
está cubierto por `.gitignore`.

### 2. Correr el pipeline de "An. Vinos" (genera/actualiza `data/an-vinos.json`)

```bash
# Bash / Git Bash
export IZI_EMAIL="..."
export IZI_PASSWORD="..."
node pipeline/build-an-vinos.mjs
```

```powershell
# PowerShell
$env:IZI_EMAIL = "..."
$env:IZI_PASSWORD = "..."
node pipeline/build-an-vinos.mjs
```

Qué hace: descarga `Apertura Vinos por Copa` e `Inventarios GS` (+ `Inventarios Bebidas`, mismo
Google Sheet — OJO: es un spreadsheet DISTINTO al que usan Compras Insumos/Matriz/Pesos platos),
reutiliza el mismo Sheet de Compras Insumos para `Compras Totales`, hace login en iZi y trae
`Dim_Producto_iZi`, las ventas (60 días) y `Mov Inv omuh (5)` (últimos 1 mes), calcula las 15
medidas de la carpeta "Anc. Beb y Vin" **agrupadas por `Dim_Producto_iZi[Producto]`** (no por
Insumo) filtradas a `Categoria IN {CERVEZA, VINOS, VINOS IMPORTADOS}`, y escribe
`data/an-vinos.json`. Toda la lógica de descarga/cálculo vive en
`pipeline/lib/anc-beb-vin-pipeline.mjs`, **parametrizada por lista de categorías** — pensada para
que la futura "An. Bebidas" (mismo layout/medidas, solo cambia el filtro de categoría) se
implemente como un wrapper delgado análogo a `build-an-vinos.mjs`, sin repetir lógica.

Si se omiten `IZI_EMAIL`/`IZI_PASSWORD`, el pipeline igual corre con los Google Sheets, pero
`Dim_Producto_iZi` queda vacío y por lo tanto no hay a qué atribuir ninguna medida (JSON con
`productos: []`) — se imprime una advertencia.

### 3. Correr el pipeline de "An. Bebidas" (genera/actualiza `data/an-bebidas.json`)

```bash
# Bash / Git Bash
export IZI_EMAIL="..."
export IZI_PASSWORD="..."
node pipeline/build-an-bebidas.mjs
```

```powershell
# PowerShell
$env:IZI_EMAIL = "..."
$env:IZI_PASSWORD = "..."
node pipeline/build-an-bebidas.mjs
```

Wrapper delgado idéntico a `build-an-vinos.mjs`, solo cambia la lista de categorías del filtro de
página a `Categoria IN {"5. Bebidas alcohólicas", "GASEOSA", "CERVEZA"}` (sección 4.1 de
ANALISIS_PBIX.md). Reutiliza exactamente el mismo `pipeline/lib/anc-beb-vin-pipeline.mjs` y las
mismas 15 medidas de "Anc. Beb y Vin" que "An. Vinos" — no hay lógica nueva que validar, solo el
filtro de categoría (ver sección de validación abajo).

### 4. Correr los pipelines de "Om. Insumos" / "Om. Bebidas" (lado omuH)

```bash
# Bash / Git Bash
export IZI_EMAIL="..."
export IZI_PASSWORD="..."
node pipeline/build-om-insumos.mjs
node pipeline/build-om-bebidas.mjs
```

```powershell
# PowerShell
$env:IZI_EMAIL = "..."
$env:IZI_PASSWORD = "..."
node pipeline/build-om-insumos.mjs
node pipeline/build-om-bebidas.mjs
```

Ambos scripts son wrappers delgados sobre `pipeline/lib/omuh-pipeline.mjs`, que descarga: los 4
Google Sheets nuevos de omuH (`Inventarios Unitarios GS omuh`, `Compras Insumos omuH`,
`Salidas y Mermas omuH`, `Inventarios OMUH` — **spreadsheet propio de omuH, distinto** al de
Beb/Vin y al de Ancestral, confirmado leyendo cada `.tmdl`, no asumido), las 2 hojas del workbook
"Fuente Pedidos ya" (`Ventas Pedidos Ya` y `Ventas Extras iZi`, exportadas individualmente como CSV
por su propio `gid` en vez de parsear el `.xlsx`), `Pesos platos` (reutilizado del spreadsheet de
Ancestral, para `Cantidad2` de `fac_ventas_Ancestral_iZi`), y vía la API de iZi: `Dim_Producto_iZi`,
facturas de omuH (sucursal 81761) y de Ancestral (sucursal 79344, ventas cruzadas), y
`Mov Inv omuh (5)` (reutiliza `izi-api.mjs::fetchMovimientosBeb` sin cambios, ya usado por
"An. Bebidas"/"An. Vinos"). Calcula las 9 medidas de "Omuh Insumos" (agrupadas por `Tabla[Insumo]`
— **sólo 3 valores reales**: "Carne Molida 130g", "Pechuga de Pollo", "Pesca Amazonica`, confirmado
en vivo con `EVALUATE Tabla`) y las 15 de "Omuh Beb" (agrupadas por `Dim_Producto_iZi[Producto]`,
filtrado a categorías de bebidas), compartiendo la lógica de `Vtas Anc Izi Om Ins`/`Cortesias Om Ins`
entre ambas (ver `pipeline/lib/measures-omuh.mjs`).

Si se omiten `IZI_EMAIL`/`IZI_PASSWORD`, ambos pipelines corren pero casi todas las medidas quedan
en 0/vacías (dependen del catálogo `Dim_Producto_iZi`) — se imprime una advertencia.

### 5. Servir el sitio estático

```powershell
powershell -File tools/devserver.ps1 -Port 5500
```

Y abrir `http://localhost:5500`. La página "An. Insumos" (activa por defecto, igual que en el PBIX
original) lee `data/an-insumos.json`, "An. Vinos" lee `data/an-vinos.json`, "An. Bebidas" lee
`data/an-bebidas.json`, "Om. Insumos" lee `data/om-insumos.json` y "Om. Bebidas" lee
`data/om-bebidas.json`, todas vía `fetch` relativo.

## Fuente de datos (confirmada, ver ANALISIS_PBIX.md sección 1)

No hay SQL Server. Tres orígenes reales:
1. **API REST de iZi Soluciones** (`api.beta.izisoluciones.com`) — POS/facturación, login + `/facturas`.
2. **Google Sheets publicados como CSV** ("publicar a la web") — compras, salidas/mermas, recetas
   (matriz de relaciones insumo↔producto) e inventarios físicos contados manualmente.
3. **Tablas calculadas en DAX** (sin fuente externa) — recreadas en JS en `pipeline/lib/`.

En producción, un GitHub Action con cron corre el pipeline y commitea `data/*.json`; GitHub Pages sirve
el sitio estático resultante. Las credenciales de iZi viven solo como GitHub Actions Secrets, nunca en
el repo.

## Validación de "An. Insumos"

Los cálculos de `an-insumos.json` se compararon número por número contra el modelo Power BI real (vía
`dax_query_operations` / `EVALUATE SUMMARIZECOLUMNS(...)`, con el .pbix abierto y conectado) para 14
insumos y 3 semanas históricas completas (202635, 202636, 202637): coincidencia exacta (hasta redondeo
de 2 decimales) en las 8 columnas de la tabla resumen (Inv.-7, Compras, Vtas, Salidas, Vtas Tot., Inv.,
Cierre, Dif.) y en el detalle diario (incluida la medida `Inv. Esp. Anc Ins`).

**Discrepancias conocidas, documentadas (no ocultas):**

- **`Inv. Esp. Anc Ins`** (columna "Inv. Día Esp." del detalle diario) referencia en el DAX original la
  tabla `'Inventarios GS'` (bebidas) en vez de `'Inventarios Unitarios GS'` (insumos) dentro de un
  `USERELATIONSHIP`. Es, con alta probabilidad, un bug de copy-paste del modelo original heredado de la
  medida gemela de bebidas. El efecto neto observado (y replicado fielmente en `measures-an-insumos.mjs`,
  con la explicación completa en el comentario de esa función) es que el término de inventario base usa
  el promedio de TODA la semana en curso — no el de la semana anterior como el nombre sugeriría —, igual
  para los 7 días. Se replicó el comportamiento observado, validado contra el PBIX real.
- **Semana en curso (parcial)**: al comparar la semana actual contra el PBIX abierto, aparecieron
  pequeñas diferencias en Compras/Salidas para algunos insumos (Trucha, Llama, Ojo de bife, Panza,
  Oreja de cerdo, Corazón de pollo). Se verificó con una consulta DAX dirigida a la fila exacta (Compras
  Insumos, Trucha, 16/09) que la causa es **desfase de actualización**, no un error de lógica: el
  Google Sheet ya tenía un valor nuevo en la columna `Porciones` (42) que la sesión de Power BI Desktop
  todavía no había vuelto a cargar (import mode = datos en caché desde el último refresh manual),
  mientras que el pipeline sí lee el Sheet en vivo en cada corrida. Es la ventaja esperada de automatizar
  el refresh — no afecta a semanas ya cerradas/estables, donde la coincidencia fue exacta.

## Validación de "An. Vinos"

Los cálculos de `an-vinos.json` se compararon número por número contra el modelo Power BI real (misma
técnica: `dax_query_operations` / `EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(...))`, filtrado a
`Dim_Producto_iZi[Categoria] IN {CERVEZA, VINOS, VINOS IMPORTADOS}`) para **107 productos** y **3
semanas históricas completas** (202634, 202636, 202637), en las 10 columnas de la tabla resumen
(Inv.-7, Compras, Vtas, Vtas Ext, Cortesias, Salidas, Vtas Tot., Inv., Cierre, Dif.): coincidencia
exacta en 202636 y 202637 (0 discrepancias / 107 productos cada una); en 202634, coincidencia exacta
en 106/107 productos (la única discrepancia real está documentada abajo, no oculta). También se
validó el detalle diario (`Acum Comp Beb`, `Acum Sal Beb`, `Inv. Esp. Beb`, `Inv. Vis. Beb`) contra
consultas DAX dirigidas a un producto/día específico, con coincidencia exacta.

**Bugs reales encontrados y corregidos durante la construcción** (no se reportó "listo" hasta
corregirlos y revalidar):

1. **`Inv. Anc Beb` sin `+0`**: a diferencia de `Ap Copas/Bajas`/`Compras Anc Beb`/`Vtas Anc Beb`/
   `Vtas Ext. Anc Beb` (que sí terminan en `+0` en el DAX original), `Inv. Anc Beb` es un `SUM()` sin
   ese `+0`. En DAX, `SUM()` sobre un conjunto vacío de filas es `BLANK()`, no 0. La primera pasada
   sumaba con valor por defecto 0, produciendo 73 discrepancias (semana 202637) exactamente en las
   columnas Inv./Dif. Corregido en `measures-anc-beb.mjs::invAncBeb` (devuelve `null` cuando no hay
   filas, igual que `AVERAGE`).
2. **`Dif Anc Beb` y la coerción `BLANK() = 0` de DAX**: `Dif Anc Beb` usa
   `IF([Inv. Anc Beb]=BLANK(), BLANK(), [Inv. Anc Beb]-[Cierre Anc Beb])`. En DAX, comparar un número
   con `BLANK()` con `=` trata `BLANK()` como equivalente a 0 — es decir, esta condición también da
   `TRUE` (y por lo tanto `Dif` sale en blanco) cuando `Inv. Anc Beb` es un **0 real**, no solo cuando
   no hay filas. Confirmado contra el modelo real (p.ej. "AMOR FATI - TELLUS", semana 202637: Inv=0,
   Cierre=0, pero Dif=BLANK, no 0). Corregido en `difAncBeb` (devuelve `null` también cuando
   `inv === 0`); esto arregló las 11 discrepancias restantes de esa misma corrida.

**Discrepancia conocida, documentada (no oculta):**

- **`Vtas Ext. Anc Beb` de "HUARI", semana 202634**: JSON=3 vs DAX=0 (y por arrastre, Vtas Tot./Cierre
  de esa única fila). Investigado a fondo: `fac_ventas_Ancestral_Productos_Extra` se arma uniendo
  `fac_ventas_Ancestral_iZi` con `Matriz_de_Relaciones Ancestral` filtrado a `Cod Insumo="ANC00007"`.
  **Corrección importante al resumen que traía este dato**: ese código NO es de Chuletón en esta
  tabla — la única fila con `Cod Insumo="ANC00007"` real es `{Insumo="HUARI", Cod Producto="ANC00010"
  (MICHELADA ANCESTRAL)}` (confirmado con una consulta DAX dirigida); es decir, las ventas de
  "MICHELADA ANCESTRAL" sí deben atribuirse a "HUARI" (categoría CERVEZA, dentro del filtro de
  página), y eso es justamente lo que hace el pipeline. La discrepancia puntual es que, en el modelo
  actualmente abierto en Power BI Desktop, `fac_ventas_Ancestral_Productos_Extra[Cantidad]` sale en
  blanco para **absolutamente todas** las filas históricas de esa tabla (se verificó con
  `EVALUATE fac_ventas_Ancestral_Productos_Extra` sin filtros), porque el import cacheado tiene
  `'Matriz_de_Relaciones Ancestral'[Cantidad usada (kg o u)]` vacío para esa fila — mientras que el
  Google Sheet en vivo ya tiene ese campo lleno (`1.00`), que es lo que lee el pipeline. Mismo tipo de
  **desfase de actualización** ya documentado arriba para "An. Insumos" (Compras Insumos/Trucha), solo
  que aquí afecta a una tabla de RECETA estática en vez de a un valor diario, por lo que "contamina"
  retroactivamente todas las semanas históricas del lado cacheado — no es un error de lógica del
  pipeline, que de hecho refleja el dato más actualizado.

## Validación de "An. Bebidas"

Los cálculos de `an-bebidas.json` se compararon número por número contra el modelo Power BI real
(misma técnica: `dax_query_operations` / `EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(...))`, filtrado
a `Dim_Producto_iZi[Categoria] IN {"5. Bebidas alcohólicas", "GASEOSA", "CERVEZA"}`) para **29
productos** y **3 semanas** (202634, 202636, 202637), en las 10 columnas de la tabla resumen (Inv.-7,
Compras, Vtas, Vtas Ext, Cortesias, Salidas, Vtas Tot., Inv., Cierre, Dif.): coincidencia exacta en
las tres semanas para los 16 productos con movimiento real en cada una, salvo una única diferencia
puntual ya conocida (ver abajo). Como se esperaba, esto confirma que el pipeline compartido con
"An. Vinos" (`anc-beb-vin-pipeline.mjs` + `measures-anc-beb.mjs`, sin ningún cambio de lógica —
solo la lista de categorías) sigue siendo correcto al reapuntarlo a un filtro de página distinto.

**Discrepancias conocidas, documentadas (no ocultas), heredadas de la validación de "An. Vinos":**

- **`Vtas Ext. Anc Beb` de "HUARI", semana 202634**: JSON=3 vs DAX=0 (y por arrastre, Vtas Tot./Cierre
  de esa fila) — exactamente la misma causa raíz ya documentada arriba en "Validación de An. Vinos"
  (el modelo cacheado en Power BI Desktop tiene `'Matriz_de_Relaciones Ancestral'[Cantidad usada (kg
  o u)]` vacío para la fila HUARI/MICHELADA ANCESTRAL, mientras el Google Sheet en vivo ya tiene
  `1.00`), no un error del pipeline ni algo nuevo introducido al cambiar el filtro de categoría.
- **"Chop Bendita"**: aparece en `data/an-bebidas.json` (con todas sus medidas en 0/blank) pero NO
  existe como fila de `Dim_Producto_iZi` en el modelo cacheado del PBIX (confirmado con
  `EVALUATE FILTER('Dim_Producto_iZi', SEARCH("chop", [Producto],1,0)>0)`, que solo devuelve "Chop
  Cerveza" y "Chop Cerveza 2X1"). Es un producto nuevo en el catálogo en vivo de la API iZi que el
  import cacheado del PBIX todavía no conoce — mismo tipo de desfase de caché ya documentado arriba,
  sin efecto numérico real porque todas sus medidas son 0 en ambos lados.

**Decisión de diseño — filtro del slicer de Producto** (ver comentario homónimo al inicio de
`js/pages/an-bebidas.js`): en el PBIX original, el slicer "Producto" de esta página (igual que en
"An. Vinos") tiene su propio filtro, más amplio que el filtro de página:
`Categoria IN {AGUAS, CERVEZA, GASEOSA, VINOS, VINOS IMPORTADOS, "5. Bebidas alcohólicas"}`. La
implementación actual (heredada tal cual de "An. Vinos", que ya está enviado y validado) llena el
dropdown de Producto con `data.productos`, acotado por el filtro de PÁGINA del pipeline, no por ese
filtro más amplio del slicer. Se decidió mantener ese mismo comportamiento por consistencia y porque
no tiene efecto visible: un producto de categoría AGUAS no tiene ninguna fila de Vtas/Compras/
Inventario bajo el filtro de página de Bebidas, así que agregarlo al slicer solo añadiría una opción
sin datos, nunca cambiaría un número mostrado. Si se requiere fidelidad 1:1 del slicer más adelante,
haría falta un segundo parámetro de categorías (independiente de las de página) en
`anc-beb-vin-pipeline.mjs`.

## Validación de "Om. Insumos"

Los cálculos de `om-insumos.json` se compararon número por número contra el modelo Power BI real
(`dax_query_operations` / `EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS('Tabla'[Insumo], 'Calendar'
[WeekYear], ...))`) para los **3 insumos reales** de `Tabla[Insumo]` ("Carne Molida 130g",
"Pechuga de Pollo", "Pesca Amazonica" — confirmado en vivo que `Tabla` sólo tiene 3 filas, no la
lista larga de insumos que sugería el resumen inicial) y **3 semanas** (202636, 202637 cerradas,
202638 en curso): **coincidencia exacta en las 13 columnas de la carpeta "Omuh Insumos"** (Inv.-7,
Compras, Vtas Izi, Vtas Anc Izi, Vtas PY, Vtas Ext., Vtas Vegg, Cortesías, Salidas, Vtas Tot., Inv.,
Cierre, Dif.) para las 2 semanas cerradas, en los 3 insumos.

La semana en curso (202638, parcial) también coincide exacto contra DAX en las 3 filas, incluido un
caso interesante: `Salidas Om Ins` de "Carne Molida 130g" = **-3** (una corrección real: la fila de
`Salidas y Mermas omuH` fechada 17-sep-2026 dice "Se mandaron 6 cortesías pero sólo salieron 3",
`Porciones = -3` en el Google Sheet) — el pipeline y el DAX en vivo coinciden exactamente en ese
valor negativo, confirmado con una consulta DAX dirigida a esa celda.

## Validación de "Om. Bebidas"

Los cálculos de `om-bebidas.json` se compararon número por número contra el modelo Power BI real
(misma técnica, agrupado por `Dim_Producto_iZi[Producto]` filtrado a
`Categoria IN {"5. Bebidas alcohólicas","CERVEZA","GASEOSA","4. Bebidas no alcohólicas"}`) para
**27 productos con movimiento real** en la semana 202637, en las 11 columnas de la tabla resumen:
**24/27 productos coinciden exactamente**.

**Bugs reales encontrados y corregidos durante la construcción** (no se reportó "listo" hasta
corregirlos y revalidar):

1. **Falta de filtro de semana en `[Vtas Anc Izi Om Ins]` evaluado en contexto de Producto**: la
   primera versión de `buildOmBebidasData` sumaba TODAS las ventas cruzadas de Ancestral de los
   últimos 60 días (57 filas) en vez de sólo la semana consultada (10 filas) — p.ej. "HUARI" salía
   113 en vez de 26. Corregido agregando el filtro `weekYear(r.fecha) === w.weekYear` que ya tenían
   el resto de medidas (`pipeline/lib/omuh-pipeline.mjs`).
2. **Reemplazo "Huari Tradicional"→"Cerveza Huari" faltante**: el M original de
   `'Extras - iZi omuH'` aplica `Table.ReplaceValue(...,"Huari Tradicional","Cerveza Huari",...)`
   sobre la columna `Value` ANTES de unirla a `Dim_Producto_iZi`; se había omitido, causando
   `Vtas Ext Om Beb` de "Cerveza Huari" = 0 en vez de 105. Corregido.
3. **Join case-sensible entre `Extras[Value]` y `Dim_Producto_iZi[Producto]`**: DAX compara texto
   sin distinguir mayúsculas por defecto; el join inicial era exacto (case-sensitive), así que
   `Value="Fanta"` no matcheaba `Producto="FANTA"`. Corregido con normalización case/acento-
   insensible (misma función `norm()` usada en todo `measures-omuh.mjs`).

**Discrepancia conocida, documentada (no oculta), NO corregida (deriva real de catálogo, no bug)**:
para 3 de los 27 productos (**"FANTA"/"COCA COLA"/"SPRITE"**, en mayúsculas), el catálogo
`Dim_Producto_iZi` **en vivo** tiene un único código (el de Ancestral, p.ej. `ANC00106` para
"FANTA"), mientras que el modelo Power BI actualmente abierto (cacheado, no refrescado
recientemente) todavía tiene DOS códigos para el mismo nombre visible: el de Ancestral (en
mayúsculas) y uno de omuH ahora inactivo/eliminado del catálogo vivo (`OMU00024`, con
`Producto="Fanta"` en minúscula inicial). El pipeline, que lee el catálogo EN VIVO, correctamente
separa "FANTA" (código Ancestral) de "Fanta" (código omuH, todavía referenciado por compras/ventas
históricas) como dos filas distintas; el modelo cacheado del PBIX todavía los consolida bajo una
sola fila. **Verificado que la suma de ambas filas coincide exactamente** con el valor validado
contra DAX (p.ej. Compras "FANTA"=0 + "Fanta"=36 = 36, igual al DAX cacheado) — es decir, los
NÚMEROS totales son correctos, sólo cambia bajo qué nombre de fila se muestran, por la misma razón
de desfase de actualización de catálogo ya documentada extensamente arriba para otros módulos
(no se oculta, se explica en el propio comentario de cabecera de `js/pages/om-bebidas.js`).

## Arquitectura compartida Om. Insumos / Om. Bebidas

`Ventas Tot Om Beb` usa literalmente `[Vtas Anc Izi Om Ins]`, y `Cierre Om Beb` usa literalmente
`[Cortesias Om Ins]` — ambas son medidas de la carpeta "Omuh Insumos" reutilizadas tal cual dentro
de "Omuh Beb", evaluadas en un contexto de fila distinto (Producto en vez de Insumo). En DAX esto
"simplemente funciona" por el motor de contexto de filtro; en JS puro se replica con
`pipeline/lib/measures-omuh.mjs::vtasAncIziOmuh(rows)` y `cortesiasOmuh(rows)` — funciones puras
que sólo conocen el SWITCH de factores / el filtro `tipoMovimiento="interna"`, y el CALLER
(`omuh-pipeline.mjs`) les pasa las filas ya filtradas por insumo (para las medidas de "Omuh
Insumos") o por producto (para los términos reutilizados dentro de "Omuh Beb"). Así la fórmula de
negocio vive en un solo lugar y ambos módulos quedan consistentes por construcción.

## Próximos pasos

Los 5 módulos reales del PBIX (An. Insumos, An. Vinos, An. Bebidas, Om. Insumos, Om. Bebidas) están
completos, cableados y validados. No quedan módulos pendientes de este dashboard.

(El repo ya está creado en GitHub con el GitHub Action de refresh y GitHub Pages activo — ver
sección "Fuente de datos" abajo.)
