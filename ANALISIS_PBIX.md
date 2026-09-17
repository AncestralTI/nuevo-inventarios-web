# Análisis exhaustivo — "Nuevo Inventarios.pbix"

Documento generado a partir de la exportación en disco del .pbix (TMDL del modelo tabular + definición PBIR del reporte). Todo lo aquí escrito proviene literalmente de esos archivos; donde algo no está claro se indica explícitamente.

Fuentes usadas:
- `C:\Users\diago\AppData\Local\Temp\claude\pbix_analysis\tmdl\` (modelo, relaciones, expresiones, tablas)
- `C:\Users\diago\AppData\Local\Temp\claude\pbix_analysis\extracted\Report\definition\` (páginas, visuales, bookmarks)

---

## 1. Fuente de datos

El modelo combina **tres orígenes de datos reales**, todos accedidos vía Power Query (M) con `Web.Contents`:

### 1.1 API REST de iZi Soluciones (`https://api.beta.izisoluciones.com`)
API de punto de venta/facturación. Se usa un login (`POST /login` con `correoElectronico`/`contrasena` — las credenciales están escritas en texto plano dentro del M embebido en el .pbix; no se reproducen aquí por seguridad) que devuelve un `token` Bearer, reutilizado en cada llamada posterior.

Endpoints usados:
- `GET /facturas?desde=...&hasta=...&contribuyente=79818&sucursal=79344` → alimenta `fuente_iZi_Ancestral` (sucursal 79344 = Ancestral) → tabla `fac_ventas_Ancestral_iZi`.
- `GET /facturas?...&sucursal=81761` → alimenta `fuente_iZi_omuH` (sucursal 81761 = omuH) → tabla `fac_ventas_omuH_iZi`.
- `GET /items-inventarios?izi-contribuyente=79818` → catálogo de productos → tabla `Dim_Producto_iZi`.
- `GET /movimientos?desde=...&hasta=...` (últimos 2 meses, filtrado a `tipoMovimiento="interna"` o `"interna"/"prod-venta"`) → tablas `Mov Inv omuh` y `Mov Inv omuh (5)` (esta última filtra además `codigoInventario` que contenga "58").
- `GET /comandas?desde=...&hasta=...&contribuyente=79818&sucursal=81761` (+ `GET /items-inventarios`) → tabla `Extras - iZi omuH vAPI` (versión API, reemplaza a la hoja manual "Ventas Extras iZi"; comentario en el M advierte que la contraseña queda en claro dentro del .pbix).
- Parámetros `RangeStart` (2025-01-01) y `RangeEnd` (2027-12-31) controlan un "Incremental Refresh" manual sobre `fecha >= RangeStart and fecha < RangeEnd`.

### 1.2 Google Sheets publicados como CSV/XLSX (`docs.google.com/spreadsheets/.../pub?output=csv|xlsx`)
Varias hojas de cálculo de Google Sheets publicadas públicamente, leídas con `Csv.Document(Web.Contents(url))` o `Excel.Workbook(Web.Contents(url))`. Se identifican al menos 3 documentos distintos (por el ID de spreadsheet):
- Uno para **Ancestral** (inventarios de bebidas, compras de insumos, matriz de recetas, salidas y mermas): alimenta `Inventarios GS`, `Apertura Vinos por Copa`, `Relacion Copa de Vino y Vinos`, `Compras Insumos`, `Matriz_de_Relaciones Ancestral`, `Pesos platos`, `Inventarios Insumos GS`, `Inventarios Unitarios GS`, `Salidas y Mermas Ancestral`, `Compras Precios` (derivada).
- Uno para **omuH** (mismo patrón): `Matriz_de_Relaciones omuh`, `Compras Insumos omuH`, `Inventarios Unitarios GS omuh`, `Salidas y Mermas omuH`, `Inventarios OMUH`.
- Uno tipo **Excel workbook multi-hoja** ("Fuente Pedidos ya"), con hojas internas `Ventas Pedidos Ya` y `Ventas Extras iZi`, usado para el canal PedidosYa y para "Extras" (modificadores tipo Carne Extra / Vegetariano): alimenta `Pedidos Ya - items` → `fac_ventas_omuH_PedidosYa`, y `Extras - iZi omuH` / `Extras - iZi omuH_old` / `Vegetarianas`.

### 1.3 Tablas calculadas dentro del propio modelo (DAX, sin fuente externa)
`Peso Porcion` (FILTER/SELECTCOLUMNS sobre `Compras Insumos`, últimos 60 días), `PromedioSinOutliers` (ADDCOLUMNS con media ± 2 desvíos estándar sobre `Peso Porcion`), `Calendar` (función `CALENDAR()`), `Min Max`, `Tabla`, `Filtro Dif` (DATATABLE) y los parámetros "what-if" `Parámetro An. Beb/Ins`, `Parámetro Om. Beb/Ins`.

**No se encontró** ninguna fuente SQL Server (`Sql.Database`) en `expressions.tmdl` ni en las particiones de las tablas revisadas: toda la persistencia proviene de la API de iZi y de Google Sheets/Excel publicados.

### 1.4 Lógica esencial de Power Query por tabla principal

| Tabla | Lógica M esencial |
|---|---|
| `fac_ventas_Ancestral_iZi` | Toma `fuente_iZi_Ancestral`, filtra por rango incremental, ajusta zona horaria Bolivia (UTC-4), expande `listaItems` (detalle de factura), descarta el código `AN000046`. |
| `fac_ventas_omuH_iZi` | Igual patrón que la anterior pero sobre `fuente_iZi_omuH`, descarta facturas `anulada=1`, agrega `Monto Total = precioTotal - descuentos`. |
| `Dim_Producto_iZi` | Login + `items-inventarios`, filtra códigos que empiezan con "i"/"I" y 4 códigos de prueba, hace merge con `Compras Precios` para traer "Precio Compra", agrega columna `Producto_` (Proper Case). |
| `fac_ventas_omuH_PedidosYa` | Parte de `Pedidos Ya - items` (que ya separa combos "[...]" en líneas Principal/Combo), normaliza nombres de producto (minúsculas, sin tildes, tabla de alias manual), clasifica Categoria en "1. Burgers"/"2. Sandos"/"3. Otros", cruza contra `Dim_Producto_iZi` normalizado y descarta productos con código "ANC". |
| `Inventarios GS` / `Inventarios Insumos GS` / `Inventarios Unitarios GS` / `Inventarios Unitarios GS omuh` / `Inventarios OMUH` | Todas siguen el mismo patrón: CSV ancho (una columna por fecha) → `Unpivot` para volverlo largo (`Fecha`/`Cantidad`), limpieza de errores y filas vacías, algunas hacen merge con la Matriz de Relaciones para traer el código de producto/peso unitario usado. |
| `Compras Insumos` / `Compras Insumos omuH` | CSV de compras, castea tipos, arma columna `Fecha` = `Fecha Porcion` si existe si no `Fecha1`, calcula `Categoria Alcohol` por texto contenido en el nombre del producto (Ron, Tequila, Vodka, etc.), reemplaza "Tapa de pecho" por "Keperi". |
| `Compras Totales` | `Table.Combine({Compras Insumos})` + merge con `Pesos platos` para traer `Cantidad.1` (porciones). |
| `Compras Precios` | Sobre `Compras Insumos`, filtra últimos 120 días, agrupa por `Cod Producto` y calcula precio promedio (`Precio Total`/`Cantidad`). |
| `Matriz_de_Relaciones Ancestral` / `omuh` | Recetas: insumo → producto de venta, con `Cantidad usada`, `Merma %` y `Porciones`; calcula `Cantidad = Cantidad usada / (1 - Merma%)`. |
| `Pesos platos` | Igual receta que `Matriz_de_Relaciones Ancestral` pero solo deja `Cod Producto` y `Cantidad` (peso de merma por plato). |
| `Salidas y Mermas Ancestral` / `omuH` | CSV de mermas/salidas manuales por producto/fecha, con columna calculada `Porciones calculadas` (usa `Peso`/`Peso Porcion` si no hay `Porciones` directa). |
| `Extras - iZi omuH` / `_old` / `vAPI` | Registran ventas de "extras" (carne extra, pollo extra) y ajustes vegetarianos (resta carne cuando el pedido es "veggie"); la versión `vAPI` reconstruye lo mismo consultando `/comandas` de la API en vez de la hoja manual. |
| `Mov Inv omuh` / `Mov Inv omuh (5)` | Movimientos de inventario "internos" de la API iZi (cortesías/mermas registradas en el POS), últimos 2 meses; la variante (5) filtra a `codigoInventario` que contiene "58" (bebidas). |
| `Peso Porcion` (calculada) | `FILTER(SELECTCOLUMNS('Compras Insumos', ...), Fecha >= HOY-60 && Peso Real y Porciones no vacíos)`. |
| `PromedioSinOutliers` (calculada) | Por producto, promedio de `Peso x Porcion` descartando outliers fuera de ±2 desvíos estándar. |

