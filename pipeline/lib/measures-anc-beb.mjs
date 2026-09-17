// pipeline/lib/measures-anc-beb.mjs
// Réplica en JS puro de las 15 medidas DAX de la carpeta "Anc. Beb y Vin" (tabla `01 Ancestral`),
// documentadas en ANALISIS_PBIX.md sección 3.1 (líneas ~356-521) y verificadas contra el TMDL
// crudo del modelo real (Dim_Producto_iZi.tmdl, Inventarios GS.tmdl, Compras Totales.tmdl,
// fac_ventas_Ancestral_iZi.tmdl, fac_ventas_Ancestral_Productos_Extra.tmdl, Mov Inv omuh (5).tmdl,
// Apertura Vinos por Copa.tmdl, relationships.tmdl).
//
// A diferencia de "Anc. Insumos" (agrupada por Matriz_de_Relaciones Ancestral[Insumo]), esta
// carpeta agrupa por Dim_Producto_iZi[Producto]. Ambas páginas reales del PBIX -- "An. Vinos" y
// "An. Bebidas" -- comparten EXACTAMENTE estas medidas; solo cambia la lista de
// Dim_Producto_iZi[Categoria] con la que se filtra la página (ver filtrarProductosPorCategoria).
// Por eso todas las funciones de aquí son puras y NO conocen categorías: el filtro de categoría se
// aplica una sola vez, al construir la lista de productos a iterar (pipeline/lib/anc-beb-vin-pipeline.mjs).
//
// Todas las funciones reciben arrays de filas ya "planas" con un campo `producto` adjunto (el
// nombre de Dim_Producto_iZi[Producto] al que esa fila fue asignada vía su Cod Producto /
// codigoInventario -- ver attachProducto en anc-beb-vin-pipeline.mjs) y devuelven números (o
// null para BLANK()).
//
// Diferencias reales frente a "Anc. Insumos" confirmadas leyendo el TMDL (no asumidas):
//   - `Inv. Anc Beb`  usa SUM (no AVERAGE como `Inv. Anc Ins`).
//   - `Compras Anc Beb` se agrupa por el campo `Fecha` FUSIONADO de Compras Totales
//     (= Fecha Porcion ?? Fecha1), que SÍ tiene relación activa con Calendar (a diferencia de
//     Compras Insumos, donde la activa es Fecha1 y Fecha solo tiene LocalDateTable). Ver nota en
//     comprasAncBeb.
//   - `Inv. Esp. Beb` NO tiene el bug de tabla-equivocada que sí tiene `Inv. Esp. Anc Ins`: usa
//     'Inventarios GS' correctamente, así que el término base es el promedio de la SEMANA ANTERIOR
//     (no el de toda la semana en curso).

import { weekYear, weekYearToRange } from "./calendar.mjs";
import { addDays } from "./sheets.mjs";

function sum(values) {
  const nums = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  if (nums.length === 0) return 0; // SUM de DAX sobre conjunto vacío -> 0 (+0 en las medidas originales lo confirma)
  return nums.reduce((a, b) => a + b, 0);
}

