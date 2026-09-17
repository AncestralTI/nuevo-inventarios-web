# Nuevo Inventarios — versión web

Réplica web del dashboard de Power BI **"Nuevo Inventarios"** (`Nuevo Inventarios.pbix`), construida a partir del análisis directo del archivo: mismas páginas, mismos filtros y las mismas medidas y fuentes de datos.

> **Estado actual: módulo piloto "An. Insumos" completo y validado.** Es el primer módulo con datos y medidas reales (pipeline Node.js + frontend), construido y verificado número por número contra el modelo Power BI real. Las otras 4 páginas (An. Bebidas, An. Vinos, Om. Insumos, Om. Bebidas) siguen como placeholder "pendiente" — se replicará el mismo patrón en las siguientes fases. Ver [ANALISIS_PBIX.md](./ANALISIS_PBIX.md) para el análisis exhaustivo del modelo original.

## Estructura confirmada del dashboard original

El PBIX compara dos marcas/negocios, cada una con sus propias páginas:

- **Ancestral**: An. Bebidas, An. Vinos, **An. Insumos** (piloto, ✅ datos reales)
- **omuH**: Om. Insumos, Om. Bebidas

(Existen además una página duplicada "Duplicate of Om. Insumos" y una página oculta de trabajo "Página 1", que no se muestran al usuario final en Power BI y tampoco se replican aquí.)

## Estructura del proyecto

```
nuevo-inventarios-web/
├── index.html                     # Shell de la aplicación (navegación por marca/página)
├── css/styles.css                  # Estilos
├── js/app.js                       # Lógica de navegación; delega "An. Insumos" al módulo real
├── js/pages/an-insumos.js          # Renderer del módulo piloto (slicers, tablas, gráfico)
├── data/an-insumos.json            # Salida del pipeline (datos reales, se regenera cada corrida)
├── pipeline/
│   ├── package.json
│   ├── build-an-insumos.mjs        # Orquestador: fetch + transform + medidas -> data/an-insumos.json
│   └── lib/
│       ├── sheets.mjs              # fetch + parseo CSV (Google Sheets publicados) + unpivot genérico
│       ├── izi-api.mjs             # login + fetch de ventas de la API iZi Soluciones
│       ├── calendar.mjs            # réplica de la tabla calculada Calendar (WeekYear, WEEKNUM tipo Excel 2, etc.)
│       └── measures-an-insumos.mjs # réplica en JS puro de las 13 medidas DAX de "Anc. Insumos"
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

### 2. Servir el sitio estático

```powershell
powershell -File tools/devserver.ps1 -Port 5500
```

Y abrir `http://localhost:5500`. La página "An. Insumos" (activa por defecto, igual que en el PBIX
original) lee `data/an-insumos.json` vía `fetch` relativo.

## Fuente de datos (confirmada, ver ANALISIS_PBIX.md sección 1)

No hay SQL Server. Tres orígenes reales:
1. **API REST de iZi Soluciones** (`api.beta.izisoluciones.com`) — POS/facturación, login + `/facturas`.
2. **Google Sheets publicados como CSV** ("publicar a la web") — compras, salidas/mermas, recetas
   (matriz de relaciones insumo↔producto) e inventarios físicos contados manualmente.
3. **Tablas calculadas en DAX** (sin fuente externa) — recreadas en JS en `pipeline/lib/`.

En producción, un GitHub Action con cron corre el pipeline y commitea `data/*.json`; GitHub Pages sirve
el sitio estático resultante. Las credenciales de iZi viven solo como GitHub Actions Secrets, nunca en
el repo.

## Validación del módulo piloto

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

## Próximos pasos

1. Replicar el mismo patrón (pipeline + medidas + frontend) para An. Bebidas, An. Vinos, Om. Insumos y
   Om. Bebidas.
2. Crear el repo en GitHub, configurar el GitHub Action con cron y los Secrets de iZi.
3. Activar GitHub Pages.