---

## 2. Modelo de datos

### 2.1 Tablas agrupadas por función

**Hechos — Ventas**
- `fac_ventas_Ancestral_iZi` — ventas POS iZi, Ancestral
- `fac_ventas_Ancestral_iZi_Copas` — ventas de copas de vino derivadas de botellas (Ancestral)
- `fac_ventas_Ancestral_Productos_Extra` — extra de "Chuletón" (insumo `ANC00007`) derivado de recetas
- `fac_ventas_omuH_iZi` — ventas POS iZi, omuH
- `fac_ventas_omuH_PedidosYa` — ventas canal PedidosYa, omuH

**Hechos — Compras**
- `Compras Insumos`, `Compras Insumos omuH`, `Compras Totales`, `Compras Precios` (derivada, precio promedio 120 días)

**Hechos — Inventarios (conteos físicos)**
- `Inventarios GS`, `Inventarios Insumos GS`, `Inventarios Unitarios GS`, `Inventarios Unitarios GS omuh`, `Inventarios OMUH`

**Hechos — Salidas / Mermas / Movimientos**
- `Salidas y Mermas Ancestral`, `Salidas y Mermas omuH`, `Mov Inv omuh`, `Mov Inv omuh (5)`, `Extras - iZi omuH`, `Extras - iZi omuH_old`, `Extras - iZi omuH vAPI`

**Dimensiones**
- `Dim_Producto_iZi` — catálogo de productos (con columnas calculadas `Categoria 2`, `Categoria Carnes`, `Categoria Bebidas`, `Insumo`)
- `Matriz_de_Relaciones Ancestral`, `Matriz_de_Relaciones omuh` — recetas (insumo ↔ producto vendido)
- `Pesos platos` — peso de merma por plato
- `Apertura Vinos por Copa` — botellas abiertas para servir por copa
- `Tabla` — mapa Categoría ↔ Insumo (agrupación de insumos cárnicos usada en Om. Insumos)
- `Min Max` — stock mínimo/máximo por insumo
- `Peso Porcion` / `PromedioSinOutliers` — cálculo de peso promedio por porción, sin outliers

**Calendario**
- `Calendar` (tabla explícita, generada con `CALENDAR()`) + numerosas `LocalDateTable_*` / `DateTableTemplate_*` autogeneradas por Power BI para jerarquías de fecha (una por cada columna de tipo fecha sin relación explícita a `Calendar`) — no requieren documentación de negocio.

**Tablas de medidas (measure tables, sin filas de datos reales)**
- `01 Ancestral` (28 medidas), `03omuh` (29 medidas), `00Calculos` (1 medida)

**Parámetros / tablas de selección para segmentadores**
- `Parámetro An. Beb`, `Parámetro An. Ins`, `Parámetro Om. Ins`, `Parámetro Om. Beb` (field parameters), `Filtro Dif` (tabla de 3 opciones fija)

### 2.2 Relaciones (de `relationships.tmdl`)

Cardinalidad no anotada explícitamente = `many:one` (many del lado "from") por defecto de Power BI; se indica cuando el TMDL declara `fromCardinality`/`toCardinality` distinto, y si la relación está inactiva o es bidireccional.