function average(values) {
  const nums = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  if (nums.length === 0) return null; // AVERAGE de DAX sobre conjunto vacío -> BLANK()
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// ---------------------------------------------------------------------------
// Filtro de página (parametrizable por lista de categorías)
// ---------------------------------------------------------------------------

/**
 * Filtro de página real: Dim_Producto_iZi[Categoria] IN {lista}.
 *   - An. Vinos: {"CERVEZA","VINOS","VINOS IMPORTADOS"} (sección 4.2 de ANALISIS_PBIX.md)
 *   - An. Bebidas (futuro): {"5. Bebidas alcohólicas","GASEOSA","CERVEZA"} (sección 4.1)
 * dimProductoRows: [{ codProducto, producto, categoria }]
 */
export function filtrarProductosPorCategoria(dimProductoRows, categorias) {
  const catSet = new Set(categorias);
  return dimProductoRows.filter((r) => catSet.has(r.categoria));
}

// ---------------------------------------------------------------------------
// Ap Copas/Bajas
// ---------------------------------------------------------------------------

/** Ap Copas/Bajas = SUM('Apertura Vinos por Copa'[#Botellas])+0 */
export function apCopasBajas(aperturaRows, producto, weekYearStr) {
  const rows = aperturaRows.filter((r) => r.producto === producto && weekYear(r.fecha) === weekYearStr);
  return sum(rows.map((r) => r.numBotellas));
}

// ---------------------------------------------------------------------------
// Compras Anc Beb
// ---------------------------------------------------------------------------

/**
 * Compras Anc Beb = CALCULATE(SUM('Compras Totales'[Cantidad]),'Compras Totales'[Empresa]="Ancestral")+0
 *
 * OJO (confirmado en relationships.tmdl): a diferencia de 'Compras Insumos' (donde la relación
 * ACTIVA a Calendar es vía `Fecha1`), en 'Compras Totales' la relación ACTIVA a Calendar es vía
 * la columna `Fecha` FUSIONADA (= Fecha Porcion ?? Fecha1, ya calculada dentro del M de
 * 'Compras Insumos' y heredada por 'Compras Totales' = Table.Combine({Compras Insumos})); Fecha1 y
 * 'Fecha Porcion' en 'Compras Totales' solo tienen relación con sus propias LocalDateTable, no con
 * Calendar. Por eso aquí agrupamos por `row.fecha` (el campo fusionado), al revés que en
 * measures-an-insumos.mjs::comprasAncIns (que agrupa por fecha1).
 */
export function comprasAncBeb(comprasRows, producto, weekYearStr) {
  const rows = comprasRows.filter(
    (r) => r.producto === producto && r.empresa === "Ancestral" && r.fecha && weekYear(r.fecha) === weekYearStr
  );
  return sum(rows.map((r) => r.cantidad));
}

// ---------------------------------------------------------------------------
// Vtas Anc Beb / Vtas Ext. Anc Beb
// ---------------------------------------------------------------------------

/** Vtas Anc Beb = SUM(fac_ventas_Ancestral_iZi[Cantidad Chuleton])+0 */
export function vtasAncBeb(ventasRows, producto, weekYearStr) {
  const rows = ventasRows.filter((r) => r.producto === producto && weekYear(r.fecha) === weekYearStr);
  return sum(rows.map((r) => r.cantidadChuleton));
}

/**
 * Vtas Ext. Anc Beb = SUM(fac_ventas_Ancestral_Productos_Extra[Cantidad])+0
 * ventasExtraRows ya vienen construidas (ver buildVentasExtraRows en anc-beb-vin-pipeline.mjs):
 * para cada venta cuyo codigoInventario matchea una fila de Matriz_de_Relaciones Ancestral con
 * Cod Insumo="ANC00007", Cantidad = Matriz[Cantidad usada (kg o u)] * venta.Cantidad (la Cantidad
 * CRUDA de la venta, no 'Cantidad Chuleton'), atribuida al producto cuyo Cod. Producto = "ANC00007".
 *
 * OJO (verificado contra el modelo real, no asumido del resumen): "ANC00007" NO es el código de
 * insumo de Chuletón en esta tabla -- la ÚNICA fila de Matriz_de_Relaciones Ancestral con
 * Cod Insumo="ANC00007" es {Insumo="HUARI", Cod Producto="ANC00010" (MICHELADA ANCESTRAL)}. Es
 * decir, ese código de insumo fue reutilizado para la cerveza HUARI dentro de la receta de la
 * Michelada (coincidencia real de los datos). El efecto neto: las ventas de "MICHELADA ANCESTRAL"
 * alimentan `Vtas Ext. Anc Beb` del producto "HUARI" (categoría CERVEZA). Confirmado también que
 * `fac_ventas_Ancestral_Productos_Extra[Cantidad]` sale BLANK para TODAS las filas históricas en
 * el modelo actualmente abierto (import cacheado con 'Cantidad usada (kg o u)' vacío para esa fila
 * de la Matriz), mientras que el Google Sheet en vivo ya tiene ese campo lleno (1.00) -- desfase de
 * actualización análogo al documentado en README.md para "An. Insumos", no un bug de este pipeline
 * (ver nota de validación en el README de este módulo).
 */
export function vtasExtAncBeb(ventasExtraRows, producto, weekYearStr) {
  const rows = ventasExtraRows.filter((r) => r.producto === producto && weekYear(r.fecha) === weekYearStr);
  return sum(rows.map((r) => r.cantidad));
}

// ---------------------------------------------------------------------------
// Cortesias Anc Beb / Vtas Tot Anc Beb
// ---------------------------------------------------------------------------

/**
 * Cortesias Anc Beb = MAX(0, CALCULATE(SUM('Mov Inv omuh (5)'[cantidad]),
 *                                       tipoMovimiento IN {"interna","prod-venta"}) - [Vtas Anc Beb])
 * `vtas` debe ser el mismo valor ya calculado con vtasAncBeb() para el mismo producto/semana.
 */
export function cortesiasAncBeb(movInvRows, producto, weekYearStr, vtas) {
  const rows = movInvRows.filter(
    (r) =>
      r.producto === producto &&
      weekYear(r.fecha) === weekYearStr &&
      (r.tipoMovimiento === "interna" || r.tipoMovimiento === "prod-venta")
  );
  const movTotal = sum(rows.map((r) => r.cantidad));
  return Math.max(0, movTotal - vtas);
}

/** Vtas Tot Anc Beb = [Cortesias Anc Beb]+[Vtas Anc Beb]+[Vtas Ext. Anc Beb]+[Ap Copas/Bajas] */
export function vtasTotAncBeb(cortesias, vtas, vtasExt, apCopas) {
  return cortesias + vtas + vtasExt + apCopas;
}

// ---------------------------------------------------------------------------
// Inv. Anc Beb / Inv. -7 Anc Beb
// ---------------------------------------------------------------------------

/**
 * Inv. Anc Beb = CALCULATE(SUM('Inventarios GS'[Cantidad]), REMOVEFILTERS('Calendar'[Date]))
 *
 * REMOVEFILTERS(Calendar[Date]) solo limpia el filtro puesto directamente sobre la columna Date
 * (p.ej. el que trae la fila "Fecha" de la tabla de detalle diario); el filtro puesto por el
 * slicer "Semana Año" es sobre la columna Calendar[WeekYear] (otra columna de la misma tabla) y
 * SIGUE activo, así que efectivamente esto suma 'Inventarios GS'[Cantidad] de TODA la semana
 * (cualquier día), no promedia como su medida gemela `Inv. Anc Ins`.
 *
 * OJO (encontrado al validar con dax_query_operations, no asumido): a diferencia de
 * `Ap Copas/Bajas`/`Compras Anc Beb`/`Vtas Anc Beb`/`Vtas Ext. Anc Beb` (que todas terminan en
 * "+0" en el DAX original, forzando BLANK() -> 0), esta medida NO tiene "+0". SUM() de DAX sobre
 * un conjunto vacío de filas es BLANK(), no 0 -- si el producto no tiene NINGUNA fila en
 * 'Inventarios GS' para esa semana, `Inv. Anc Beb` debe quedar en null (y por lo tanto también
 * `Dif Anc Beb`, que se define como BLANK() cuando Inv es BLANK()). La primera pasada de
 * validación (semana 202637, 107 productos) encontró 73 discrepancias exactamente en estos dos
 * campos porque acá se sumaba con default 0; se corrigió y se revalidó con coincidencia exacta.
 */
export function invAncBeb(inventariosGsRows, producto, weekYearStr) {
  const rows = inventariosGsRows.filter((r) => r.producto === producto && weekYear(r.fecha) === weekYearStr);
  const nums = rows.map((r) => r.cantidad).filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  if (nums.length === 0) return null; // SUM() de DAX sin "+0" sobre conjunto vacío -> BLANK()
  return nums.reduce((a, b) => a + b, 0);
}

/**
 * Inv. -7 Anc Beb = CALCULATE(AVERAGE('Inventarios GS'[Cantidad]),
 *                              REMOVEFILTERS(Date,WeekDay,WeekDay Name),
 *                              USERELATIONSHIP('Inventarios GS'[Fecha-7], Calendar[Date]))
 * Mismo patrón que invMenos7AncIns: selecciona filas cuyo Fecha+7 cae en la semana consultada,
 * es decir Fecha cae en la semana ANTERIOR, y promedia su Cantidad.
 */
export function invMenos7AncBeb(inventariosGsRows, producto, weekYearStr, anchorDate) {
  const range = weekYearToRange(weekYearStr, anchorDate);
  if (!range) return null;
  const prevStart = addDays(range.start, -7);
  const prevEnd = addDays(range.end, -7);
  const rows = inventariosGsRows.filter(
    (r) => r.producto === producto && r.fecha.getTime() >= prevStart.getTime() && r.fecha.getTime() <= prevEnd.getTime()
  );
  return average(rows.map((r) => r.cantidad));
}

// ---------------------------------------------------------------------------
// Cierre / Dif / Inv. Vis.
// ---------------------------------------------------------------------------

/**
 * Cierre Anc Beb = MAX(0, SUMX(Dim_Producto_iZi,
 *   CALCULATE([Inv. -7 Anc Beb]+[Compras Anc Beb]-[Vtas Anc Beb]-[Ap Copas/Bajas]-[Vtas Ext. Anc Beb]-[Cortesias Anc Beb],
 *              REMOVEFILTERS(Date,WeekDay,WeekDay Name))))
 * El SUMX sobre Dim_Producto_iZi solo importa cuando hay más de un producto en el contexto de
 * filtro; como aquí siempre calculamos por un producto puntual, es equivalente a la resta directa.
 */
export function cierreAncBeb(invMenos7, compras, vtas, apCopas, vtasExt, cortesias) {
  const base = (invMenos7 ?? 0) + compras - vtas - apCopas - vtasExt - cortesias;
  return Math.max(0, base);
}

/**
 * Dif Anc Beb = SUMX(Dim_Producto_iZi, IF([Inv. Anc Beb]=BLANK(),BLANK(), [Inv. Anc Beb]-[Cierre Anc Beb]))
 *
 * OJO (encontrado y confirmado al validar con dax_query_operations, no asumido): en DAX, comparar
 * un número con BLANK() usando "=" trata BLANK() como equivalente a 0 (coerción numérica estándar
 * de DAX) -- es decir, `[Inv. Anc Beb] = BLANK()` da TRUE tanto si Inv es BLANK() real (sin filas)
 * COMO si Inv es un 0 real (SUM de filas cuya Cantidad efectivamente suma 0). Se confirmó
 * directamente contra el modelo real con productos donde `Inv. Anc Beb` = 0 (real, no blank) y
 * `Dif Anc Beb` sale en blanco igual (p.ej. "AMOR FATI - TELLUS", semana 202637: Inv=0, Cierre=0,
 * pero Dif=BLANK, no 0). Replicamos ese comportamiento tal cual: Dif es blank tanto si inv es
 * null/undefined como si inv===0.
 */
export function difAncBeb(inv, cierre) {
  if (inv === null || inv === undefined || inv === 0) return null;
  return inv - cierre;
}

/**
 * Inv. Vis. Beb = SWITCH(TRUE(), WEEKDAY(MAX(Date),2)=1, [Inv. -7 Anc Beb], WEEKDAY(...)=7, [Inv. Anc Beb], BLANK())
 * Solo tiene valor en lunes (apertura = cierre de la semana anterior) y domingo (cierre real de
 * la semana); el resto de días queda en blanco -- a diferencia de "An. Insumos" (que cuenta
 * inventario a diario), en Beb/Vin el conteo físico es semanal.
 * weekdayIsoNum: 1=lunes .. 7=domingo (ver calendar.mjs::weekdayIso).
 */
export function invVisBeb(weekdayIsoNum, invMenos7, inv) {
  if (weekdayIsoNum === 1) return invMenos7;
  if (weekdayIsoNum === 7) return inv;
  return null;
}

// ---------------------------------------------------------------------------
// Acum Comp Beb / Acum Sal Beb / Inv. Esp. Beb (detalle diario)
// ---------------------------------------------------------------------------

/**
 * Acum Comp Beb = CALCULATE([Compras Anc Beb], FILTER(ALL(Calendar), Date<=FechaActual && WeekYear=WeekActual))
 * Acumulado de compras desde el lunes de la semana hasta `fechaActual` (inclusive).
 */
export function acumComprasAncBeb(comprasRows, producto, weekYearStr, fechaActual) {
  const rows = comprasRows.filter(
    (r) =>
      r.producto === producto &&
      r.empresa === "Ancestral" &&
      r.fecha &&
      weekYear(r.fecha) === weekYearStr &&
      r.fecha.getTime() <= fechaActual.getTime()
  );
  return sum(rows.map((r) => r.cantidad));
}

/**
 * Acum Sal Beb = mismo patrón FILTER(ALL(Calendar), Date<=FechaActual && WeekYear=WeekActual) pero
 * sobre [Vtas Tot Anc Beb] = Cortesias+Vtas+VtasExt+ApCopas. Como Cortesias depende a su vez de
 * Vtas (ambas evaluadas en el mismo contexto acumulado), se recalculan las 4 componentes
 * acumuladas hasta `fechaActual` y se suman con la misma fórmula que vtasTotAncBeb.
 */
export function acumSalAncBeb(ventasRows, ventasExtraRows, movInvRows, aperturaRows, producto, weekYearStr, fechaActual) {
  const hastaFecha = (r) =>
    r.producto === producto && weekYear(r.fecha) === weekYearStr && r.fecha.getTime() <= fechaActual.getTime();

  const vtasCum = sum(ventasRows.filter(hastaFecha).map((r) => r.cantidadChuleton));
  const vtasExtCum = sum(ventasExtraRows.filter(hastaFecha).map((r) => r.cantidad));
  const movCum = sum(
    movInvRows
      .filter((r) => hastaFecha(r) && (r.tipoMovimiento === "interna" || r.tipoMovimiento === "prod-venta"))
      .map((r) => r.cantidad)
  );
  const cortesiasCum = Math.max(0, movCum - vtasCum);
  const apCopasCum = sum(aperturaRows.filter(hastaFecha).map((r) => r.numBotellas));

  return vtasTotAncBeb(cortesiasCum, vtasCum, vtasExtCum, apCopasCum);
}

/**
 * Inv. Esp. Beb = MAX(0,
 *   CALCULATE(AVERAGE('Inventarios GS'[Cantidad]), REMOVEFILTERS(Date,WeekDay,WeekDay Name),
 *             USERELATIONSHIP('Inventarios GS'[Fecha-7], Calendar[Date]))
 *   + [Acum Comp Beb] - [Acum Sal Beb])
 *
 * A diferencia de `Inv. Esp. Anc Ins` (que tiene el bug de tabla-equivocada documentado en
 * measures-an-insumos.mjs), esta SÍ usa 'Inventarios GS' correctamente -- verificado contra
 * Inventarios GS.tmdl / relationships.tmdl: no hay discrepancia de tabla aquí. El término base es
 * por lo tanto el promedio de la SEMANA ANTERIOR (mismo cálculo que invMenos7AncBeb).
 */
export function invEspBeb(inventariosGsRows, producto, weekYearStr, anchorDate, acumComp, acumSal) {
  const avgSemanaAnterior = invMenos7AncBeb(inventariosGsRows, producto, weekYearStr, anchorDate);
  const base = (avgSemanaAnterior ?? 0) + acumComp - acumSal;
  return Math.max(0, base);
}

export { weekYear, weekYearToRange };
