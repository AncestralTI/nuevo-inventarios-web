// pipeline/lib/measures-an-insumos.mjs
// Réplica en JS puro de las medidas DAX de la carpeta "Anc. Insumos" (tabla `01 Ancestral`),
// tal como están documentadas en ANALISIS_PBIX.md sección 3.1 (líneas ~192-355).
//
// Todas las funciones son puras: reciben los datos ya "planos" (arrays de filas) y
// devuelven números (o null para BLANK()). El orden de dependencia sigue al DAX:
//   Peso Porcion -> PromedioSinOutliers -> Porciones calculadas (Compras/Salidas)
//   -> Inv / Inv-7 / Compras / Salidas / Vtas -> Vtas Tot -> Cierre -> Dif
//   -> Acum Comp / Acum Sal -> Inv Esp (tabla detalle diario)

import { weekYear, weekdayIso, weekdayName, mondayOf, weekYearToRange } from "./calendar.mjs";
import { addDays, fmtDate } from "./sheets.mjs";

// ---------------------------------------------------------------------------
// Peso Porcion (tabla calculada) y PromedioSinOutliers
// ---------------------------------------------------------------------------

/**
 * Peso Porcion = FILTER(SELECTCOLUMNS('Compras Insumos', Fecha, Producto, 'Peso Real', Porciones, Empresa),
 *                        Fecha >= TODAY()-60 && 'Peso Real' no blank && Porciones no blank)
 * comprasRows: [{ fecha: Date, producto, pesoReal: number|null, porciones: number|null, empresa }]
 */
export function buildPesoPorcion(comprasRows, today) {
  const cutoff = addDays(today, -60);
  return comprasRows
    .filter((r) => r.fecha && r.fecha.getTime() >= cutoff.getTime())
    .filter((r) => r.pesoReal !== null && r.pesoReal !== undefined)
    .filter((r) => r.porciones !== null && r.porciones !== undefined)
    .map((r) => ({
      fecha: r.fecha,
      producto: r.producto,
      pesoReal: r.pesoReal,
      porciones: r.porciones,
      pesoXPorcion: r.porciones !== 0 ? r.pesoReal / r.porciones : null, // DIVIDE -> blank si /0
    }))
    .filter((r) => r.pesoXPorcion !== null);
}