| Origen | Destino | Cardinalidad | Filtro | Activa |
|---|---|---|---|---|
| Calendar.FiltroFechaWeeks | LocalDateTable_a3aa3d63....Date | *:1 | única dirección | Sí |
| Inventarios GS.Cod Producto | Dim_Producto_iZi.Cod. Producto | *:1 | única | Sí |
| fac_ventas_Ancestral_iZi.codigoInventario | Dim_Producto_iZi.Cod. Producto | *:1 | única | Sí |
| Compras Totales.Cod Producto | Dim_Producto_iZi.Cod. Producto | *:1 | única | Sí |
| fac_ventas_Ancestral_iZi_Copas.Cod Botella | Dim_Producto_iZi.Cod. Producto | *:1 | única | Sí |
| Apertura Vinos por Copa.Codigo Producto | Dim_Producto_iZi.Cod. Producto | *:1 | única | Sí |
| fac_ventas_Ancestral_Productos_Extra.Matriz_de_Relaciones.Cod Insumo | Dim_Producto_iZi.Cod. Producto | *:1 | única | Sí |
| Inventarios Insumos GS.Producto | Matriz_de_Relaciones Ancestral.Insumo | *:muchos (toCardinality: many) | única | Sí |
| Compras Precios.Cod Producto | Dim_Producto_iZi.Cod. Producto | 1:* (fromCardinality: one) | **ambas direcciones** | Sí |
| Salidas y Mermas Ancestral.Producto | Matriz_de_Relaciones Ancestral.Insumo | *:muchos | única | Sí |
| fac_ventas_Ancestral_iZi.codigoInventario | Pesos platos.Cod Producto | *:1 | única | Sí |
| Inventarios Unitarios GS.Cod Producto | Dim_Producto_iZi.Cod. Producto | *:1 | única | Sí |
| Inventarios Unitarios GS.Cod Producto | Pesos platos.Cod Producto | *:1 | única | Sí |
| Inventarios Unitarios GS.Producto | Matriz_de_Relaciones Ancestral.Insumo | *:muchos | única | Sí |
| Compras Insumos.Fecha Porcion | LocalDateTable_79f02935....Date | *:1 | única | Sí |
| Compras Totales.Fecha1 | LocalDateTable_8cf86b40....Date | *:1 | única | Sí |
| Compras Totales.Fecha Porcion | LocalDateTable_abefe567....Date | *:1 | única | Sí |
| Inventarios GS.Fecha | Calendar.Date | *:1 | única | Sí |
| Apertura Vinos por Copa.Fecha | Calendar.Date | *:1 | única | Sí |
| Compras Totales.Fecha | Calendar.Date | *:1 | única | Sí |
| fac_ventas_Ancestral_iZi.Fecha | Calendar.Date | *:1 | única | Sí |
| fac_ventas_Ancestral_iZi_Copas.Fecha | Calendar.Date | *:1 | única | Sí |
| fac_ventas_Ancestral_Productos_Extra.Fecha | Calendar.Date | *:1 | única | Sí |
| Compras Insumos.Fecha1 | Calendar.Date | *:1 | única | Sí |
| Inventarios Insumos GS.Fecha | Calendar.Date | *:1 | única | Sí |
| Salidas y Mermas Ancestral.Fecha | Calendar.Date | *:1 | única | Sí |
| Inventarios Unitarios GS.Fecha | Calendar.Date | *:1 | única | Sí |
| Inventarios Unitarios GS.Fecha-7 | Calendar.Date | *:1 | única | **No** (usada vía USERELATIONSHIP en medidas "Inv. -7") |
| Inventarios Unitarios GS.Fecha-14 | Calendar.Date | *:1 | única | **No** |
| Compras Insumos.Fecha | LocalDateTable_2890695f....Date | *:1 | única | Sí |
| fac_ventas_omuH_iZi.codigoInventario | Dim_Producto_iZi.Cod. Producto | *:1 | única | Sí |
| fac_ventas_omuH_iZi.Fecha | Calendar.Date | *:1 | única | Sí |
| fac_ventas_omuH_PedidosYa.Fecha | Calendar.Date | *:1 | única | Sí |
| Inventarios Unitarios GS omuh.Categoria | Matriz_de_Relaciones omuh.Categoria | *:1 | única | **No** |
| Inventarios Unitarios GS omuh.Fecha | Calendar.Date | *:1 | única | Sí |
| Inventarios Unitarios GS omuh.Fecha-7 | Calendar.Date | *:1 | única | **No** |
| Extras - iZi omuH.Producto | Matriz_de_Relaciones omuh.Insumo | *:1 | única | **No** |
| Extras - iZi omuH.Fecha | Calendar.Date | *:1 | única | Sí |
| Compras Insumos.Producto | Matriz_de_Relaciones Ancestral.Insumo | *:muchos | única | Sí |
| Peso Porcion.Fecha | LocalDateTable_d62eaf35....Date | *:1 | única | Sí |
| Peso Porcion.Producto | Matriz_de_Relaciones Ancestral.Insumo | *:muchos | única | Sí |
| Compras Insumos omuH.Fecha Porcion | LocalDateTable_b709110b....Date | *:1 | única | Sí |
| Compras Insumos omuH.Fecha | LocalDateTable_8d217b9d....Date | *:1 | única | Sí |
| Compras Insumos omuH.Fecha1 | Calendar.Date | *:1 | única | Sí |
| Calendar.Date | LocalDateTable_8ab49f24....Date | *:1 | única | Sí |
| Salidas y Mermas omuH.Fecha | Calendar.Date | *:muchos (toCardinality: many) | única | Sí |
| Mov Inv omuh.codigoInventario | Dim_Producto_iZi.Cod. Producto | *:1 | única | Sí |
| Mov Inv omuh.fecha | Calendar.Date | *:1 | única | Sí |
| Compras Insumos.Producto | PromedioSinOutliers.Producto | *:1 | única | Sí |
| Salidas y Mermas Ancestral.Producto | PromedioSinOutliers.Producto | *:1 | única | Sí |
| Matriz_de_Relaciones Ancestral.Insumo | Min Max.Insumo | *:1 | **ambas direcciones** | Sí |
| Min Max.Insumo | PromedioSinOutliers.Producto | *:1 | única | Sí |
| Matriz_de_Relaciones Ancestral.Cod Producto | Dim_Producto_iZi.Cod. Producto | 1:* (fromCardinality: one) | **ambas direcciones** | Sí |
| Inventarios GS.Fecha-7 | Calendar.Date | *:1 | única | **No** |
| Inventarios Insumos GS.Fecha-7 | Calendar.Date | *:1 | única | **No** |
| Inventarios OMUH.Fecha | Calendar.Date | *:1 | única | Sí |
| Inventarios OMUH.Fecha-7 | Calendar.Date | *:1 | única | **No** |
| Compras Insumos omuH.Cod Producto | Dim_Producto_iZi.Cod. Producto | *:1 | única | **No** |
| Dim_Producto_iZi.Cod. Producto | fac_ventas_omuH_PedidosYa.Cod. Producto | *:muchos | **ambas direcciones** | **No** |
| Mov Inv omuh (5).codigoInventario | Dim_Producto_iZi.Cod. Producto | *:1 | única | Sí |
| Mov Inv omuh (5).fecha - Copia | LocalDateTable_97861389....Date | *:1 | única | Sí |
| Mov Inv omuh (5).fecha | Calendar.Date | *:1 | única | Sí |
| Matriz_de_Relaciones omuh.Cod Producto | fac_ventas_omuH_PedidosYa.Cod. Producto | *:muchos | **ambas direcciones** | **No** |
| Dim_Producto_iZi.Categoria 2 | Matriz_de_Relaciones omuh.Categoria | *:1 | única | **No** |
| Dim_Producto_iZi.Categoria Carnes | Tabla.Insumo | *:1 | única | Sí |
| Tabla.Categoria | Matriz_de_Relaciones omuh.Categoria | *:1 | única | Sí |
| Inventarios Unitarios GS omuh.Categoria 3 | Tabla.Insumo | *:1 | única | Sí |
| Extras - iZi omuH.Categoria 3 | Tabla.Insumo | *:1 | **ambas direcciones** | Sí |
| Compras Insumos omuH.Producto 2 | Dim_Producto_iZi.Insumo | *:muchos | única | Sí |
| Inventarios OMUH.Producto | Dim_Producto_iZi.Categoria Bebidas | *:muchos | única | Sí |
| Salidas y Mermas omuH.Producto | Matriz_de_Relaciones omuh.Insumo | *:1 | única | **No** |
| Salidas y Mermas omuH.Categoria 3 | Tabla.Insumo | *:1 | única | Sí |
| fac_ventas_omuH_PedidosYa.Categoria 3 | Dim_Producto_iZi.Categoria Carnes | *:muchos | única | Sí |
| Extras - iZi omuH_old.Fecha | LocalDateTable_c2cdba67....Date | *:1 | única | Sí |
| Extras - iZi omuH.Value | Dim_Producto_iZi.Producto | *:muchos | **ambas direcciones** | **No** |
| Extras - iZi omuH vAPI.Fecha | LocalDateTable_72e6cd3c....Date | *:1 | única | Sí |
| fac_ventas_omuH_iZi.Fecha Bolivia | LocalDateTable_e0e610b1....Date | *:1 | única | Sí |
| Dim_Producto_iZi.Producto | Salidas y Mermas omuH.Categoria 3 | *:muchos | **ambas direcciones** | **No** |

Nota: varias relaciones inactivas existen específicamente para ser activadas con `USERELATIONSHIP()` dentro de las medidas "Inv. -7" (comparación contra el inventario de 7 días atrás).

---

## 3. Medidas DAX

Total: **58 medidas** en 3 tablas de medidas. Se listan exactas, agrupadas por `displayFolder`.

### 3.1 Tabla `01 Ancestral` (28 medidas)

#### Carpeta: `Anc. Insumos`

**Inv. Anc Ins** — formatString `0`
```
AVERAGE('Inventarios Unitarios GS'[Cantidad])
```

**Inv. -7 Anc Ins** — formatString `0`
```
CALCULATE(
    AVERAGE('Inventarios Unitarios GS'[Cantidad]),
    REMOVEFILTERS(
        'Calendar'[Date],
        'Calendar'[WeekDay],
        'Calendar'[WeekDay Name]
    ),
    USERELATIONSHIP(
        'Inventarios Unitarios GS'[Fecha-7],
        'Calendar'[Date]
    )
)
```

**Compras Anc Ins** — formatString `0`
```
CALCULATE(SUM('Compras Insumos'[Porciones calculadas]),'Compras Insumos'[Empresa]="Ancestral")
```

**Cierre Anc Ins** — formatString `0`
```
MAX(0,--[Inv. -7]+[Compras Porciones Ancestral]-[Ventas Unidades]-[Salidas Uni]
CALCULATE([Inv. -7 Anc Ins]+[Compras Anc Ins]-[Vtas Anc Ins]-[Salidas Anc Ins], 
REMOVEFILTERS(
        'Calendar'[Date],
        'Calendar'[WeekDay],
        'Calendar'[WeekDay Name]
    )
))
```

**Dif Anc Ins** — formatString `0`
```
IF([Inv. Anc Ins]=BLANK(),BLANK(), [Inv. Anc Ins]-[Cierre Anc Ins])
```

**Salidas Anc Ins** — formatString `0`
```
SUM('Salidas y Mermas Ancestral'[Porciones calculadas])
```

**Vtas Anc Ins** — formatString `0`
```
SUMX(
    SUMMARIZE(
        'Matriz_de_Relaciones Ancestral',
        'Matriz_de_Relaciones Ancestral'[Producto (izi)],
        "Cantidad", CALCULATE(SUM(fac_ventas_Ancestral_iZi[Cantidad Chuleton])),
        "Porciones", MAX('Matriz_de_Relaciones Ancestral'[Porciones])
    ),
    [Cantidad]*[Porciones]
)
```

