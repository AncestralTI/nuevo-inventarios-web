# Nuevo Inventarios — versión web

Réplica web del dashboard de Power BI **"Nuevo Inventarios"** (`Nuevo Inventarios.pbix`), construida a partir del análisis directo del archivo: mismas páginas, mismos filtros y (una vez conectada) las mismas medidas y fuentes de datos.

> **Estado actual: esqueleto inicial.** La navegación y los filtros de página ya reflejan la estructura real del PBIX. Las medidas DAX, tablas y gráficos todavía están en fase de extracción/mapeo — ver [ANALISIS_PBIX.md](./ANALISIS_PBIX.md) cuando esté disponible.

## Estructura confirmada del dashboard original

El PBIX compara dos marcas/negocios, cada una con sus propias páginas:

- **Ancestral**: An. Bebidas, An. Vinos, An. Insumos
- **omuH**: Om. Insumos, Om. Bebidas

(Existen además una página duplicada "Duplicate of Om. Insumos" y una página oculta de trabajo "Página 1", que no se muestran al usuario final en Power BI y tampoco se replican aquí.)

## Estructura del proyecto

```
nuevo-inventarios-web/
├── index.html        # Shell de la aplicación (navegación por marca/página)
├── css/styles.css     # Estilos
├── js/app.js          # Lógica de navegación y render de páginas
├── data/               # (futuro) capa de datos / respuestas de API
└── ANALISIS_PBIX.md   # Análisis exhaustivo del modelo PBIX (fuente de verdad)
```

## Cómo ejecutar localmente

Es HTML/CSS/JS plano, sin build step. Basta con abrir `index.html` en el navegador, o servirlo con cualquier servidor estático, por ejemplo:

```bash
npx serve .
```

## Fuente de datos

Pendiente de documentar aquí una vez completado el análisis de las consultas Power Query del PBIX (ver ANALISIS_PBIX.md). Si la fuente es una base de datos (p. ej. SQL Server), **GitHub Pages no puede conectarse directamente** porque solo sirve archivos estáticos — se necesitará un backend/API intermedio (Azure Functions, un pequeño servidor, o una exportación programada a JSON) para no exponer credenciales en el repositorio público. Este documento se actualizará con el plan concreto.

## Próximos pasos

1. Completar el mapeo de medidas DAX y visuales por página.
2. Definir e implementar la conexión real a la fuente de datos (sin exponer credenciales).
3. Reemplazar los paneles placeholder por las tablas/gráficos reales.
4. Validar los resultados contra el PBIX original.