function stdevP(values) {
  const n = values.length;
  if (n === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return Math.sqrt(variance);
}

/**
 * PromedioSinOutliers = por cada Producto distinto en Peso Porcion, promedio de
 * Peso x Porcion excluyendo valores fuera de [media - 2*stdev.p, media + 2*stdev.p].
 * Devuelve Map(producto -> promedioPesoXPorcion).
 */
export function buildPromedioSinOutliers(pesoPorcionRows) {
  const byProducto = new Map();
  for (const r of pesoPorcionRows) {
    if (!byProducto.has(r.producto)) byProducto.set(r.producto, []);
    byProducto.get(r.producto).push(r.pesoXPorcion);
  }
  const out = new Map();
  for (const [producto, values] of byProducto) {
    const media = values.reduce((a, b) => a + b, 0) / values.length;
    const desv = stdevP(values);
    const limsup = media + 2 * desv;
    const liminf = media - 2 * desv;
    const sinOutliers = values.filter((v) => v >= liminf && v <= limsup);
    const promedio =
      sinOutliers.length > 0 ? sinOutliers.reduce((a, b) => a + b, 0) / sinOutliers.length : null;
    out.set(producto, promedio);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 'Porciones calculadas' (columnas calculadas de Compras Insumos / Salidas y Mermas Ancestral)
// ---------------------------------------------------------------------------

/**
 * Compras Insumos[Porciones calculadas] =
 *   IF([Porciones]=BLANK(),
 *      IF(PesoPorcion<>BLANK(), ROUND(IF([Peso Real]=BLANK(),[Cantidad],[Peso Real])/PesoPorcion,0), BLANK()),
 *      [Porciones])
 * PesoPorcion = RELATED(PromedioSinOutliers[Promedio Peso x Porcion]) por Producto.
 */
export function comprasPorcionesCalculadas(row, promedioMap) {
  if (row.porciones !== null && row.porciones !== undefined) return row.porciones;
  const pesoPorcion = promedioMap.get(row.producto);
  if (pesoPorcion === undefined || pesoPorcion === null) return null;
  const numerador = row.pesoReal !== null && row.pesoReal !== undefined ? row.pesoReal : row.cantidad;
  if (numerador === null || numerador === undefined) return null;
  return Math.round(numerador / pesoPorcion);
}

/**
 * Salidas y Mermas Ancestral[Porciones calculadas] =
 *   IF([Porciones]=BLANK(), [Peso]/PesoPorcion, [Porciones])
 */
export function salidasPorcionesCalculadas(row, promedioMap) {
  if (row.porciones !== null && row.porciones !== undefined) return row.porciones;
  const pesoPorcion = promedioMap.get(row.producto);
  if (pesoPorcion === undefined || pesoPorcion === null || pesoPorcion === 0) return null;
  if (row.peso === null || row.peso === undefined) return null;
  return row.peso / pesoPorcion;
}

// ---------------------------------------------------------------------------
// Helpers de agregación por semana / insumo
// ---------------------------------------------------------------------------

function sum(values) {
  const nums = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  if (nums.length === 0) return 0; // SUM de DAX sobre conjunto vacío -> 0 (no blank) en contexto CALCULATE típico
  return nums.reduce((a, b) => a + b, 0);
}

function average(values) {
  const nums = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  if (nums.length === 0) return null; // AVERAGE de DAX sobre conjunto vacío -> BLANK()
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Compras Anc Ins = CALCULATE(SUM('Compras Insumos'[Porciones calculadas]), Empresa="Ancestral")
 *
 * OJO: la ÚNICA relación ACTIVA de 'Compras Insumos' hacia 'Calendar'[Date] es vía la columna
 * `Fecha1` (relationship 3bbe6213...). La columna calculada `Fecha` (= Fecha Porcion ?? Fecha1)
 * solo se relaciona con su propia LocalDateTable autogenerada, NO con 'Calendar'. Por lo tanto
 * cualquier medida que dependa del contexto de 'Calendar'[WeekYear] (como esta) debe agrupar por
 * `Fecha1`, no por la `Fecha` fusionada (esa sí se usa en 'Peso Porcion', que filtra explícitamente
 * 'Compras Insumos'[Fecha]).
 */
export function comprasAncIns(comprasRows, insumo, weekYearStr) {
  const rows = comprasRows.filter(
    (r) => r.insumo === insumo && r.empresa === "Ancestral" && r.fecha1 && weekYear(r.fecha1) === weekYearStr
  );
  return sum(rows.map((r) => r.porcionesCalculadas));
}

/** Salidas Anc Ins = SUM('Salidas y Mermas Ancestral'[Porciones calculadas]) */
export function salidasAncIns(salidasRows, insumo, weekYearStr) {
  const rows = salidasRows.filter((r) => r.insumo === insumo && weekYear(r.fecha) === weekYearStr);
  return sum(rows.map((r) => r.porcionesCalculadas));
}

/**
 * Vtas Anc Ins = SUMX(SUMMARIZE(Matriz filtrada a Insumo, 'Producto (izi)',
 *                                "Cantidad", CALCULATE(SUM(ventas[Cantidad Chuleton])),
 *                                "Porciones", MAX(Matriz[Porciones])),
 *                      [Cantidad]*[Porciones])
 *
 * IMPORTANTE sobre la propagación de filtros: 'Producto (izi)' es solo el NOMBRE legible del
 * producto (p.ej. "CHULETON (Kg)"); el campo que realmente relaciona con las ventas es
 * `Cod Producto` (p.ej. "ANC00090"), vía la relación bidireccional
 * Matriz_de_Relaciones Ancestral[Cod Producto] <-> Dim_Producto_iZi[Cod. Producto] y la relación
 * fac_ventas_Ancestral_iZi[codigoInventario] -> Dim_Producto_iZi[Cod. Producto]. SUMMARIZE agrupa
 * visualmente por 'Producto (izi)', pero el filtro efectivo sobre las ventas viaja por 'Cod Producto'
 * (el CALCULATE hereda el filtro de fila de TODA la tabla Matriz, no solo de la columna agrupada).
 * Por eso agrupamos aquí por 'Producto (izi)' (para MAX(Porciones), igual que SUMMARIZE) pero
 * filtramos las ventas por el conjunto de `Cod Producto` asociados a ese grupo.
 *
 * matrizRows: [{insumo, productoIzi, codProducto, porciones}]
 * ventasRows: [{fecha, codigoInventario, cantidadChuleton}]
 */
export function vtasAncIns(matrizRows, ventasRows, insumo, weekYearStr) {
  const grupos = buildMatrizGrupos(matrizRows, insumo);
  let total = 0;
  for (const { codProductos, porciones } of grupos.values()) {
    const ventasDelProducto = ventasRows.filter(
      (v) => codProductos.has(v.codigoInventario) && weekYear(v.fecha) === weekYearStr
    );
    const cantidad = sum(ventasDelProducto.map((v) => v.cantidadChuleton));
    total += cantidad * porciones;
  }
  return total;
}

/** Agrupa las filas de Matriz (filtradas a un Insumo) por 'Producto (izi)', tal como SUMMARIZE:
 *  para cada grupo, MAX(Porciones) y el conjunto de Cod Producto que realmente filtra las ventas. */
export function buildMatrizGrupos(matrizRows, insumo) {
  const matrizForInsumo = matrizRows.filter((r) => r.insumo === insumo && r.productoIzi);
  const grupos = new Map(); // productoIzi -> { porciones, codProductos: Set }
  for (const r of matrizForInsumo) {
    let g = grupos.get(r.productoIzi);
    if (!g) {
      g = { porciones: r.porciones, codProductos: new Set() };
      grupos.set(r.productoIzi, g);
    } else if (r.porciones > g.porciones) {
      g.porciones = r.porciones;
    }
    if (r.codProducto) g.codProductos.add(r.codProducto);
  }
  return grupos;
}

/** Vtas Tot Anc Ins = Salidas + Vtas */
export function vtasTotAncIns(salidas, vtas) {
  return salidas + vtas;
}

/**
 * Inv. Anc Ins = AVERAGE('Inventarios Unitarios GS'[Cantidad]) filtrado a Insumo=X y
 * al WeekYear de la semana consultada (vía relación activa Fecha->Calendar.Date).
 */
export function invAncIns(inventariosRows, insumo, weekYearStr) {
  const rows = inventariosRows.filter((r) => r.insumo === insumo && weekYear(r.fecha) === weekYearStr);
  return average(rows.map((r) => r.cantidad));
}

/**
 * Inv. -7 Anc Ins: usa la relación inactiva 'Inventarios Unitarios GS'[Fecha-7] -> Calendar[Date]
 * (Fecha-7 = Fecha+7). Al filtrar por WeekYear=W vía esa relación, se seleccionan filas cuyo
 * Fecha+7 cae en la semana W, es decir Fecha cae en la semana ANTERIOR (W-1), con la misma
 * alineación de día de semana. Devuelve el promedio de Cantidad de esas filas.
 */
export function invMenos7AncIns(inventariosRows, insumo, weekYearStr, anchorDate) {
  const range = weekYearToRange(weekYearStr, anchorDate);
  if (!range) return null;
  const prevStart = addDays(range.start, -7);
  const prevEnd = addDays(range.end, -7);
  const rows = inventariosRows.filter(
    (r) =>
      r.insumo === insumo &&
      r.fecha.getTime() >= prevStart.getTime() &&
      r.fecha.getTime() <= prevEnd.getTime()
  );
  return average(rows.map((r) => r.cantidad));
}

/**
 * Cierre Anc Ins = MAX(0, Inv.-7 + Compras - Vtas - Salidas)
 * (usa Vtas Anc Ins, NO Vtas Tot, tal como está escrito literalmente en el DAX).
 */
export function cierreAncIns(invMenos7, compras, vtas, salidas) {
  const base = (invMenos7 ?? 0) + compras - vtas - salidas;
  return Math.max(0, base);
}

/** Dif Anc Ins = IF(Inv=BLANK(), BLANK(), Inv - Cierre) */
export function difAncIns(inv, cierre) {
  if (inv === null || inv === undefined) return null;
  return inv - cierre;
}

// ---------------------------------------------------------------------------
// Acum Comp / Acum Sal / Inv Esp (usados en "DETALLE DE MOVIMIENTOS POR PRODUCTO")
// ---------------------------------------------------------------------------

/**
 * Acum Comp Anc Ins = CALCULATE([Compras Anc Ins], FILTER(ALL(Calendar), Date<=FechaActual && WeekYear=WeekActual))
 * Acumulado de compras desde el lunes de la semana hasta `fechaActual` (inclusive).
 */
export function acumComprasAncIns(comprasRows, insumo, weekYearStr, fechaActual) {
  const rows = comprasRows.filter(
    (r) =>
      r.insumo === insumo &&
      r.empresa === "Ancestral" &&
      r.fecha1 &&
      weekYear(r.fecha1) === weekYearStr &&
      r.fecha1.getTime() <= fechaActual.getTime()
  );
  return sum(rows.map((r) => r.porcionesCalculadas));
}

/** Acum Sal Anc Ins = igual patrón pero sobre [Vtas Tot Anc Ins] (Salidas+Vtas) acumulado día a día. */
export function acumVtasTotAncIns(salidasRows, matrizRows, ventasRows, insumo, weekYearStr, fechaActual) {
  const salidasAcum = sum(
    salidasRows
      .filter(
        (r) => r.insumo === insumo && weekYear(r.fecha) === weekYearStr && r.fecha.getTime() <= fechaActual.getTime()
      )
      .map((r) => r.porcionesCalculadas)
  );

  // Vtas acumuladas: mismo patrón que vtasAncIns (agrupado por 'Producto (izi)', filtrado por
  // 'Cod Producto' -- ver nota en vtasAncIns) pero con ventas filtradas a fecha <= fechaActual.
  const grupos = buildMatrizGrupos(matrizRows, insumo);
  let vtasAcum = 0;
  for (const { codProductos, porciones } of grupos.values()) {
    const ventasDelProducto = ventasRows.filter(
      (v) =>
        codProductos.has(v.codigoInventario) &&
        weekYear(v.fecha) === weekYearStr &&
        v.fecha.getTime() <= fechaActual.getTime()
    );
    vtasAcum += sum(ventasDelProducto.map((v) => v.cantidadChuleton)) * porciones;
  }

  return salidasAcum + vtasAcum;
}

/**
 * Inv. Esp. Anc Ins (usada en la columna "Inv. Dia Esp." de la tabla "DETALLE DE MOVIMIENTOS
 * POR PRODUCTO"). El DAX original es:
 *   MAX(
 *     CALCULATE(AVERAGE('Inventarios Unitarios GS'[Cantidad]),
 *               REMOVEFILTERS(Calendar[Date],Calendar[WeekDay],Calendar[WeekDay Name]),
 *               USERELATIONSHIP('Inventarios GS'[Fecha-7], Calendar[Date]))   <-- OJO: tabla 'Inventarios GS',
 *                                                                                  NO 'Inventarios Unitarios GS'
 *     + [Acum Comp Anc Ins] - [Acum Sal Anc Ins], 0)
 *
 * Esto es, casi con certeza, un bug de copy-paste en el modelo original (la medida gemela de
 * bebidas SÍ usa 'Inventarios GS', pero esta es la versión de insumos y debería usar
 * 'Inventarios Unitarios GS'). Como 'Inventarios GS' no tiene relación con Matriz_de_Relaciones
 * Ancestral (no se filtra por Insumo), el USERELATIONSHIP no aporta ningún filtro efectivo sobre
 * 'Inventarios Unitarios GS' en este contexto: la relación activada apunta a una tabla que ni
 * siquiera participa en el cálculo. El resultado neto observado es que el término AVERAGE(...)
 * queda filtrado SOLO por Insumo (contexto de fila) y por Calendar[WeekYear] (que NO se remueve),
 * es decir: el promedio de TODA la semana (no de la semana anterior), igual para los 7 días.
 * Replicamos ese comportamiento observado tal cual, documentado como discrepancia conocida.
 */
export function invEspAncIns(inventariosRows, insumo, weekYearStr, acumComp, acumSal) {
  const rows = inventariosRows.filter((r) => r.insumo === insumo && weekYear(r.fecha) === weekYearStr);
  const avg = average(rows.map((r) => r.cantidad));
  const base = (avg ?? 0) + acumComp - acumSal;
  return Math.max(0, base);
}

export { weekYear, weekdayIso, weekdayName, mondayOf, weekYearToRange };