**Most Anc Ins** — formatString `0`
```
VAR _Filtro =
    SELECTEDVALUE('Filtro Dif'[ID], 1)

VAR _DifPadre =
    CALCULATE(
        [Dif Anc Ins],
        REMOVEFILTERS('Matriz_de_Relaciones Ancestral'[Producto (izi)])
    )

RETURN
SWITCH(
    _Filtro,
    1, 1,
    2, IF(_DifPadre = 0, 1, 0),
    3, IF(_DifPadre <> 0, 1, 0),
    1
)
```

**Acum Comp Anc Ins** — sin formatString explícito (PBI_FormatHint general)
```
VAR FechaActual =
    MAX('Calendar'[Date])

VAR WeekActual =
    SELECTEDVALUE('Calendar'[WeekYear])

RETURN
CALCULATE(
    [Compras Anc Ins],

    FILTER(
        ALL('Calendar'),
        'Calendar'[Date] <= FechaActual
        &&
        'Calendar'[WeekYear] = WeekActual
    )
)
```

**Acum Sal Anc Ins** — sin formatString explícito
```
VAR FechaActual =
    MAX('Calendar'[Date])

VAR WeekActual =
    SELECTEDVALUE('Calendar'[WeekYear])

RETURN
CALCULATE(
    [Vtas Tot Anc Ins],

    FILTER(
        ALL('Calendar'),
        'Calendar'[Date] <= FechaActual
        &&
        'Calendar'[WeekYear] = WeekActual
    )
)
```

**Inv. Esp. Anc Ins** — formatString `0`
```
MAX(
CALCULATE(
    AVERAGE('Inventarios Unitarios GS'[Cantidad]),
    REMOVEFILTERS(
        'Calendar'[Date],
        'Calendar'[WeekDay],
        'Calendar'[WeekDay Name]
    ),
    USERELATIONSHIP(
        'Inventarios GS'[Fecha-7],
        'Calendar'[Date]
    )
)
+ [Acum Comp Anc Ins]
- [Acum Sal Anc Ins],0)
```

**Inv. Vis. Anc Ins** — formatString `0`
```
VAR DiaSemana =
    WEEKDAY(MAX('Calendar'[Date]),2)

RETURN
SWITCH(
    TRUE(),
    DiaSemana = 1, [Inv. -7 Anc Ins],   -- lunes
    DiaSemana = 7, [Inv. Anc Ins],      -- domingo
    BLANK()
)
```

**Vtas Tot Anc Ins** — formatString `0`
```
[Salidas Anc Ins]+[Vtas Anc Ins]
```

#### Carpeta: `Anc. Beb y Vin`

**Ap Copas/Bajas** — formatString `#,0`
```
SUM('Apertura Vinos por Copa'[#Botellas])+0
```

**Cierre Anc Beb** — formatString `0`
```
MAX(0,SUMX(Dim_Producto_iZi,CALCULATE([Inv. -7 Anc Beb]+[Compras Anc Beb]-[Vtas Anc Beb]-[Ap Copas/Bajas]-[Vtas Ext. Anc Beb]-[Cortesias Anc Beb], 
REMOVEFILTERS(
        'Calendar'[Date],
        'Calendar'[WeekDay],
        'Calendar'[WeekDay Name]
    )
)))
```

**Compras Anc Beb** — formatString `0`
```
CALCULATE(SUM('Compras Totales'[Cantidad]),'Compras Totales'[Empresa]="Ancestral")+0
```

**Cortesias Anc Beb** — formatString `0`
```
MAX(0,
CALCULATE(
    SUM('Mov Inv omuh (5)'[cantidad]),
    'Mov Inv omuh (5)'[tipoMovimiento] IN {"interna", "prod-venta"}
)
- [Vtas Anc Beb])
```

**Dif Anc Beb** — formatString `0`
```
SUMX(Dim_Producto_iZi, IF([Inv. Anc Beb]=BLANK(),BLANK(), [Inv. Anc Beb]-[Cierre Anc Beb]))
```

**Inv. Anc Beb** — formatString `0`
```
CALCULATE(SUM('Inventarios GS'[Cantidad]), REMOVEFILTERS('Calendar'[Date]))
```

**Inv. -7 Anc Beb** — formatString `0`
```
--CALCULATE(SUM('Inventarios-7 GS'[Cantidad]))

CALCULATE(
    AVERAGE('Inventarios GS'[Cantidad]),
    REMOVEFILTERS(
        'Calendar'[Date],
        'Calendar'[WeekDay],
        'Calendar'[WeekDay Name]
    ),
    USERELATIONSHIP(
        'Inventarios GS'[Fecha-7],
        'Calendar'[Date]
    )
)
```

**Vtas Ext. Anc Beb** — formatString `0`
```
SUM(fac_ventas_Ancestral_Productos_Extra[Cantidad])+0
```

**Vtas Anc Beb** — formatString `0`
```
SUM(fac_ventas_Ancestral_iZi[Cantidad Chuleton])+0
```

**Most Anc Beb** — formatString `0`
```
VAR _Filtro =
    SELECTEDVALUE('Filtro Dif'[ID], 1)

RETURN
SWITCH(
    _Filtro,
    1, 1,
    2, IF([Dif Anc Beb] = 0, 1, 0),
    3, IF([Dif Anc Beb] <> 0, 1, 0),
    1
)
```

**Acum Comp Beb** — sin formatString explícito
```
VAR FechaActual =
    MAX('Calendar'[Date])

VAR WeekActual =
    SELECTEDVALUE('Calendar'[WeekYear])

RETURN
CALCULATE(
    [Compras Anc Beb],

    FILTER(
        ALL('Calendar'),
        'Calendar'[Date] <= FechaActual
        &&
        'Calendar'[WeekYear] = WeekActual
    )
)
```

**Acum Sal Beb** — sin formatString explícito
```
VAR FechaActual =
    MAX('Calendar'[Date])

VAR WeekActual =
    SELECTEDVALUE('Calendar'[WeekYear])

RETURN
CALCULATE(
    [Vtas Tot Anc Beb],

    FILTER(
        ALL('Calendar'),
        'Calendar'[Date] <= FechaActual
        &&
        'Calendar'[WeekYear] = WeekActual
    )
)
```

**Inv. Esp. Beb** — formatString `0`
```
MAX(
CALCULATE(
    AVERAGE('Inventarios GS'[Cantidad]),
    REMOVEFILTERS(
        'Calendar'[Date],
        'Calendar'[WeekDay],
        'Calendar'[WeekDay Name]
    ),
    USERELATIONSHIP(
        'Inventarios GS'[Fecha-7],
        'Calendar'[Date]
    )
)
+ [Acum Comp Beb]
- [Acum Sal Beb],0)
```

**Inv. Vis. Beb** — formatString `0`
```
VAR DiaSemana =
    WEEKDAY(MAX('Calendar'[Date]),2)

RETURN
SWITCH(
    TRUE(),
    DiaSemana = 1, [Inv. -7 Anc Beb],   -- lunes
    DiaSemana = 7, [Inv. Anc Beb],      -- domingo
    BLANK()
)
```

**Vtas Tot Anc Beb** — formatString `0`
```
[Cortesias Anc Beb]+[Vtas Anc Beb]+[Vtas Ext. Anc Beb]+[Ap Copas/Bajas]
```

---

### 3.2 Tabla `03omuh` (29 medidas)

#### Carpeta: `Omuh Insumos`

**Inv. -7 Om Ins** — formatString `#,0`
```
CALCULATE(
    AVERAGE('Inventarios Unitarios GS omuh'[Cantidad]),
    USERELATIONSHIP(
        'Inventarios Unitarios GS omuh'[Fecha-7],
        'Calendar'[Date]
    )
)
```

**Compras Om Ins** — formatString `#,0`
```
CALCULATE(SUM('Compras Insumos omuH'[Porciones]))
```

**Vtas Om Ins** — formatString `#,0.0`
```
[Vtas Izi Om Ins]+[Vtas PY Om Ins]+[Cortesias Om Ins]+[Salidas Om Ins]+[Vtas Anc Izi Om Ins]+[Vtas Ext Om Ins]+ [Vtas Vegg Om Ins]
```

**Inv. Om Ins** — formatString `0`
```
CALCULATE(
    AVERAGE('Inventarios Unitarios GS omuh'[Cantidad])
)
```

**Cierre Om Ins** — formatString `#,0`
```
MAX(0,[Inv. -7 Om Ins]+[Compras Om Ins]-[Vtas Om Ins])
```

**Dif Om Ins** — formatString `#,0.0`
```
IF([Inv. Om Ins]=BLANK(),BLANK(), [Inv. Om Ins]-[Cierre Om Ins])
```

**Vtas Izi Om Ins** — formatString `0.0`
```
SUMX(
    fac_ventas_omuH_iZi,
    SWITCH(
        TRUE(),
        fac_ventas_omuH_iZi[Producto] = "Chop Cerveza", fac_ventas_omuH_iZi[Cantidad] * 0.75,
        fac_ventas_omuH_iZi[Producto] = "Chop Cerveza 2X1", fac_ventas_omuH_iZi[Cantidad] * 1.5,
        fac_ventas_omuH_iZi[codigoInventario] = "OMU00052", fac_ventas_omuH_iZi[Cantidad] * 0.5,
        fac_ventas_omuH_iZi[codigoInventario] = "OMU00053", fac_ventas_omuH_iZi[Cantidad] * 0.5,
       -- fac_ventas_omuH_iZi[codigoInventario] = "OMU00005", fac_ventas_omuH_iZi[Cantidad] * 0.5,
        fac_ventas_omuH_iZi[codigoInventario] = "OMU00086", fac_ventas_omuH_iZi[Cantidad] * 0.5,
        fac_ventas_omuH_iZi[codigoInventario] = "OMU00068", 0,
        fac_ventas_omuH_iZi[Cantidad]
    )
)
```

**Vtas PY Om Ins** — formatString `0.0`
```
--SUM(fac_ventas_omuH_PedidosYa[Cantidad])--Super Smash Burger
CALCULATE(
SUMX(
    fac_ventas_omuH_PedidosYa,
    SWITCH(
        TRUE(),
        fac_ventas_omuH_PedidosYa[Producto] = "Super Smash Burger", fac_ventas_omuH_PedidosYa[Cantidad] * 0.5,
        fac_ventas_omuH_PedidosYa[Producto] = "Carne Extra Super Smash Burger", fac_ventas_omuH_PedidosYa[Cantidad] * 0.5,
        fac_ventas_omuH_PedidosYa[Cantidad]
    )
),
USERELATIONSHIP(
        fac_ventas_omuH_PedidosYa[Cod. Producto],
        Dim_Producto_iZi[Cod. Producto]
    )
)
```

**Vtas Ext Om Ins** — formatString `0.0`
```
CALCULATE(SUM('Extras - iZi omuH'[Cantidad]), --'Extras - iZi omuH'[Tipo] ="Extra")
'Extras - iZi omuH'[Cantidad]>0)
```

**Salidas Om Ins** — formatString `#,0`
```
SUM('Salidas y Mermas omuH'[Porciones])
```

**Cortesias Om Ins** — formatString `0.0`
```
CALCULATE(SUM('Mov Inv omuh (5)'[cantidad]),'Mov Inv omuh (5)'[tipoMovimiento]="interna")
```

**Vtas Anc Izi Om Ins** — formatString `0.0`
```
--CALCULATE(SUM(fac_ventas_Ancestral_iZi[Cantidad2]))
SUMX(
    fac_ventas_Ancestral_iZi,
    SWITCH(
        TRUE(),
        fac_ventas_Ancestral_iZi[codigoInventario] = "OMU00052", fac_ventas_Ancestral_iZi[Cantidad2] * 0.5,
        fac_ventas_Ancestral_iZi[codigoInventario] = "OMU00053", fac_ventas_Ancestral_iZi[Cantidad2] * 0.5,
        --fac_ventas_Ancestral_iZi[codigoInventario] = "OMU00005", fac_ventas_Ancestral_iZi[Cantidad2] * 0.5,
        fac_ventas_Ancestral_iZi[codigoInventario] = "OMU00086", fac_ventas_Ancestral_iZi[Cantidad2] * 0.5,
        fac_ventas_Ancestral_iZi[Cantidad2]
    )
)
```

**Vtas Vegg Om Ins** — formatString `0.0`
```
CALCULATE(SUM('Extras - iZi omuH'[Cantidad]),-- 'Extras - iZi omuH'[Tipo] ="Veg")
'Extras - iZi omuH'[Cantidad]<0)
```

#### Carpeta: `Omuh Beb`

**Inv. Om Beb** — formatString `0`
```
SUM('Inventarios OMUH'[Cantidad])
```

**Inv. -7 Om Beb** — formatString `#,0`
```
--CALCULATE(SUM('Inventarios-7 GS'[Cantidad]))

CALCULATE(
    AVERAGE('Inventarios OMUH'[Cantidad]),
    REMOVEFILTERS(
        'Calendar'[Date],
        'Calendar'[WeekDay],
        'Calendar'[WeekDay Name]
    ),
    USERELATIONSHIP(
        'Inventarios OMUH'[Fecha-7],
        'Calendar'[Date]
    )
)
```

**Compras Om Beb** — formatString `0`
```
--CALCULATE(SUM('Compras Insumos omuH'[Cantidad]),'Compras Insumos omuH'[Empresa]="omuh")

CALCULATE(
    SUM('Compras Insumos omuH'[Cantidad]),
   -- 'Compras Insumos omuH'[Empresa] = "omuh",
    USERELATIONSHIP(
        'Dim_Producto_iZi'[Cod. Producto],
        'Compras Insumos omuH'[Cod Producto]
    )
)
```

**Vtas Ext Om Beb** — formatString `0`
```
--SUM('Extras - iZi omuH'[Cantidad])
CALCULATE(
    SUM('Extras - iZi omuH'[Cantidad]),
    USERELATIONSHIP(
        'Dim_Producto_iZi'[Producto],
        'Extras - iZi omuH'[Value]
    )
)
```

**Ventas Tot Om Beb** — formatString `0`
```
[Vtas Izi Om Beb]+[Vtas PY Om Beb]+[Vtas Ext Om Beb]+[Vtas Anc Izi Om Ins]+[Salidas Om Beb]
```

**Vtas PY Om Beb** — sin formatString explícito
```
--SUM(fac_ventas_omuH_PedidosYa[Cantidad])

CALCULATE(
    SUM(fac_ventas_omuH_PedidosYa[Cantidad]),
    USERELATIONSHIP(
        'Dim_Producto_iZi'[Cod. Producto],
        fac_ventas_omuH_PedidosYa[Cod. Producto]
    )
)
```

**Cierre Om Beb** — formatString `0`
```
MAX(0,
CALCULATE([Inv. -7 Om Beb]+[Compras Om Beb]-[Ventas Tot Om Beb]-[Cortesias Om Ins], 
REMOVEFILTERS(
        'Calendar'[Date],
        'Calendar'[WeekDay],
        'Calendar'[WeekDay Name]
    )
))
```

**Dif Om Beb** — formatString `0`
```
IF([Inv. Om Beb]=BLANK(),BLANK(), [Inv. Om Beb]-[Cierre Om Beb])
```

**Most Om Beb** — formatString `0`
```
VAR _Filtro =
    SELECTEDVALUE('Filtro Dif'[ID], 1)

VAR _DifPadre =
    CALCULATE(
        [Dif Om Beb],
        REMOVEFILTERS(Dim_Producto_iZi[Producto])
    )

RETURN
SWITCH(
    _Filtro,
    1, 1,
    2, IF(_DifPadre = 0, 1, 0),
    3, IF(_DifPadre <> 0, 1, 0),
    1
)
```

**Acum Comp Beb Om** — sin formatString explícito
```
VAR FechaActual =
    MAX('Calendar'[Date])

VAR WeekActual =
    SELECTEDVALUE('Calendar'[WeekYear])

RETURN
CALCULATE(
    [Compras Om Beb],

    FILTER(
        ALL('Calendar'),
        'Calendar'[Date] <= FechaActual
        &&
        'Calendar'[WeekYear] = WeekActual
    )
)
```

**Acum Sal Beb Om** — sin formatString explícito
```
VAR FechaActual =
    MAX('Calendar'[Date])

VAR WeekActual =
    SELECTEDVALUE('Calendar'[WeekYear])

RETURN
CALCULATE(
    [Ventas Tot Om Beb],

    FILTER(
        ALL('Calendar'),
        'Calendar'[Date] <= FechaActual
        &&
        'Calendar'[WeekYear] = WeekActual
    )
)
```

**Inv. Esp. Beb Om** — formatString `0`
```
MAX(
CALCULATE(
    AVERAGE('Inventarios OMUH'[Cantidad]),
    REMOVEFILTERS(
        'Calendar'[Date],
        'Calendar'[WeekDay],
        'Calendar'[WeekDay Name]
    ),
    USERELATIONSHIP(
        'Inventarios OMUH'[Fecha-7],
        'Calendar'[Date]
    )
)
+ [Acum Comp Beb Om]
- [Acum Sal Beb Om],0)
```

**Inv. Vis. Beb Om** — formatString `0`
```
VAR DiaSemana =
    WEEKDAY(MAX('Calendar'[Date]),2)

RETURN
SWITCH(
    TRUE(),
    DiaSemana = 1, [Inv. -7 Om Beb],   -- lunes
    DiaSemana = 7, [Inv. Om Beb],      -- domingo
    BLANK()
)
```

**Vtas Izi Om Beb** — formatString `0`
```
SUMX(
    fac_ventas_omuH_iZi,
    SWITCH(
        TRUE(),
        fac_ventas_omuH_iZi[Producto] = "Chop Cerveza", fac_ventas_omuH_iZi[Cantidad] * 0.75,
        fac_ventas_omuH_iZi[Producto] = "Chop Cerveza 2X1", fac_ventas_omuH_iZi[Cantidad] * 1.5,
        fac_ventas_omuH_iZi[codigoInventario] = "OMU00052", fac_ventas_omuH_iZi[Cantidad] * 0.5,
        fac_ventas_omuH_iZi[codigoInventario] = "OMU00053", fac_ventas_omuH_iZi[Cantidad] * 0.5,
        fac_ventas_omuH_iZi[codigoInventario] = "OMU00071", fac_ventas_omuH_iZi[Cantidad] * 0.5,
        fac_ventas_omuH_iZi[codigoInventario] = "OMU00086", fac_ventas_omuH_iZi[Cantidad] * 0.5,
        fac_ventas_omuH_iZi[codigoInventario] = "OMU00068", 0,
        fac_ventas_omuH_iZi[Cantidad]
    )
)
```

#### Sin `displayFolder` asignado

**Vtas Ext Om Ins2**
```
CALCULATE(SUM('Extras - iZi omuH vAPI'[Cantidad]), 'Extras - iZi omuH vAPI'[Cantidad]>0)
```

**Salidas Om Beb** — formatString `0`
```
CALCULATE(
SUM('Salidas y Mermas omuH'[Porciones]
),
USERELATIONSHIP(
        Dim_Producto_iZi[Producto], 'Salidas y Mermas omuH'[Categoria 3]
    )
)
```

---

### 3.3 Tabla `00Calculos` (1 medida, sin displayFolder)

**Rango de fechas**
```
FORMAT(MIN('Calendar'[Date]), "dd/MM/yyyy")
    & " - " &
FORMAT(MAX('Calendar'[Date]), "dd/MM/yyyy")
```
Usada en la tarjeta KPI "Rango de fechas" presente en las 5 páginas visibles.

*(No se encontraron más medidas en `00Calculos`; muchas referencias a "00Calculos.XXX" que aparecen dentro de los visuales del reporte, como `00Calculos.Compras`, `00Calculos.Inventario`, `00Calculos.Faltantes`, `00Calculos.Diferencia`, `00Calculos.Ventas Unidades`, etc., son en realidad **alias de columna** (`nativeQueryRef`/`queryRef`) que Power BI generó al renombrar visualmente medidas de `01 Ancestral`/`03omuh` dentro de una tabla dinámica — no corresponden a medidas DAX adicionales reales en el modelo. Se documentan como tales en la sección 4, indicando la medida real detrás de cada alias.)*

---

## 4. Páginas y visuales del reporte

7 páginas totales (`pages.json`), de las cuales **solo 5 están realmente visibles** para el usuario final (2 tienen `"visibility":"HiddenInViewMode"`, no solo la mencionada "Página 1"):

| Orden | id técnico | Nombre visible | Visible al usuario |
|---|---|---|---|
| 1 | `17b5d4f1860edcdba9ae` | An. Bebidas | Sí |
| 2 | `cf688588500077e72d4e` | An. Vinos | Sí |
| 3 | `4aa96c652eb071eec9e0` | An. Insumos | Sí (página activa por defecto) |
| 4 | `59e6ff90791b6e8405a6` | Om. Insumos | Sí |
| 5 | `a189daebb02e0c2ca844` | Om. Bebidas | Sí |
| 6 | `1a2d5310a2725b3fa696` | Duplicate of Om. Insumos | **No** — `visibility: HiddenInViewMode` |
| 7 | `3325b5a5c3303432d47e` | Página 1 | **No** — `visibility: HiddenInViewMode` |

Todas las páginas tienen fondo `#333333` y tamaño 1280×720 ("FitToPage").

### 4.1 An. Bebidas (`17b5d4f1860edcdba9ae`)

Filtro de página: `Dim_Producto_iZi[Categoria]` IN {`5. Bebidas alcohólicas`, `GASEOSA`, `CERVEZA`}.

Interacciones especiales: el slicer de semana (`119de72ec15bff584cdf`) NO filtra el gráfico de barras (`225d9df6207bc683e39d`) — `NoFilter`; el pivotTable de resumen (`46339109bd61da86e3d5`) sí lo filtra (`DataFilter`).

| Visual (id) | Tipo | Título / rol | Campos |
|---|---|---|---|
| `05cdfbfbf8a69cfae03a` | textbox | "ANCESTRAL / CONTROL INVENTARIO: BEBIDAS" | texto estático |
| `119de72ec15bff584cdf` | slicer (dropdown) | "Semana Año" | `Calendar[WeekYear]`, orden descendente, default `202637`, syncGroup "WeekYear" |
| `c92a7aa397056a21304b` | slicer (dropdown) | Producto | `Dim_Producto_iZi[Producto]`, filtrado a Categoria IN {AGUAS, CERVEZA, GASEOSA, VINOS, VINOS IMPORTADOS, 5. Bebidas alcohólicas}, syncGroup "Producto" |
| `5c6d3a2db66e8d56ab07` | slicer (básico, single-select) | Filtro Dif | `Filtro Dif[Filtro]`, default "Todos", syncGroup "Filtro" |
| `97b19c89a1ded10cd93b` | card | "Rango de fechas" | medida `00Calculos[Rango de fechas]` |
| `0bd79cb7a377920114d1` | slicer (básico) | Parámetro | `Parámetro An. Beb[Parámetro]`, default "Vtas", syncGroup "Parámetro" |
| `46339109bd61da86e3d5` | pivotTable | "Resumen Inventario" (oculto) | Filas: `Dim_Producto_iZi[Producto]`. Columnas: Inv.-7, Comp., Vtas, Vtas Ext, Cort., Sal.(Ap Copas/Bajas), Vtas Tot, Inv., Cie.(Cierre), Dif. — formato condicional en Dif (naranja si <0, morado si >0) |
| `225d9df6207bc683e39d` | clusteredColumnChart | (sin título fijo, controlado por field parameter) | Eje: `Calendar[WeekYear]`; Valor: field parameter `Parámetro An. Beb` (default `Vtas Anc Beb`); filtrado a `Calendar[Flag Ultimas 6 Semanas]=1` y `Most Anc Beb=1` |
| `283dd9cf10592a11c2c6` | pivotTable | "DETALLE DE MOVIMIENTOS POR PRODUCTO" (oculto) | Filas: Producto, Fecha, Día. Columnas: Comp., Cort., Vtas, Vtas Ext, Sal., Inv. Dia Esp., Inv.(Ini y Fin), Dif. — filtro de fecha relativo, `Most Anc Beb=1` |

### 4.2 An. Vinos (`cf688588500077e72d4e`)

**Mismo layout y mismos visuales que "An. Bebidas"** (idénticas medidas y estructura de tablas/gráfico), solo cambian:
- Título del textbox: "ANCESTRAL / CONTROL INVENTARIO: VINOS"
- Filtro de página: `Dim_Producto_iZi[Categoria]` IN {`CERVEZA`, `VINOS`, `VINOS IMPORTADOS`} (en vez de bebidas alcohólicas/gaseosa)
- El slicer de Producto tiene el mismo filtro de categorías que An. Bebidas (AGUAS/CERVEZA/GASEOSA/VINOS/VINOS IMPORTADOS/5. Bebidas alcohólicas)

### 4.3 An. Insumos (`4aa96c652eb071eec9e0`) — página activa por defecto

Filtro de página: `Matriz_de_Relaciones Ancestral[Insumo]` **excluye** `Entraña`, `HUARI`, `null` (selección invertida).

| Visual (id) | Tipo | Título / rol | Campos |
|---|---|---|---|
| `aa95ddbb453e6e395b7e` | textbox | "ANCESTRAL / CONTROL INVENTARIO: INSUMOS" | — |
| `01b23037ca137810d867` | slicer (dropdown) | "Semana Año" | `Calendar[WeekYear]`, syncGroup "WeekYear" |
| `922f4215a0ad9e460219` | slicer (dropdown) | Insumo | `Matriz_de_Relaciones Ancestral[Insumo]` |
| `c1a6d5b92a190c153d03` | slicer (básico) | Filtro Dif | `Filtro Dif[Filtro]`, default "Todos", syncGroup "Filtro" |
| `46bc63f091b53cc6749e` | card | "Rango de fechas" | `00Calculos[Rango de fechas]` |
| `0ff5cc5402add86aac08` | slicer (básico) | Parámetro An. Ins | `Parámetro An. Ins[Parámetro An. Ins]`, default "Vtas" |
| `b7c7a7d1234d8265d59e` | pivotTable | "RESUMEN SEMANAL POR PRODUCTO" (oculto) | Filas: `Matriz_de_Relaciones Ancestral[Insumo]` (+ Producto (izi) oculto). Columnas: Inv.-7, Comp., Vtas, Sal., Vtas Tot., Inv., Cie., Dif. — filtrado a Insumo≠HUARI/Entraña |
| `4bb6d39f673639e99387` | clusteredColumnChart | — | Eje: `Calendar[WeekYear]`; Valor: field parameter `Parámetro An. Ins` (default `Vtas Anc Ins`); filtrado a últimas 6 semanas y `Most Anc Ins=1` |
| `4b63c124058dd58abe3c` | pivotTable | "DETALLE DE MOVIMIENTOS POR PRODUCTO" (oculto) | Filas: Insumo, Fecha, Día. Columnas: Comp., Vtas, Sal., Inv. Dia Esp., Inv.(Ini y Fin), Dif |

### 4.4 Om. Insumos (`59e6ff90791b6e8405a6`)

Filtros de página: `Matriz_de_Relaciones omuh[Categoria]` (selección invertida), `Tabla[Insumo]` excluye null, `Dim_Producto_iZi[Categoria]`.

| Visual (id) | Tipo | Título / rol | Campos |
|---|---|---|---|
| `ea3b5adfe6e270aac356` | textbox | "OMUH / CONTROL INVENTARIO: INSUMOS" | — |
| `3c324427e5d5adca7e20` | slicer (dropdown) | "Semana Año" | `Calendar[WeekYear]`, syncGroup "WeekYear" |
| `4b5e74cf00592e726adc` | slicer (dropdown) | Insumo | `Tabla[Insumo]` |
| `1eb9174bd1b3e9adb45c` | slicer (dropdown) | Producto | `Dim_Producto_iZi[Producto]` |
| `a0707a023311a202761a` | card | "Rango de fechas" | `00Calculos[Rango de fechas]` |
| `5342ef74865ba15d7605` | slicer (básico) | Parámetro Om. Ins | `Parámetro Om. Ins[Parámetro Om. Ins]`, default "Vtas Tot." |
| `d21ab08150d9ad134b3b` | clusteredColumnChart | — | Eje: `Calendar[WeekYear]`; Valor: field parameter `Parámetro Om. Ins` (default `Vtas Om Ins`); filtrado a últimas 6 semanas |
| `da7de57401cc05db9ac7` | pivotTable | "RESUMEN SEMANAL POR PRODUCTO" (oculto) | Filas: `Tabla[Insumo]`. Columnas: Inv.-7, Comp., Vtas(izi), Vtas Anc, Vtas PY, Vtas Ext., Vtas Veg., Cort., Sal., Vtas Tot, Inv., Cie., Dif. Uni. — ordenado desc. por Vtas Ext. |
| `e86e32b888b17401e328` | pivotTable | "RESUMEN SEMANAL POR PRODUCTO" (oculto) | Filas: Insumo → Producto → Fecha (drill jerárquico). Columnas: Vtas Izi, Vtas Anc, Vtas PY, Cort — con subtotales por nivel |
| `5cac0215c7a91dbf60f6` | pivotTable (matriz) | "RESUMEN SEMANAL POR PRODUCTO" (oculto) | Filas: WeekYear→Fecha→Día; **Columnas cruzadas**: `Tabla[Insumo]`; Valores: field parameter `Parámetro Om. Ins` (default `Vtas Om Ins`) — layout matricial (columna por insumo) |

### 4.5 Om. Bebidas (`a189daebb02e0c2ca844`)

Filtro de página: `Dim_Producto_iZi[Categoria]` IN {`5. Bebidas alcohólicas`, `CERVEZA`, `GASEOSA`, `4. Bebidas no alcohólicas`}.

| Visual (id) | Tipo | Título / rol | Campos |
|---|---|---|---|
| `c683a5b234797e1c067a` | textbox | "OMUH / CONTROL INVENTARIO: BEBIDAS" | — |
| `642ff57420b1027b2416` | slicer (dropdown) | "Semana Año" | `Calendar[WeekYear]`, syncGroup "WeekYear" |
| `bd8e068b3d5973467467` | slicer (dropdown) | Producto | `Dim_Producto_iZi[Producto]`, filtrado a Categoria IN {AGUAS, CERVEZA, GASEOSA, VINOS, VINOS IMPORTADOS, 5. Bebidas alcohólicas} |
| `ab5b5cbd5be293780047` | card | "Rango de fechas" | `00Calculos[Rango de fechas]` |
| `7e370eb8a411c03bade0` | slicer (básico) | Parámetro Om. Beb | `Parámetro Om. Beb[Parámetro Om. Beb]`, default "Vtas Tot." |
| `b18c1904b32b2d65d209` | slicer (básico) | Filtro Dif | `Filtro Dif[Filtro]`, default "Todos", syncGroup "Filtro" |
| `c7e5abad9bab07161616` | pivotTable | "RESUMEN SEMANAL POR PRODUCTO" (oculto) | Filas: `Dim_Producto_iZi[Categoria Bebidas]` → Producto. Columnas: Inv.-7, Comp, Vtas, Vtas Ext, Vtas PY, Sal., Vtas Tot, Inv., Cie, Dif. |
| `39f5308d73d6aca94375` | clusteredColumnChart | — | Eje: `Calendar[WeekYear]`; Valor: field parameter `Parámetro Om. Beb` (default `Ventas Tot Om Beb`); filtrado a últimas 6 semanas y `Most Om Beb=1` |
| `3598905580ebae353013` | pivotTable | "DETALLE DE MOVIMIENTOS POR PRODUCTO" (oculto) | Filas: Producto, Fecha, Día. Columnas: Comp., Vtas, Vtas Ext, Vtas Anc, Vtas PY, Inv. Dia Esp., Inv.(Ini y Fin), Dif. — filtro de fecha relativo |

### 4.6 Páginas ocultas (no aparecen en modo lectura normal)

**"Duplicate of Om. Insumos" (`1a2d5310a2725b3fa696`)** — copia casi idéntica de la página "Om. Insumos" (mismos filtros de página, mismos 9 visuales por posición/tipo). `visibility: HiddenInViewMode`. Parece un borrador/backup de la página real; no requiere réplica adicional si ya se implementa "Om. Insumos".

**"Página 1" (`3325b5a5c3303432d47e`)** — scratchpad oculto con 2 tablas dinámicas simples: ventas de "Monto Total" (`fac_ventas_omuH_iZi` y `fac_ventas_omuH_PedidosYa` respectivamente) agrupadas por `Calendar[Date]` en filas y `AM/PM` en columnas. Parece usada para verificar franja horaria de ventas; no aporta lógica de negocio nueva.

### 4.7 Bookmarks

`bookmarks/bookmarks.json` lista 2 bookmarks: **"Ancestral"** (`8f30d3342ef5dd8203d3`) y **"Omuh"** (`8d3f723d4233e5f3e499`). Ambos usan `applyOnlyToTargetVisuals` + `suppressData` sobre una lista de ~13 ids de visual (`2d6ab98a571779c102bf`, `f664d25ba7aeef5b8f32`, etc.) que **no coinciden con ningún id de visual presente en las 7 páginas actuales** del reporte — es decir, son referencias obsoletas/huérfanas de una versión anterior del reporte (probablemente un selector de marca Ancestral/omuH que existió en algún momento y fue reemplazado por filtros de página). No se encontró un slicer o botón visible en el reporte actual que dispare estos bookmarks.

---

## 5. Filtros globales / parámetros

Todas las siguientes son **tablas calculadas** (`partition ... = calculated`) que actúan como "field parameters" (parámetros de campo) de Power BI: exponen una lista de medidas seleccionables desde un slicer, y esa selección alimenta dinámicamente el eje de valores de un gráfico de columnas vía `fieldParameters` en el `query.queryState`.

**`Parámetro An. Beb`** (usada en An. Bebidas / An. Vinos): columnas `Parámetro`, `Parámetro Campos` (oculta, `NAMEOF(...)`), `Parámetro Orden` (oculta). Opciones:
```
("Vtas", NAMEOF([Vtas Anc Beb]), 0),
("Vtas Ext", NAMEOF([Vtas Ext. Anc Beb]), 1),
("Cortesias", NAMEOF([Cortesias Anc Beb]), 2),
("Vtas Tot", NAMEOF([Vtas Tot Anc Beb]), 3),
("Salidas", NAMEOF([Ap Copas/Bajas]), 4),
("Compras", NAMEOF([Compras Anc Beb]), 5)
```

**`Parámetro An. Ins`** (usada en An. Insumos): opciones:
```
("Vtas", NAMEOF('01 Ancestral'[Vtas Anc Ins]), 0),
("Salidas", NAMEOF('01 Ancestral'[Salidas Anc Ins]), 1),
("Vtas Tot", NAMEOF('01 Ancestral'[Vtas Tot Anc Ins]), 2),
("Compras (Un)", NAMEOF('01 Ancestral'[Compras Anc Ins]), 3)
```

**`Parámetro Om. Ins`** (usada en Om. Insumos): opciones:
```
("Vtas", NAMEOF('03omuh'[Vtas Izi Om Ins]), 0),
("Vtas Anc", NAMEOF('03omuh'[Vtas Anc Izi Om Ins]), 1),
("Vtas PY", NAMEOF('03omuh'[Vtas PY Om Ins]), 2),
("Vtas Ext.", NAMEOF('03omuh'[Vtas Ext Om Ins]), 3),
("Cortesias", NAMEOF('03omuh'[Cortesias Om Ins]), 4),
("Salidas", NAMEOF('03omuh'[Salidas Om Ins]), 5),
("Vtas Tot.", NAMEOF('03omuh'[Vtas Om Ins]), 6),
("Compras", NAMEOF('03omuh'[Compras Om Ins]), 7)
```

**`Parámetro Om. Beb`** (usada en Om. Bebidas): opciones:
```
("Vtas", NAMEOF('03omuh'[Vtas Izi Om Beb]), 0),
("Vtas Ext.", NAMEOF('03omuh'[Vtas Ext Om Beb]), 1),
("Vtas PY", NAMEOF('03omuh'[Vtas PY Om Beb]), 2),
("Vtas Tot.", NAMEOF('03omuh'[Ventas Tot Om Beb]), 3),
("Compras", NAMEOF('03omuh'[Compras Om Beb]), 4)
```

**`Filtro Dif`** (usada en las 4 páginas de Ancestral/omuH salvo Om. Insumos — no tiene slicer explícito de Filtro Dif ahí, aunque las medidas `Most Om Ins` no existen; sí existe en An. Bebidas, An. Vinos, An. Insumos y Om. Bebidas): tabla `DATATABLE` fija con 3 filas — no es un what-if parameter sino una lista estática de opciones:
```
DATATABLE(
    "ID", INTEGER,
    "Filtro", STRING,
    {
        {1, "Todos"},
        {2, "Dif = 0"},
        {3, "Dif <> 0"}
    }
)
```
Se usa como single-select slicer; la selección alimenta las medidas `Most Anc Beb`, `Most Anc Ins`, `Most Om Beb` (patrón `SELECTEDVALUE('Filtro Dif'[ID],1)` → `SWITCH` que devuelve 1/0 según si la fila cumple "todos" / "diferencia=0" / "diferencia≠0"), y esas medidas `Most *` se usan como filtro avanzado (`=1`) sobre las tablas dinámicas y gráficos para mostrar solo filas que cumplen el criterio elegido.

No se encontró una medida `Most Om Ins` en `03omuh` (no existe en la lista de 29 medidas); la página Om. Insumos no tiene slicer de Filtro Dif.

---

## 6. Resumen ejecutivo

"Nuevo Inventarios" es un dashboard de control diario/semanal de inventario de bebidas e insumos para dos negocios gastronómicos hermanos (Ancestral y omuH), que cruza inventario físico contado, compras, ventas (por canal: POS iZi, PedidosYa, cortesías/mermas internas) para calcular un "cierre esperado" y compararlo contra el conteo real, señalando diferencias (faltantes/sobrantes).

Tiene **4 módulos reales de negocio** (5 páginas visibles, ya que "An. Bebidas" y "An. Vinos" comparten exactamente el mismo diseño de visuales, solo con distinto filtro de categoría de producto): Ancestral-Insumos, Ancestral-Bebidas/Vinos, omuH-Insumos, omuH-Bebidas. Cada módulo repite el mismo patrón: tarjeta de rango de fechas, slicers de semana/producto/insumo, selector de "Filtro Dif" (todos / cuadra / no cuadra), gráfico de barras configurable (field parameter) por semana, y dos tablas dinámicas (resumen semanal + detalle diario) con formato condicional en la columna "Dif." (naranja = faltante, morado = sobrante).

El KPI/tabla más importante de cada página es la tabla dinámica "RESUMEN SEMANAL POR PRODUCTO" (oculta de título pero central en el layout), que muestra por producto/insumo las columnas Inventario -7, Compras, Ventas (desglosadas por canal), Salidas, Inventario actual, Cierre calculado y Diferencia — es el corazón operativo del dashboard, alimentado por la cadena de medidas `Inv. -7 → Compras → Vtas (SWITCH por producto con factores 0.5/0.75/1.5) → Cierre = MAX(0, Inv.-7 + Compras - Ventas) → Dif = Inv. real - Cierre`.

---

*Documento generado íntegramente a partir de archivos TMDL/PBIR en disco, sin usar Power BI ni herramientas MCP.*
